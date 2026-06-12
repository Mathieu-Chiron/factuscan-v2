// api/payt-invoices-get.js
// Proxy: list invoices from PAYT for one or all administrations.
// Body: { token, administration_ids?: string[] }
// Returns: { invoices: [...] }

import { ProxyAgent } from 'undici';

const PAYT_BASE = process.env.PAYT_PROXY_URL || 'https://api.paytsoftware.com/api';
const PROXY_SECRET = process.env.PROXY_SECRET;

const _fixieAgent = process.env.FIXIE_URL ? new ProxyAgent(process.env.FIXIE_URL) : null;
function _fetch(url, opts) {
  return fetch(url, _fixieAgent ? { ...opts, dispatcher: _fixieAgent } : opts);
}

const AUTH_HEADERS = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
  ...(PROXY_SECRET && { 'x-proxy-secret': PROXY_SECRET }),
});

async function fetchAdminIds(token) {
  const all = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const url = new URL(`${PAYT_BASE}/v1/administrations`);
    url.searchParams.set('per_page', '500');
    if (cursor) url.searchParams.set('cursor', cursor);
    const r = await _fetch(url.toString(), { method: 'GET', headers: AUTH_HEADERS(token) });
    if (!r.ok) throw new Error(`Administrations HTTP ${r.status}`);
    const payload = await r.json().catch(() => ({}));
    const page = Array.isArray(payload.data) ? payload.data : [];
    all.push(...page.map(a => a.id));
    cursor = payload.pagination?.cursor;
    if (page.length < 500 || !cursor) break;
  }
  return all;
}

async function fetchInvoicesForAdmin(token, adminId) {
  const all = [];
  let cursor = null;
  const PER_PAGE = 100;
  for (let i = 0; i < 200; i++) {
    const url = new URL(`${PAYT_BASE}/v1/invoices`);
    url.searchParams.set('administration_id', adminId);
    url.searchParams.set('per_page', String(PER_PAGE));
    if (cursor) url.searchParams.set('cursor', cursor);
    const r = await _fetch(url.toString(), { method: 'GET', headers: AUTH_HEADERS(token) });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.message || `HTTP ${r.status}`);
    }
    const payload = await r.json().catch(() => ({}));
    const page = Array.isArray(payload.data) ? payload.data : [];
    all.push(...page.map(inv => ({ ...inv, _administration_id: adminId })));
    cursor = payload.pagination?.cursor;
    if (page.length < PER_PAGE || !cursor) break;
  }
  return all;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, administration_ids } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing_token' });

  try {
    const adminIds = Array.isArray(administration_ids) && administration_ids.length
      ? administration_ids
      : await fetchAdminIds(token);

    const allInvoices = [];
    for (const adminId of adminIds) {
      const invoices = await fetchInvoicesForAdmin(token, adminId);
      allInvoices.push(...invoices);
    }

    return res.status(200).json({ invoices: allInvoices });
  } catch (err) {
    return res.status(502).json({
      error: 'upstream_unreachable',
      message: err.message || "Impossible de joindre l'API PAYT.",
    });
  }
}
