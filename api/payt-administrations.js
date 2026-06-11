// api/payt-administrations.js
// Serverless proxy: fetches the list of PAYT "administrations" (entities)
// linked to the user's organisation, using the Bearer token they provide.
//
// Security model (simple/local V1):
//  - The token is sent from the browser to THIS function only (same-origin,
//    allowed by the CSP `connect-src 'self'`).
//  - It is forwarded to PAYT in the Authorization header and never logged
//    or persisted server-side.

const PAYT_BASE = process.env.PAYT_PROXY_URL || 'https://api.paytsoftware.com/api';
const PROXY_SECRET = process.env.PROXY_SECRET;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Token can arrive in the body { token } or as a Bearer Authorization header.
  const auth = req.headers['authorization'];
  const token =
    (req.body && req.body.token) ||
    (auth && auth.startsWith('Bearer ') ? auth.slice(7) : null);

  if (!token) {
    return res.status(400).json({ error: 'missing_token', message: 'Aucun token PAYT fourni.' });
  }

  try {
    const all = [];
    let cursor = null;
    const PER_PAGE = 500;

    // Paginate through every administration via the cursor.
    for (let i = 0; i < 50; i++) {
      const url = new URL(`${PAYT_BASE}/v1/administrations`);
      url.searchParams.set('per_page', String(PER_PAGE));
      if (cursor) url.searchParams.set('cursor', cursor);

      const r = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(PROXY_SECRET && { 'x-proxy-secret': PROXY_SECRET }),
        },
      });

      const payload = await r.json().catch(() => ({}));
      console.log(`[payt-administrations] status=${r.status} count=${Array.isArray(payload.data) ? payload.data.length : 'n/a'} raw=${JSON.stringify(payload).slice(0,200)}`);

      if (!r.ok) {
        // Forward PAYT's full response for debugging
        return res.status(r.status).json({
          error: payload.error?.code || payload.code || 'payt_error',
          message: payload.error?.message || payload.message || 'Erreur lors de la connexion à PAYT.',
        });
      }

      const page = Array.isArray(payload.data) ? payload.data : [];
      all.push(...page);

      cursor = payload.pagination && payload.pagination.cursor;
      // Stop when the page isn't full or there is no further cursor.
      if (page.length < PER_PAGE || !cursor) break;
    }

    // Return only what the UI needs (id, name, status, internal_name, city).
    const administrations = all.map((a) => ({
      id: a.id,
      name: a.name,
      internal_name: a.internal_name,
      status: a.status,
      city: a.city,
      country_code: a.country_code,
    }));

    return res.status(200).json({ administrations });
  } catch (err) {
    return res.status(502).json({
      error: 'upstream_unreachable',
      message: "Impossible de joindre l'API PAYT.",
    });
  }
}
