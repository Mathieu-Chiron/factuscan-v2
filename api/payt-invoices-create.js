// api/payt-invoices-create.js
// Creates new invoices in PAYT via POST /v1/invoices.
// Body: { token, invoices: [{ administration_id, invoice_number, debtor_number,
//         invoice_date, due_date, total_amount, open_amount, currency_code?,
//         debtor_lastname?, debtor_post_street_1?, debtor_post_postalcode?,
//         debtor_post_city?, debtor_post_country_code?, debtor_email? }] }
// Returns: { results: { [invoice_number]: { success, error? } } }

import { ProxyAgent } from 'undici';

const PAYT_BASE = process.env.PAYT_PROXY_URL || 'https://api.paytsoftware.com/api';
const PROXY_SECRET = process.env.PROXY_SECRET;

const _fixieAgent = process.env.FIXIE_URL ? new ProxyAgent(process.env.FIXIE_URL) : null;
function _fetch(url, opts) {
  return fetch(url, _fixieAgent ? { ...opts, dispatcher: _fixieAgent } : opts);
}

async function fetchWithRetry(url, opts, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await _fetch(url, opts);
    if (r.status !== 429) return r;
    const wait = (parseInt(r.headers.get('retry-after') || '2', 10) || 2) * 1000 * Math.pow(2, attempt);
    if (attempt < maxRetries) await new Promise(res => setTimeout(res, wait));
    else return r;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, invoices } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing_token' });
  if (!Array.isArray(invoices) || !invoices.length) return res.status(400).json({ error: 'missing_invoices' });

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(PROXY_SECRET && { 'x-proxy-secret': PROXY_SECRET }),
  };

  const results = {};
  invoices.forEach(inv => { results[inv.invoice_number] = { success: false }; });

  // Group by administration
  const byAdmin = {};
  invoices.forEach(inv => {
    if (!byAdmin[inv.administration_id]) byAdmin[inv.administration_id] = [];
    byAdmin[inv.administration_id].push(inv);
  });

  for (const [adminId, batch] of Object.entries(byAdmin)) {
    const payload = batch.map(inv => {
      const total = String(parseFloat(inv.total_amount) || 0);
      const open  = String(parseFloat(inv.open_amount)  || 0);
      const p = {
        invoice_number:    inv.invoice_number,
        debtor_number:     inv.debtor_number,
        invoice_date:      inv.invoice_date,
        due_date:          inv.due_date,
        book_amount_total: total,
        amount_total:      total,
        book_amount_open:  open,
        amount_open:       open,
        currency_code:     inv.currency_code || 'EUR',
      };
      // Optional debtor fields — send only if present
      if (inv.debtor_lastname)            p.debtor_lastname            = inv.debtor_lastname;
      if (inv.debtor_post_street_1)       p.debtor_post_street_1       = inv.debtor_post_street_1;
      if (inv.debtor_post_postalcode)     p.debtor_post_postalcode     = String(inv.debtor_post_postalcode);
      if (inv.debtor_post_city)           p.debtor_post_city           = inv.debtor_post_city;
      if (inv.debtor_post_country_code)   p.debtor_post_country_code   = inv.debtor_post_country_code;
      if (inv.debtor_email)               p.debtor_email               = inv.debtor_email;
      return p;
    });

    try {
      console.log(`[payt-invoices-create] POST /v1/invoices admin=${adminId} count=${payload.length}`);
      const r = await fetchWithRetry(`${PAYT_BASE}/v1/invoices`, {
        method: 'POST', headers,
        body: JSON.stringify({ administration_id: adminId, invoices: payload }),
      });
      const data = await r.json().catch(() => ({}));
      console.log(`[payt-invoices-create] response ${r.status}`, JSON.stringify(data));

      batch.forEach(inv => {
        if (!r.ok && !data?.errors) {
          results[inv.invoice_number] = {
            success: false,
            error: `HTTP ${r.status}: ${data?.error?.message || data?.message || 'Erreur inconnue'}`,
          };
        } else {
          const errs = data?.errors?.[inv.invoice_number] || [];
          results[inv.invoice_number] = errs.length
            ? { success: false, error: errs.join(', ') }
            : { success: true };
        }
      });
    } catch (e) {
      batch.forEach(inv => {
        results[inv.invoice_number] = { success: false, error: 'Impossible de joindre PAYT' };
      });
    }
  }

  return res.status(200).json({ results });
}
