// api/blob-upload.js
// POST /api/blob-upload?filename=<name>
// Body: raw PDF bytes (application/octet-stream)
// Returns: { url: string }

import { put } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const filename = req.query.filename || 'invoice.pdf';

  const hasToken = !!process.env.BLOB_READ_WRITE_TOKEN;
  console.log(`[blob-upload] token present: ${hasToken}, filename: ${filename}`);

  try {
    // Read raw body from stream (Vercel does not auto-parse non-JSON bodies)
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    console.log(`[blob-upload] body size: ${buffer.length}`);
    if (!buffer.length) return res.status(400).json({ error: 'Empty body' });

    const blob = await put(filename, buffer, {
      access: 'public',
      contentType: 'application/pdf',
    });

    console.log(`[blob-upload] success: ${blob.url}`);
    return res.status(200).json({ url: blob.url });
  } catch (e) {
    console.error('[blob-upload] Error:', e.message);
    return res.status(500).json({ error: e.message || "Erreur upload vers Blob" });
  }
}
