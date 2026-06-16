// api/payt-push.js
// Pushes invoices (+ contacts + debtors) to PAYT in up to 4 steps:
//   1. POST /v1/contacts — upsert contacts with address (deduplicated by contact_identifier)
//   2. POST /v1/debtors  — link contacts to administration as debtors
//   3. POST /v1/invoices — create invoices (book_amount_open already net of any partial payment)
//   4. POST /v1/invoices — credit note (avoir) + re-POST original invoice with open=0 for Clôturée
//
// NOTE: /v1/payments returns 405 (not supported). Partial payments are reflected directly via
// book_amount_open in Step 3. Closing is done via a second POST of the original invoice in Step 4.
//
// Expected body:
// {
//   token: string,
//   invoices: [{
//     invoice_number, invoice_date, invoice_due_date,
//     invoice_total_amount_inc_vat, invoice_open_amount_inc_vat,
//     currency_code?,
//     debtor_number, debtor_name, debtor_identifier,
//     debtor_firstname?, debtor_infix?, debtor_lastname?,
//     debtor_country_code?, debtor_post_street_1?, debtor_post_postalcode?,
//     debtor_post_city?, debtor_email?, debtor_vat_number?, debtor_is_company?,
//     administration_id
//   }]
// }

import { ProxyAgent } from 'undici';

const PAYT_BASE = process.env.PAYT_PROXY_URL || 'https://api.paytsoftware.com/api';
const PROXY_SECRET = process.env.PROXY_SECRET;
const ts = () => new Date().toISOString().replace('T',' ').slice(0,19);

// Route outbound PAYT calls through Fixie (static IP) when FIXIE_URL is set.
// FIXIE_URL format: http://fixie:TOKEN@velodrome.usefixie.com:80
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
    console.log(`[payt-push ${ts()}] 429 rate limit — retry in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
    if (attempt < maxRetries) await new Promise(res => setTimeout(res, wait));
    else return r; // return last 429 after exhausting retries
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
  invoices.forEach(inv => { results[inv.invoice_number] = { success: false, errors: [], warnings: [], credit_note: null }; });

  // ── Step 1: upsert contacts (deduplicated by contact_identifier per administration) ──
  const contactsByAdmin = {};
  invoices.forEach(inv => {
    const aid = inv.administration_id;
    if (!contactsByAdmin[aid]) contactsByAdmin[aid] = new Map();
    const contactId = inv.debtor_identifier || inv.debtor_number;
    if (!contactsByAdmin[aid].has(contactId)) {
      contactsByAdmin[aid].set(contactId, {
        contact_identifier: contactId,
        // Name: use split fields if available, otherwise full name in lastname
        lastname: inv.debtor_lastname || inv.debtor_name,
        ...(inv.debtor_firstname && { firstname: inv.debtor_firstname }),
        ...(inv.debtor_infix     && { infix:     inv.debtor_infix }),
        // Address
        ...(inv.debtor_post_street_1   && { postal_address_street_1:     inv.debtor_post_street_1 }),
        ...(inv.debtor_post_postalcode && { postal_address_postal_code:  inv.debtor_post_postalcode }),
        ...(inv.debtor_post_city       && { postal_address_city:         inv.debtor_post_city }),
        ...(inv.debtor_country_code    && { postal_address_country_code: inv.debtor_country_code }),
        // Email
        ...(inv.debtor_email && { default_email_address: inv.debtor_email }),
      });
    }
  });

  for (const [administrationId, contactMap] of Object.entries(contactsByAdmin)) {
    const payload = { administration_id: administrationId, contacts: [...contactMap.values()] };
    try {
      console.log(`[payt-push ${ts()}] CONTACT payload:`, JSON.stringify(payload));
      const r = await fetchWithRetry(`${PAYT_BASE}/v1/contacts`, { method: 'POST', headers, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      console.log(`[payt-push ${ts()}] CONTACT response`, r.status, JSON.stringify(data));
      if (!r.ok) {
        invoices
          .filter(inv => inv.administration_id === administrationId)
          .forEach(inv => {
            results[inv.invoice_number].errors.push(
              `Erreur contact [${r.status}]: ${data?.error?.message || data?.message || 'Erreur inconnue'}`
            );
          });
      }
    } catch (e) {
      invoices
        .filter(inv => inv.administration_id === administrationId)
        .forEach(inv => { results[inv.invoice_number].errors.push('Impossible de joindre PAYT (contacts)'); });
    }
  }

  // ── Step 2: upsert debtors (deduplicated by debtor_number per administration) ──
  const debtorsByAdmin = {};
  invoices.forEach(inv => {
    const aid = inv.administration_id;
    if (!debtorsByAdmin[aid]) debtorsByAdmin[aid] = new Map();
    if (!debtorsByAdmin[aid].has(inv.debtor_number)) {
      debtorsByAdmin[aid].set(inv.debtor_number, {
        debtor_number:      inv.debtor_number,
        name:               inv.debtor_name,
        debtor_identifier:  inv.debtor_identifier || inv.debtor_number,
        contact_identifier: inv.debtor_identifier || inv.debtor_number,
        ...(inv.administration_name && { category:     inv.administration_name }),
        ...(inv.debtor_country_code && { country_code: inv.debtor_country_code }),
        ...(inv.debtor_vat_number   && { vat_number:   inv.debtor_vat_number }),
        ...(inv.debtor_is_company != null && { is_company: inv.debtor_is_company }),
      });
    }
  });

  for (const [administrationId, debtorMap] of Object.entries(debtorsByAdmin)) {
    const payload = { administration_id: administrationId, debtors: [...debtorMap.values()] };
    try {
      console.log(`[payt-push ${ts()}] DEBTOR payload:`, JSON.stringify(payload));
      const r = await fetchWithRetry(`${PAYT_BASE}/v1/debtors`, { method: 'POST', headers, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      console.log(`[payt-push ${ts()}] DEBTOR response`, r.status, JSON.stringify(data));
      if (!r.ok) {
        invoices
          .filter(inv => inv.administration_id === administrationId)
          .forEach(inv => {
            results[inv.invoice_number].errors.push(
              `Erreur débiteur [${r.status}]: ${data?.error?.message || data?.message || 'Erreur inconnue'}`
            );
          });
      }
    } catch (e) {
      invoices
        .filter(inv => inv.administration_id === administrationId)
        .forEach(inv => { results[inv.invoice_number].errors.push('Impossible de joindre PAYT (débiteurs)'); });
    }
  }

  // ── Step 3: create invoices (per administration) ──
  const invoicesByAdmin = {};
  invoices.forEach(inv => {
    if (!invoicesByAdmin[inv.administration_id]) invoicesByAdmin[inv.administration_id] = [];
    invoicesByAdmin[inv.administration_id].push(inv);
  });

  for (const [administrationId, batch] of Object.entries(invoicesByAdmin)) {
    batch.forEach(inv => {
      const effectiveOpen = Math.max(0, parseFloat(inv.invoice_open_amount_inc_vat) || 0);
      const amountPaid    = parseFloat(inv.amount_paid) || 0;
      console.log(`[payt-push ${ts()}] invoice ${inv.invoice_number} — open=${effectiveOpen} amount_paid=${amountPaid} → payment=${effectiveOpen === 0 && amountPaid > 0 ? 'YES' : 'NO'}`);
    });

    const today = new Date().toISOString().slice(0, 10);

    const payload = {
      administration_id: administrationId,
      invoices: batch.map(inv => {
        // effectiveOpen is already reduced by amountPaid by the frontend (applyAmountPaid).
        // Send it directly — PAYT will show the invoice as partially paid.
        const effectiveOpen = Math.max(0, parseFloat(inv.invoice_open_amount_inc_vat) || 0);
        return {
          debtor_number:     inv.debtor_number,
          invoice_number:    inv.invoice_number,
          invoice_date:      inv.invoice_date,
          due_date:          inv.invoice_due_date,
          book_amount_total: String(parseFloat(inv.invoice_total_amount_inc_vat) || 0),
          amount_total:      String(parseFloat(inv.invoice_total_amount_inc_vat) || 0),
          book_amount_open:  String(effectiveOpen),
          amount_open:       String(effectiveOpen),
          currency_code:     inv.currency_code || 'EUR',
        };
      }),
    };

    try {
      console.log(`[payt-push ${ts()}] INVOICE payload:`, JSON.stringify(payload));
      const r = await fetchWithRetry(`${PAYT_BASE}/v1/invoices`, { method: 'POST', headers, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      console.log(`[payt-push ${ts()}] INVOICE response`, r.status, JSON.stringify(data));

      if (!r.ok && !data?.errors) {
        batch.forEach(inv => {
          results[inv.invoice_number].errors.push(
            `Erreur facture [${r.status}]: ${data?.error?.message || data?.message || 'Erreur inconnue'}`
          );
        });
      } else {
        batch.forEach(inv => {
          results[inv.invoice_number].errors.push(...(data?.errors?.[inv.invoice_number]   || []));
          results[inv.invoice_number].warnings.push(...(data?.warnings?.[inv.invoice_number] || []));
          if (!results[inv.invoice_number].errors.length) results[inv.invoice_number].success = true;
        });

        // ── Step 4: credit notes for "Clôturée" invoices ──
        const clotureeeBatch = batch.filter(inv =>
          inv.payt_status === 'Clôturée' && !results[inv.invoice_number].errors.length
        );
        console.log(`[payt-push ${ts()}] cloturee batch size: ${clotureeeBatch.length}`);

        for (const inv of clotureeeBatch) {
          // effectiveOpen is already reduced by amountPaid by the frontend (applyAmountPaid).
          // It represents the remaining balance after any partial payment — exactly the avoir amount.
          const effectiveOpen = Math.max(0, parseFloat(inv.invoice_open_amount_inc_vat) || 0);
          const amountPaid    = parseFloat(inv.amount_paid) || 0;
          const avoirAmount   = effectiveOpen; // = originalOpen - amountPaid (reduced by frontend)
          if (avoirAmount === 0) {
            console.log(`[payt-push ${ts()}] ${inv.invoice_number} — solde restant=0, pas d'avoir nécessaire`);
            continue;
          }
          const creditNumber = `AVOIR-${inv.invoice_number}`;
          console.log(`[payt-push ${ts()}] création avoir ${creditNumber} pour montant=${avoirAmount} (open=${effectiveOpen} paid=${amountPaid})`);

          try {
            // ── 4a: POST credit note invoice ──
            const cnPayload = {
              administration_id: administrationId,
              invoices: [{
                debtor_number:     inv.debtor_number,
                invoice_number:    creditNumber,
                invoice_date:      today,
                due_date:          today,
                book_amount_total: String(-avoirAmount),
                amount_total:      String(-avoirAmount),
                book_amount_open:  '0',
                amount_open:       '0',
                currency_code:     inv.currency_code || 'EUR',
              }],
            };
            console.log(`[payt-push ${ts()}] CREDIT NOTE payload:`, JSON.stringify(cnPayload));
            const cnr = await fetchWithRetry(`${PAYT_BASE}/v1/invoices`, { method: 'POST', headers, body: JSON.stringify(cnPayload) });
            const cndata = await cnr.json().catch(() => ({}));
            console.log(`[payt-push ${ts()}] CREDIT NOTE response`, cnr.status, JSON.stringify(cndata));

            const cnErrors = cndata?.errors?.[creditNumber] || [];
            if (!cnr.ok && !cndata?.errors) {
              results[inv.invoice_number].warnings.push(
                `Avoir non créé [${cnr.status}]: ${cndata?.error?.message || cndata?.message || 'Erreur inconnue'}`
              );
              continue;
            }
            if (cnErrors.length) {
              results[inv.invoice_number].warnings.push(`Avoir non créé: ${cnErrors.join(', ')}`);
              continue;
            }

            // ── 4b: re-POST original invoice with book_amount_open=0 to close it ──
            // /v1/payments returns 405; closing is done via upsert on POST /v1/invoices.
            const closePayload = {
              administration_id: administrationId,
              invoices: [{
                debtor_number:     inv.debtor_number,
                invoice_number:    inv.invoice_number,
                invoice_date:      inv.invoice_date,
                due_date:          inv.invoice_due_date,
                book_amount_total: String(parseFloat(inv.invoice_total_amount_inc_vat) || 0),
                amount_total:      String(parseFloat(inv.invoice_total_amount_inc_vat) || 0),
                book_amount_open:  '0',
                amount_open:       '0',
                currency_code:     inv.currency_code || 'EUR',
              }],
            };
            console.log(`[payt-push ${ts()}] CLOSE INVOICE payload:`, JSON.stringify(closePayload));
            const closeRes = await fetchWithRetry(`${PAYT_BASE}/v1/invoices`, { method: 'POST', headers, body: JSON.stringify(closePayload) });
            const closeData = await closeRes.json().catch(() => ({}));
            console.log(`[payt-push ${ts()}] CLOSE INVOICE response`, closeRes.status, JSON.stringify(closeData));

            const closeErrors = closeData?.errors?.[inv.invoice_number] || [];
            if ((!closeRes.ok && !closeData?.errors) || closeErrors.length) {
              results[inv.invoice_number].warnings.push(
                `Avoir créé (${creditNumber}) mais solde non soldé [${closeRes.status}]: ${closeErrors.join(', ') || closeData?.error?.message || closeData?.message || 'Erreur inconnue'}`
              );
            } else {
              results[inv.invoice_number].credit_note = creditNumber;
            }
          } catch (e) {
            results[inv.invoice_number].warnings.push(`Erreur création avoir: ${e?.message || e}`);
          }
        }
      }
    } catch (e) {
      batch.forEach(inv => { results[inv.invoice_number].errors.push('Impossible de joindre PAYT (factures)'); });
    }
  }

  return res.status(200).json({ results });
}
