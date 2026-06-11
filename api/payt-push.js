// api/payt-push.js
// Pushes invoices (+ contacts + debtors) to PAYT in up to 5 steps:
//   1. POST /v1/contacts — upsert contacts with address (deduplicated by contact_identifier)
//   2. POST /v1/debtors  — link contacts to administration as debtors
//   3. POST /v1/invoices — create invoices
//   4. PUT  /v1/payments — record payment if amountPaid > 0 (partial or full)
//   5. POST /v1/invoices + PUT /v1/payments — credit note (avoir) for Clôturée invoices
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

async function fetchWithRetry(url, opts, maxRetries = 3) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await fetch(url, opts);
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

        // ── Step 4: PUT /v1/payments — dès que amountPaid > 0 (partiel ou total) ──
        batch.forEach(inv => {
          const effectiveOpen = Math.max(0, parseFloat(inv.invoice_open_amount_inc_vat) || 0);
          const amountPaid    = parseFloat(inv.amount_paid) || 0;
          console.log(`[payt-push ${ts()}] payment check ${inv.invoice_number}: open=${effectiveOpen} paid=${amountPaid} errors=${results[inv.invoice_number].errors.length}`);
        });
        const paidBatch = batch.filter(inv =>
          (parseFloat(inv.amount_paid) || 0) > 0
          && !results[inv.invoice_number].errors.length
        );
        console.log(`[payt-push ${ts()}] paidBatch size: ${paidBatch.length}`);

        for (const inv of paidBatch) {
          try {
            // GET invoice to retrieve PAYT internal id
            const getUrl = `${PAYT_BASE}/v1/invoices?administration_id=${encodeURIComponent(administrationId)}`;
            const gr = await fetchWithRetry(getUrl, { method: 'GET', headers });
            const gdata = await gr.json().catch(() => ({}));
            console.log(`[payt-push ${ts()}] GET invoice ${inv.invoice_number}:`, gr.status, JSON.stringify(gdata));

            // Probe common response shapes for the internal id
            const list = gdata?.data ?? gdata?.invoices ?? (Array.isArray(gdata) ? gdata : []);
            const found = list.find?.(i => i.invoice_number === inv.invoice_number);
            const paytId = found?.id ?? found?.invoice_id;
            console.log(`[payt-push ${ts()}] invoice_id for ${inv.invoice_number}: ${paytId ?? 'NOT FOUND'}`);

            if (!paytId) {
              results[inv.invoice_number].warnings.push('Paiement non enregistré : ID PAYT introuvable');
              continue;
            }

            const pmPayload = {
              administration_id: administrationId,
              payments: [{
                invoice_id:        paytId,
                amount:            String(parseFloat(inv.amount_paid)),
                book_amount:       String(parseFloat(inv.amount_paid)),
                origin_identifier: `PAY-${inv.invoice_number}`,
                cost_type:         'principal',
                transaction_type:  'credit',
                payment_date:      today,
              }],
            };
            console.log(`[payt-push ${ts()}] PAYMENT payload:`, JSON.stringify(pmPayload));
            const pr = await fetchWithRetry(`${PAYT_BASE}/v1/payments`, { method: 'PUT', headers, body: JSON.stringify(pmPayload) });
            const pdata = await pr.json().catch(() => ({}));
            console.log(`[payt-push ${ts()}] PAYMENT response`, pr.status, JSON.stringify(pdata));
            if (!pr.ok) {
              results[inv.invoice_number].warnings.push(
                `Paiement non enregistré [${pr.status}]: ${pdata?.error?.message || pdata?.message || 'Erreur inconnue'}`
              );
            }
          } catch (e) {
            results[inv.invoice_number].warnings.push('Impossible d\'enregistrer le paiement sur PAYT');
          }
        }

        // ── Step 5: credit notes for "Clôturée" invoices ──
        const clotureeeBatch = batch.filter(inv =>
          inv.payt_status === 'Clôturée' && !results[inv.invoice_number].errors.length
        );
        console.log(`[payt-push ${ts()}] cloturee batch size: ${clotureeeBatch.length}`);

        for (const inv of clotureeeBatch) {
          const effectiveOpen = Math.max(0, parseFloat(inv.invoice_open_amount_inc_vat) || 0);
          const amountPaid    = parseFloat(inv.amount_paid) || 0;
          // Montant de l'avoir = solde restant après déduction du paiement partiel éventuel
          const avoirAmount   = Math.max(0, Math.round((effectiveOpen - amountPaid) * 100) / 100);
          if (avoirAmount === 0) {
            console.log(`[payt-push ${ts()}] ${inv.invoice_number} — solde restant=0, pas d'avoir nécessaire`);
            continue;
          }
          const creditNumber = `AVOIR-${inv.invoice_number}`;
          console.log(`[payt-push ${ts()}] création avoir ${creditNumber} pour montant=${avoirAmount} (open=${effectiveOpen} paid=${amountPaid})`);

          try {
            // ── 5a: POST credit note invoice ──
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

            // ── 5b: GET original invoice PAYT id → PUT /v1/payments to zero it out ──
            const getUrl2 = `${PAYT_BASE}/v1/invoices?administration_id=${encodeURIComponent(administrationId)}`;
            const gr2 = await fetchWithRetry(getUrl2, { method: 'GET', headers });
            const gdata2 = await gr2.json().catch(() => ({}));
            console.log(`[payt-push ${ts()}] GET (avoir) invoice ${inv.invoice_number}:`, gr2.status);

            const list2 = gdata2?.data ?? gdata2?.invoices ?? (Array.isArray(gdata2) ? gdata2 : []);
            const found2 = list2.find?.(i => i.invoice_number === inv.invoice_number);
            const paytId2 = found2?.id ?? found2?.invoice_id;
            console.log(`[payt-push ${ts()}] invoice_id (avoir) for ${inv.invoice_number}: ${paytId2 ?? 'NOT FOUND'}`);

            if (!paytId2) {
              results[inv.invoice_number].warnings.push(`Avoir créé (${creditNumber}) mais solde original non soldé : ID PAYT introuvable`);
              continue;
            }

            const cn_pmPayload = {
              administration_id: administrationId,
              payments: [{
                invoice_id:        paytId2,
                amount:            String(avoirAmount),
                book_amount:       String(avoirAmount),
                origin_identifier: `AVOIR-${inv.invoice_number}`,
                cost_type:         'principal',
                transaction_type:  'credit',
                payment_date:      today,
              }],
            };
            console.log(`[payt-push ${ts()}] AVOIR PAYMENT payload:`, JSON.stringify(cn_pmPayload));
            const cn_pr = await fetchWithRetry(`${PAYT_BASE}/v1/payments`, { method: 'PUT', headers, body: JSON.stringify(cn_pmPayload) });
            const cn_pdata = await cn_pr.json().catch(() => ({}));
            console.log(`[payt-push ${ts()}] AVOIR PAYMENT response`, cn_pr.status, JSON.stringify(cn_pdata));

            if (!cn_pr.ok) {
              results[inv.invoice_number].warnings.push(
                `Avoir créé (${creditNumber}) mais solde non soldé [${cn_pr.status}]: ${cn_pdata?.error?.message || cn_pdata?.message || 'Erreur inconnue'}`
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
