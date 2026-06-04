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
//   pdf_base64: string
// }

import crypto from 'crypto';

const PAYT_BASE = 'https://api.paytsoftware.com/api';
const ts = () => new Date().toISOString().replace('T',' ').slice(0,19);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, administration_id, invoice_number, filename, pdf_base64 } = req.body || {};
  if (!token)             return res.status(400).json({ error: 'missing_token' });
  if (!administration_id) return res.status(400).json({ error: 'missing_administration_id' });
  if (!invoice_number)    return res.status(400).json({ error: 'missing_invoice_number' });
  if (!filename)          return res.status(400).json({ error: 'missing_filename' });
  if (!pdf_base64)        return res.status(400).json({ error: 'missing_pdf' });

  const jsonHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  try {
    const pdfBuffer = Buffer.from(pdf_base64, 'base64');
    const checksum  = crypto.createHash('md5').update(pdfBuffer).digest('base64');
    const byte_size = pdfBuffer.length;

    // ── Step 1: Register file with PAYT to obtain signed upload URL ──
    const filesPayload = {
      administration_id,
      files: [{ byte_size, checksum, content_type: 'application/pdf' }],
    };
    console.log(`[payt-pdf ${ts()}] FILES payload:`, JSON.stringify(filesPayload));
    const filesRes = await fetch(`${PAYT_BASE}/v1/files`, {
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

    // Response may be a single object { checksum, url } or wrapped in files[]
    const entry         = Array.isArray(filesData.files) ? filesData.files[0] : filesData;
    const uploadUrl     = entry.url;
    const finalChecksum = entry.checksum || checksum;

    if (!uploadUrl) {
      return res.status(200).json({ success: false, error: 'URL upload absente dans la réponse PAYT' });
    }

    // ── Step 2: PUT raw PDF bytes to signed URL ──
    console.log(`[payt-pdf ${ts()}] PUT to signed URL`);
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: pdfBuffer,
    });
    console.log(`[payt-pdf ${ts()}] PUT response`, putRes.status);

    if (!putRes.ok) {
      return res.status(200).json({ success: false, error: `Erreur upload PDF vers stockage [${putRes.status}]` });
    }

    // ── Step 3: PATCH invoice to attach document ──
    const patchPayload = {
      administration_id,
      invoices: [{ invoice_number, document: { checksum: finalChecksum, filename } }],
    };
    console.log(`[payt-pdf ${ts()}] PATCH payload:`, JSON.stringify(patchPayload));
    const patchRes = await fetch(`${PAYT_BASE}/v1/invoices`, {
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
    return res.status(200).json({ success: false, error: "Erreur serveur lors de l'upload PDF" });
  }
}
