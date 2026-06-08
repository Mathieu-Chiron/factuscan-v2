// api/blob-get.js
// GET /api/blob-get?url=<blob-url>
// Proxy: fetch private blob server-side, stream to client
// Prevents direct public access to invoice PDFs

import { head } from '@vercel/blob';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'missing_url' });

  // Only allow fetching from our own blob store
  if (!url.startsWith('https://') || !url.includes('blob.vercel-storage.com')) {
    return res.status(403).json({ error: 'forbidden' });
  }

  try {
    const fetchRes = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` },
    });
    if (!fetchRes.ok) return res.status(fetchRes.status).json({ error: 'blob_fetch_failed' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const buf = Buffer.from(await fetchRes.arrayBuffer());
    return res.send(buf);
  } catch (e) {
    console.error('[blob-get] Error:', e);
    return res.status(500).json({ error: 'Erreur lecture Blob' });
  }
}
