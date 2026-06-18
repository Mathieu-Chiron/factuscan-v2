/**
 * tests/payt-push.test.js
 *
 * Unit tests for api/payt-push.js
 * Tests: contacts → debtors → invoices pipeline, credit notes (Clôturée), error resilience.
 *
 * Run: node tests/payt-push.test.js
 */

// ── Mock helpers ─────────────────────────────────────────────────────────────

function mockReq({ method = 'POST', body = {} } = {}) {
  return { method, body };
}

function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body  = body; return res; };
  return res;
}

function makeInvoice(overrides = {}) {
  return {
    administration_id:            'admin_1',
    invoice_number:               'FAC-001',
    invoice_date:                 '2026-01-01',
    invoice_due_date:             '2026-02-01',
    invoice_total_amount_inc_vat: '1000',
    invoice_open_amount_inc_vat:  '1000',
    currency_code:                'EUR',
    debtor_number:                'DEB001',
    debtor_name:                  'Dupont Jean',
    debtor_identifier:            'DEB001',
    debtor_lastname:              'Dupont',
    debtor_post_street_1:         '1 rue de la Paix',
    debtor_post_postalcode:       '75001',
    debtor_post_city:             'Paris',
    debtor_country_code:          'FR',
    payt_status:                  'En cours',
    amount_paid:                  '0',
    ...overrides,
  };
}

function captureFetch(responses) {
  const calls = [];
  let i = 0;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    const resp = responses[i++] || { ok: true, status: 200, data: { errors: {} } };
    return { ok: resp.ok ?? true, status: resp.status ?? 200, json: async () => resp.data ?? {} };
  };
  return calls;
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    → ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ── Load handler ──────────────────────────────────────────────────────────────

const { default: handler } = await import('../api/payt-push.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n=== payt-push tests ===\n');

  // ── 1. Validation ───────────────────────────────────────────────────────────
  console.log('1. Validation des entrées');

  await test('retourne 405 si méthode GET', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    assert(res._status === 405);
  });

  await test('retourne 400 si token manquant', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { invoices: [makeInvoice()] } }), res);
    assert(res._status === 400);
    assert(res._body?.error === 'missing_token');
  });

  await test('retourne 400 si invoices manquant', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._status === 400);
    assert(res._body?.error === 'missing_invoices');
  });

  // ── 2. Pipeline contacts → debtors → invoices ────────────────────────────────
  console.log('\n2. Pipeline 3 étapes (contacts → debtors → invoices)');

  await test('fait 3 appels dans l\'ordre : contacts, debtors, invoices', async () => {
    const calls = captureFetch([
      { ok: true, data: {} },             // contacts
      { ok: true, data: {} },             // debtors
      { ok: true, data: { errors: {} } }, // invoices
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), mockRes());
    assert(calls.length === 3, `Expected 3 calls, got ${calls.length}`);
    assert(calls[0].url.includes('/v1/contacts'), `Step 1 should be /v1/contacts`);
    assert(calls[1].url.includes('/v1/debtors'),  `Step 2 should be /v1/debtors`);
    assert(calls[2].url.includes('/v1/invoices'), `Step 3 should be /v1/invoices`);
  });

  await test('contact payload : contact_identifier = debtor_identifier', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), mockRes());
    const c = calls[0].body.contacts[0];
    assert(c.contact_identifier === 'DEB001', `Expected DEB001, got ${c.contact_identifier}`);
    assert(c.lastname === 'Dupont', `Expected Dupont, got ${c.lastname}`);
  });

  await test('debtor payload : debtor_number + contact_identifier + name', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), mockRes());
    const d = calls[1].body.debtors[0];
    assert(d.debtor_number === 'DEB001');
    assert(d.contact_identifier === 'DEB001');
    assert(d.name === 'Dupont Jean');
  });

  await test('invoice payload : book_amount_total = invoice_total_amount_inc_vat', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ invoice_total_amount_inc_vat: '2500' })] } }), mockRes());
    const inv = calls[2].body.invoices[0];
    assert(inv.book_amount_total === '2500', `Expected 2500, got ${inv.book_amount_total}`);
    assert(inv.amount_total === '2500');
  });

  await test('contacts dédupliqués par contact_identifier pour la même admin', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [
      makeInvoice({ invoice_number: 'FAC-A', debtor_identifier: 'DEB001' }),
      makeInvoice({ invoice_number: 'FAC-B', debtor_identifier: 'DEB001' }),
    ] } }), mockRes());
    assert(calls[0].body.contacts.length === 1, `Expected 1 deduplicated contact, got ${calls[0].body.contacts.length}`);
  });

  // ── 3. Avoir (Clôturée) ─────────────────────────────────────────────────────
  console.log('\n3. Avoir pour factures Clôturée');

  await test('Clôturée déclenche 2 appels supplémentaires (credit note + re-close)', async () => {
    const calls = captureFetch([
      { ok: true, data: {} },             // contacts
      { ok: true, data: {} },             // debtors
      { ok: true, data: { errors: {} } }, // invoices update
      { ok: true, data: { errors: {} } }, // credit note
      { ok: true, data: { errors: {} } }, // re-close original
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ payt_status: 'Clôturée', invoice_open_amount_inc_vat: '800' })] } }), mockRes());
    assert(calls.length === 5, `Expected 5 calls (contacts+debtors+invoices+cn+reclose), got ${calls.length}`);
    const cn = calls[3].body.invoices[0];
    assert(parseFloat(cn.book_amount_total) < 0, 'Credit note amount should be negative');
    assert(cn.book_amount_open === '0');
    // re-close: original invoice with book_amount_open=0
    const reclose = calls[4].body.invoices[0];
    assert(reclose.invoice_number === 'FAC-001');
    assert(reclose.book_amount_open === '0');
  });

  await test('avoir montant = open_amount quand amount_paid = 0', async () => {
    const calls = captureFetch([
      { ok: true, data: {} }, { ok: true, data: {} },
      { ok: true, data: { errors: {} } }, { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ payt_status: 'Clôturée', invoice_open_amount_inc_vat: '600', amount_paid: '0' })] } }), mockRes());
    const cn = calls[3].body.invoices[0];
    assert(cn.book_amount_total === '-600', `Expected -600, got ${cn.book_amount_total}`);
  });

  await test('Payée ne crée pas d\'avoir', async () => {
    const calls = captureFetch([
      { ok: true, data: {} }, { ok: true, data: {} },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ payt_status: 'Payée' })] } }), mockRes());
    assert(calls.length === 3, `Expected 3 calls (no credit note for Payée), got ${calls.length}`);
  });

  await test('Clôturée avec solde = 0 ne crée pas d\'avoir', async () => {
    const calls = captureFetch([
      { ok: true, data: {} }, { ok: true, data: {} },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ payt_status: 'Clôturée', invoice_open_amount_inc_vat: '0' })] } }), mockRes());
    assert(calls.length === 3, `Expected 3 calls (no credit note when open=0), got ${calls.length}`);
  });

  // ── 4. Résilience aux erreurs ────────────────────────────────────────────────
  console.log('\n4. Résilience aux erreurs');

  await test('échec contacts → warning, continue debtors + invoices', async () => {
    const calls = captureFetch([
      { ok: false, status: 422, data: { message: 'contact error' } }, // contacts KO
      { ok: true, data: {} },                                          // debtors OK
      { ok: true, data: { errors: {} } },                             // invoices OK
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), res);
    assert(calls.length === 3, 'Should still call debtors and invoices after contact failure');
    // Invoice result may have an error from contacts step
    const r = res._body?.results?.['FAC-001'];
    assert(r !== undefined, 'Should have result for FAC-001');
  });

  await test('erreur HTTP invoices → success=false', async () => {
    captureFetch([
      { ok: true, data: {} },
      { ok: true, data: {} },
      { ok: false, status: 500, data: { message: 'Server error' } },
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), res);
    assert(!res._body?.results?.['FAC-001']?.success);
  });

  await test('erreurs PAYT par invoice → success=false avec errors[]', async () => {
    captureFetch([
      { ok: true, data: {} }, { ok: true, data: {} },
      { ok: true, data: { errors: { 'FAC-001': ['Invalid invoice_date'] } } },
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), res);
    const r = res._body?.results?.['FAC-001'];
    assert(!r.success);
    assert(r.errors.includes('Invalid invoice_date'));
  });

  await test('succès PAYT → { success: true }', async () => {
    captureFetch([
      { ok: true, data: {} }, { ok: true, data: {} },
      { ok: true, data: { errors: {} } },
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), res);
    assert(res._body?.results?.['FAC-001']?.success === true);
  });

  // ── 5. Groupement par administration ────────────────────────────────────────
  console.log('\n5. Groupement par administration');

  await test('2 admins → 6 appels (2×contacts + 2×debtors + 2×invoices)', async () => {
    const calls = captureFetch(Array(6).fill({ ok: true, data: { errors: {} } }));
    await handler(mockReq({ body: { token: 'tok', invoices: [
      makeInvoice({ administration_id: 'admin_1', invoice_number: 'FAC-A' }),
      makeInvoice({ administration_id: 'admin_2', invoice_number: 'FAC-B' }),
    ] } }), mockRes());
    assert(calls.length === 6, `Expected 6 calls, got ${calls.length}`);
  });

  // ── 6. Calcul des montants — Cas 1, 2, 3, 5, 10a ───────────────────────────
  console.log('\n6. Calcul des montants (Cas 1, 2, 3, 5, 10a)');

  await test('Cas 1 — aucun paiement : book_amount_open = book_amount_total', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({
      invoice_total_amount_inc_vat: '1000',
      invoice_open_amount_inc_vat:  '1000',
      amount_paid: '0',
    })] } }), mockRes());
    const inv = calls[2].body.invoices[0];
    assert(inv.book_amount_open  === '1000', `Expected 1000, got ${inv.book_amount_open}`);
    assert(inv.book_amount_total === '1000');
    assert(inv.book_amount_open  === inv.book_amount_total, 'open doit égaler total sans paiement');
  });

  await test('Cas 2 — paiement partiel (réduit par le frontend) : book_amount_open = 600', async () => {
    // total=1000, amountPaid=400 appliqué par le frontend → invoice_open_amount_inc_vat=600
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({
      invoice_total_amount_inc_vat: '1000',
      invoice_open_amount_inc_vat:  '600',
      amount_paid: '400',
    })] } }), mockRes());
    const inv = calls[2].body.invoices[0];
    assert(inv.book_amount_open  === '600',  `Expected 600, got ${inv.book_amount_open}`);
    assert(inv.book_amount_total === '1000', `Expected 1000 total, got ${inv.book_amount_total}`);
  });

  await test('Cas 3 — paiement total : book_amount_open = 0', async () => {
    // total=1000, amountPaid=1000 appliqué par le frontend → invoice_open_amount_inc_vat=0
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({
      invoice_total_amount_inc_vat: '1000',
      invoice_open_amount_inc_vat:  '0',
      amount_paid: '1000',
    })] } }), mockRes());
    const inv = calls[2].body.invoices[0];
    assert(inv.book_amount_open  === '0',    `Expected 0, got ${inv.book_amount_open}`);
    assert(inv.book_amount_total === '1000', `Expected 1000 total, got ${inv.book_amount_total}`);
  });

  await test('Cas 5 — Clôturée + paiement partiel (frontend) : avoir = effectiveOpen = 600', async () => {
    // total=1000, amountPaid=400 → invoice_open_amount_inc_vat=600 → avoir=-600
    const calls = captureFetch([
      { ok: true, data: {} },             // contacts
      { ok: true, data: {} },             // debtors
      { ok: true, data: { errors: {} } }, // invoices
      { ok: true, data: { errors: {} } }, // credit note
      { ok: true, data: { errors: {} } }, // re-close
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({
      payt_status:                  'Clôturée',
      invoice_total_amount_inc_vat: '1000',
      invoice_open_amount_inc_vat:  '600',
      amount_paid: '400',
    })] } }), mockRes());
    assert(calls.length === 5, `Expected 5 calls, got ${calls.length}`);
    const cn = calls[3].body.invoices[0];
    assert(cn.book_amount_total === '-600', `Expected avoir=-600, got ${cn.book_amount_total}`);
    assert(cn.book_amount_open  === '0',   `Avoir book_amount_open doit être 0`);
    const reclose = calls[4].body.invoices[0];
    assert(reclose.book_amount_open === '0', 'Re-close doit avoir open=0');
  });

  await test('Cas 10a — Phase 1 (push partiel) : book_amount_open = 600 envoyé à PAYT', async () => {
    // Scénario deux phases : upload avec paiement partiel de 400 → PAYT voit open=600
    // Phase 2 (Clôturée via invoice-edit) testée dans payt-invoices-update.test.js
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({
      invoice_total_amount_inc_vat: '1000',
      invoice_open_amount_inc_vat:  '600',
      amount_paid: '400',
    })] } }), mockRes());
    const inv = calls[2].body.invoices[0];
    assert(inv.book_amount_open  === '600',  `Expected open=600, got ${inv.book_amount_open}`);
    assert(inv.book_amount_total === '1000', `Total doit rester 1000`);
  });

  // ── Résumé ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Résultat : ${passed} passé(s), ${failed} échoué(s)`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
