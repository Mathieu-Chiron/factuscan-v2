// api/payt-push.js
// Pushes invoices (+ contacts + debtors) to PAYT in three batch steps:
//   1. POST /v1/contacts — upsert contacts with address (deduplicated by contact_identifier)
//   2. POST /v1/debtors  — link contacts to administration as debtors
//   3. POST /v1/invoices — create invoices linked by debtor_number
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

const PAYT_BASE = process.env.PAYT_PROXY_URL || 'https://api.paytsoftware.com/api';
const PROXY_SECRET = process.env.PROXY_SECRET;
const ts = () => new Date().toISOString().replace('T',' ').slice(0,19);

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
  invoices.forEach(inv => { results[inv.invoice_number] = { success: false, errors: [], warnings: [] }; });

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
      const r = await fetch(`${PAYT_BASE}/v1/contacts`, { method: 'POST', headers, body: JSON.stringify(payload) });
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
      const r = await fetch(`${PAYT_BASE}/v1/debtors`, { method: 'POST', headers, body: JSON.stringify(payload) });
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
    const payload = {
      administration_id: administrationId,
      invoices: batch.map(inv => ({
        debtor_number:     inv.debtor_number,
        invoice_number:    inv.invoice_number,
        invoice_date:      inv.invoice_date,
        due_date:          inv.invoice_due_date,
        book_amount_total: String(inv.invoice_total_amount_inc_vat),
        amount_total:      String(inv.invoice_total_amount_inc_vat),
        book_amount_open:  String(inv.invoice_open_amount_inc_vat),
        amount_open:       String(inv.invoice_open_amount_inc_vat),
        currency_code:     inv.currency_code || 'EUR',
      })),
    };

    try {
      console.log(`[payt-push ${ts()}] INVOICE payload:`, JSON.stringify(payload));
      const r = await fetch(`${PAYT_BASE}/v1/invoices`, { method: 'POST', headers, body: JSON.stringify(payload) });
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
          const invErrors   = data?.errors?.[inv.invoice_number]   || [];
          const invWarnings = data?.warnings?.[inv.invoice_number] || [];
          results[inv.invoice_number].errors.push(...invErrors);
          results[inv.invoice_number].warnings.push(...invWarnings);
          if (!results[inv.invoice_number].errors.length) {
            results[inv.invoice_number].success = true;
          }
        });
      }
    } catch (e) {
      batch.forEach(inv => { results[inv.invoice_number].errors.push('Impossible de joindre PAYT (factures)'); });
    }
  }

  return res.status(200).json({ results });
}
