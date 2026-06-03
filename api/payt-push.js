// api/payt-push.js
// Pushes invoices (+ debtors) to PAYT in two batch steps:
//   1. POST /v1/debtors  — upsert debtors (deduplicated)
//   2. POST /v1/invoices — create invoices linked by debtor_number
//
// Expected body:
// {
//   token: string,
//   invoices: [{
//     // invoice fields
//     invoice_number, invoice_date, invoice_due_date,
//     invoice_total_amount_inc_vat, invoice_open_amount_inc_vat,
//     currency_code?,
//     // debtor fields
//     debtor_number, debtor_name, debtor_identifier,
//     debtor_country_code?, debtor_vat_number?, debtor_is_company?,
//     // target
//     administration_id
//   }]
// }

const PAYT_BASE = 'https://api.paytsoftware.com/api';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, invoices } = req.body || {};
  if (!token) return res.status(400).json({ error: 'missing_token' });
  if (!Array.isArray(invoices) || !invoices.length) return res.status(400).json({ error: 'missing_invoices' });

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const results = {};
  invoices.forEach(inv => { results[inv.invoice_number] = { success: false, errors: [], warnings: [] }; });

  // ── Step 1: upsert debtors (deduplicated by debtor_number per administration) ──
  const debtorsByAdmin = {};
  invoices.forEach(inv => {
    const aid = inv.administration_id;
    if (!debtorsByAdmin[aid]) debtorsByAdmin[aid] = new Map();
    if (!debtorsByAdmin[aid].has(inv.debtor_number)) {
      debtorsByAdmin[aid].set(inv.debtor_number, {
        debtor_number:     inv.debtor_number,
        name:              inv.debtor_name,
        debtor_identifier: inv.debtor_identifier || inv.debtor_number,
        ...(inv.debtor_country_code && { country_code: inv.debtor_country_code }),
        ...(inv.debtor_vat_number   && { vat_number:   inv.debtor_vat_number }),
        ...(inv.debtor_is_company != null && { is_company: inv.debtor_is_company }),
      });
    }
  });

  for (const [administrationId, debtorMap] of Object.entries(debtorsByAdmin)) {
    const payload = { administration_id: administrationId, debtors: [...debtorMap.values()] };
    try {
      const r = await fetch(`${PAYT_BASE}/v1/debtors`, { method: 'POST', headers, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        // Mark all invoices for this admin as failed at debtor step
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

  // ── Step 2: create invoices (per administration) ──
  const invoicesByAdmin = {};
  invoices.forEach(inv => {
    if (!invoicesByAdmin[inv.administration_id]) invoicesByAdmin[inv.administration_id] = [];
    invoicesByAdmin[inv.administration_id].push(inv);
  });

  for (const [administrationId, batch] of Object.entries(invoicesByAdmin)) {
    // Skip batch if all invoices already have debtor errors
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
      const r = await fetch(`${PAYT_BASE}/v1/invoices`, { method: 'POST', headers, body: JSON.stringify(payload) });
      const data = await r.json().catch(() => ({}));

      if (!r.ok && !data?.errors) {
        batch.forEach(inv => {
          results[inv.invoice_number].errors.push(
            `Erreur facture [${r.status}]: ${data?.error?.message || data?.message || 'Erreur inconnue'}`
          );
        });
      } else {
        // PAYT returns per-invoice errors keyed by invoice_number
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
