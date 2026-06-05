// PAYT proxy — forwards requests from Vercel functions to api.paytsoftware.com
// Deployed on Railway so PAYT always sees a fixed outbound IP.
//
// Env vars:
//   PORT          — set automatically by Railway
//   PROXY_SECRET  — shared secret with Vercel (required in production)

import express from 'express';

const app  = express();
const PORT = process.env.PORT || 3000;
const SECRET = process.env.PROXY_SECRET;
const PAYT_BASE = 'https://api.paytsoftware.com/api';

// Parse every body as raw bytes so we forward it untouched
app.use(express.raw({ type: '*/*', limit: '50mb' }));

// Auth: reject requests without the shared secret
app.use((req, res, next) => {
  if (SECRET && req.headers['x-proxy-secret'] !== SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

app.all('*', async (req, res) => {
  // Build PAYT target URL: proxy path + query string
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const target = PAYT_BASE + req.path + qs;

  // Forward all headers except proxy-specific / hop-by-hop ones
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (!['host', 'x-proxy-secret', 'content-length', 'connection', 'transfer-encoding'].includes(lk)) {
      headers[k] = v;
    }
  }

  try {
    const opts = { method: req.method, headers };
    if (Buffer.isBuffer(req.body) && req.body.length > 0) opts.body = req.body;

    const r = await fetch(target, opts);
    const buf = Buffer.from(await r.arrayBuffer());

    res.status(r.status);
    r.headers.forEach((v, k) => {
      if (!['transfer-encoding', 'connection'].includes(k)) res.setHeader(k, v);
    });
    res.send(buf);
  } catch (e) {
    console.error('[proxy] error:', e.message);
    res.status(502).json({ error: 'proxy_error', message: e.message });
  }
});

app.listen(PORT, () => console.log(`PAYT proxy running on port ${PORT}`));
