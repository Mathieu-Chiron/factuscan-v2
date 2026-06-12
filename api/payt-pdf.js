// api/payt-pdf.js
// Attaches a PDF to an existing PAYT invoice via 3-step flow:
//   1. POST /v1/files   — register file metadata, get signed upload URL + checksum
//   2. PUT <url>        — upload raw PDF bytes to signed URL
//   3. PATCH /v1/invoices — link document to invoice via checksum + filename
//
// Expected body:
// {
//   token: string,
//   administration_id: string,
//   invoice_number: string,
//   filename: string,
//   pdf_url: string        ← public Vercel Blob URL (preferred)
//   pdf_base64: string     ← legacy fallback
// }

import crypto from 'crypto';
import { ProxyAgent } from 'undici';

const PAYT_BASE = process.env.PAYT_PROXY_URL || 'https://api.paytsoftware.com/api';
const PROXY_SECRET = process.env.PROXY_SECRET;
const ts = () => new Date().toISOString().replace('T',' ').slice(0,19);

// Route outbound PAYT calls through Fixie (static IP) when FIXIE_URL is set.
const _fixieAgent = process.env.FIXIE_URL ? new ProxyAgent(process.env.FIXIE_URL) : null;
function _fetch(url, opts) {
  return fetch(url, _fixieAgent ? { ...opts, dispatcher: _fixieAgent } : opts);
}

async function fetchWithRetry(url, opts, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await _fetch(url, opts);
    if (r.status !== 429) return r;
    const retryAfter = parseInt(r.headers.get('retry-after') || '2', 10);
    const wait = (retryAfter || 2) * 1000 * Math.pow(2, attempt);
    console.log(`[payt-pdf ${ts()}] 429 rate limit — retry in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
    if (attempt < maxRetries) await new Promise(res => setTimeout(res, wait));
    else return r;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, administration_id, invoice_number, filename, pdf_url, pdf_base64 } = req.body || {};
  if (!token)             return res.status(400).json({ error: 'missing_token' });
  if (!administration_id) return res.status(400).json({ error: 'missing_administration_id' });
  if (!invoice_number)    return res.status(400).json({ error: 'missing_invoice_number' });
  if (!filename)          return res.status(400).json({ error: 'missing_filename' });
  if (!pdf_url && !pdf_base64) return res.status(400).json({ error: 'missing_pdf' });

  const jsonHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(PROXY_SECRET && { 'x-proxy-secret': PROXY_SECRET }),
  };

  try {
    let pdfBuffer;
    if (pdf_url) {
      const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
      const fetchRes = await fetch(pdf_url, blobToken ? { headers: { Authorization: `Bearer ${blobToken}` } } : {});
      if (!fetchRes.ok) return res.status(200).json({ success: false, error: `Erreur fetch PDF depuis Blob [${fetchRes.status}]` });
      pdfBuffer = Buffer.from(await fetchRes.arrayBuffer());
    } else {
      pdfBuffer = Buffer.from(pdf_base64, 'base64');
    }
    const checksum  = crypto.createHash('sha3-512').update(pdfBuffer).digest('base64');
    const byte_size = String(pdfBuffer.length);

    // ── Step 1: Register file with PAYT to obtain signed upload URL ──
    const filesPayload = {
      administration_id,
      files: [{ byte_size, checksum, content_type: 'application/pdf' }],
    };
    console.log(`[payt-pdf ${ts()}] FILES payload:`, JSON.stringify(filesPayload));
    const filesRes = await fetchWithRetry(`${PAYT_BASE}/v1/files`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(filesPayload),
    });
    const filesData = await filesRes.json().catch(() => ({}));
    console.log(`[payt-pdf ${ts()}] FILES response`, filesRes.status, JSON.stringify(filesData));

    if (!filesRes.ok) {
      return res.status(200).json({
        success: false,
        error: `Erreur enregistrement fichier [${filesRes.status}]: ${filesData?.error?.message || filesData?.message || 'Erreur inconnue'}`,
      });
    }

    // Response is an array [{checksum, url, expires_at}]
    // Empty [] = file already exists on PAYT — skip PUT, go straight to PATCH
    const list          = Array.isArray(filesData) ? filesData : (Array.isArray(filesData.files) ? filesData.files : [filesData]);
    const entry         = list[0];
    const finalChecksum = entry?.checksum || checksum;
    console.log(`[payt-pdf ${ts()}] FILES entry:`, JSON.stringify(entry), '— already_exists:', !entry?.url);

    if (entry?.url) {
      // ── Step 2: PUT raw PDF bytes to signed URL ──
      console.log(`[payt-pdf ${ts()}] PUT to signed URL`);
      const putRes = await fetch(entry.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: pdfBuffer,
      });
      console.log(`[payt-pdf ${ts()}] PUT response`, putRes.status);
      if (!putRes.ok) {
        return res.status(200).json({ success: false, error: `Erreur upload PDF vers stockage [${putRes.status}]` });
      }
    } else {
      console.log(`[payt-pdf ${ts()}] fichier déjà présent sur PAYT — PUT ignoré`);
    }

    // ── Step 3: PATCH invoice to attach document ──
    const patchPayload = {
      administration_id,
      invoices: [{ invoice_number, document: { checksum: finalChecksum, filename } }],
    };
    console.log(`[payt-pdf ${ts()}] PATCH payload:`, JSON.stringify(patchPayload));
    const patchRes = await fetchWithRetry(`${PAYT_BASE}/v1/invoices`, {
      method: 'PATCH',
      headers: jsonHeaders,
      body: JSON.stringify(patchPayload),
    });
    const patchData = await patchRes.json().catch(() => ({}));
    console.log(`[payt-pdf ${ts()}] PATCH response`, patchRes.status, JSON.stringify(patchData));

    if (!patchRes.ok) {
      const invErrors = patchData?.errors?.[invoice_number];
      const msg = invErrors?.length
        ? invErrors.join(', ')
        : (patchData?.error?.message || patchData?.message || 'Erreur inconnue');
      return res.status(200).json({
        success: false,
        error: `Erreur liaison PDF à la facture [${patchRes.status}]: ${msg}`,
      });
    }

    return res.status(200).json({ success: true });

  } catch (e) {
    console.error('[payt-pdf] Error:', e);
    return res.status(200).json({ success: false, error: `Erreur serveur lors de l'upload PDF: ${e?.message || e}` });
  }
}
