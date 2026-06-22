// api/payt-invoices-update.js
// Updates existing PAYT invoices (status Payée / Clôturée / partial payment).
// Body: { token, updates: [{ administration_id, invoice_number, invoice_identifier?,
//         debtor_number, invoice_date, due_date, total_amount, open_amount,
//         new_status, amount_paid, payment_date, currency_code? }] }
// Returns: { results: { [invoice_number]: { success, errors, warnings, credit_note? } } }

import { ProxyAgent } from 'undici';
import { sendAlert } from './_alert.js';

const PAYT_BASE = process.env.PAYT_PROXY_URL || 'https://api.paytsoftware.com/api';
const PROXY_SECRET = process.env.PROXY_SECRET;
const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

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

  const { token, updates } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing_token' });
  if (!Array.isArray(updates) || !updates.length) return res.status(400).json({ error: 'missing_updates' });

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(PROXY_SECRET && { 'x-proxy-secret': PROXY_SECRET }),
  };

  const results = {};
  updates.forEach(u => { results[u.invoice_number] = { success: false, errors: [], warnings: [] }; });

  const today = new Date().toISOString().slice(0, 10);

  // Group by administration
  const byAdmin = {};
  updates.forEach(u => {
    if (!byAdmin[u.administration_id]) byAdmin[u.administration_id] = [];
    byAdmin[u.administration_id].push(u);
  });

  for (const [administrationId, batch] of Object.entries(byAdmin)) {
    // Build invoice payloads — update book_amount_open + optional payments[]
    const invoicesPayload = batch.map(u => {
      const totalAmount = parseFloat(u.total_amount) || 0;
      const openAmount  = parseFloat(u.open_amount)  || 0;
      const amountPaid  = parseFloat(u.amount_paid)  || 0;

      const newOpen = (u.new_status === 'Payée' || u.new_status === 'Clôturée')
        ? 0
        : Math.max(0, openAmount - amountPaid);

      // Do NOT include payments[] — PAYT derives amount_paid from (book_amount_total - book_amount_open).
      // Sending payments[] would require their sum to equal that derived value, which fails for
      // partial payments or invoices with existing payment history.
      return {
        invoice_number:    u.invoice_number,
        debtor_number:     u.debtor_number,
        invoice_date:      u.invoice_date,
        due_date:          u.due_date,
        book_amount_total: String(totalAmount),
        amount_total:      String(totalAmount),
        book_amount_open:  String(newOpen),
        amount_open:       String(newOpen),
        currency_code:     u.currency_code || 'EUR',
        ...(u.invoice_identifier && { invoice_identifier: u.invoice_identifier }),
      };
    });

    try {
      console.log(`[payt-invoices-update ${ts()}] POST /v1/invoices admin=${administrationId} count=${invoicesPayload.length}`);
      const r = await fetchWithRetry(`${PAYT_BASE}/v1/invoices`, {
        method: 'POST', headers,
        body: JSON.stringify({ administration_id: administrationId, invoices: invoicesPayload }),
      });
      const data = await r.json().catch(() => ({}));
      console.log(`[payt-invoices-update ${ts()}] response ${r.status}`, JSON.stringify(data));

      if (!r.ok && !data?.errors) {
        batch.forEach(u => {
          results[u.invoice_number].errors.push(`HTTP ${r.status}: ${data?.error?.message || data?.message || 'Erreur inconnue'}`);
        });
      } else {
        batch.forEach(u => {
          results[u.invoice_number].errors.push(...(data?.errors?.[u.invoice_number]   || []));
          results[u.invoice_number].warnings.push(...(data?.warnings?.[u.invoice_number] || []));
          if (!results[u.invoice_number].errors.length) results[u.invoice_number].success = true;
        });

        // For Clôturée: create credit note + re-close original
        const clotureeeBatch = batch.filter(u =>
          u.new_status === 'Clôturée' && !results[u.invoice_number].errors.length
        );
        for (const u of clotureeeBatch) {
          const openAmount  = parseFloat(u.open_amount)  || 0;
          const amountPaid  = parseFloat(u.amount_paid)  || 0;
          // Credit note covers only the unpaid remainder (open - partial payment received)
          const avoirAmount = Math.max(0, amountPaid > 0 ? openAmount - amountPaid : openAmount);
          if (avoirAmount === 0) continue;
          const creditNumber = `AVOIR-${u.invoice_number}`;
          try {
            const cnr = await fetchWithRetry(`${PAYT_BASE}/v1/invoices`, {
              method: 'POST', headers,
              body: JSON.stringify({
                administration_id: administrationId,
                invoices: [{
                  debtor_number:     u.debtor_number,
                  invoice_number:    creditNumber,
                  invoice_date:      today,
                  due_date:          today,
                  book_amount_total: String(-avoirAmount),
                  amount_total:      String(-avoirAmount),
                  book_amount_open:  '0',
                  amount_open:       '0',
                  currency_code:     u.currency_code || 'EUR',
                  sent_at:           new Date().toISOString(),
                }],
              }),
            });
            const cndata = await cnr.json().catch(() => ({}));
            const cnErrors = cndata?.errors?.[creditNumber] || [];
            if ((!cnr.ok && !cndata?.errors) || cnErrors.length) {
              results[u.invoice_number].warnings.push(`Avoir non créé: ${cnErrors.join(', ') || cndata?.message || 'Erreur'}`);
            } else {
              results[u.invoice_number].credit_note = creditNumber;
            }
          } catch (e) {
            results[u.invoice_number].warnings.push(`Erreur avoir: ${e.message}`);
          }
        }
      }
    } catch (e) {
      await sendAlert({ subject: 'Erreur réseau PAYT (invoice-edit)', text: e?.message || String(e), source: 'payt-invoices-update' });
      batch.forEach(u => { results[u.invoice_number].errors.push('Impossible de joindre PAYT'); });
    }
  }

  // Alert on errors/warnings
  const failed = Object.entries(results).filter(([, r]) => r.errors.length > 0);
  const warned = Object.entries(results).filter(([, r]) => r.warnings.length > 0);
  if (failed.length > 0) {
    const lines = failed.map(([num, r]) => `${num}: ${r.errors.join(', ')}`).join('
');
    await sendAlert({ subject: `${failed.length} mise(s) à jour rejetée(s) par PAYT`, text: lines, level: 'warning', source: 'payt-invoices-update' });
  }
  if (warned.length > 0) {
    const lines = warned.map(([num, r]) => `${num}: ${r.warnings.join(', ')}`).join('
');
    await sendAlert({ subject: `${warned.length} avoir(s) non créé(s)`, text: lines, level: 'warning', source: 'payt-invoices-update' });
  }
  return res.status(200).json({ results });
}
