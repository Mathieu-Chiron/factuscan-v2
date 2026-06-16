/**
 * tests/payt-invoices-create.test.js
 *
 * Unit tests for api/payt-invoices-create.js
 * Tests: validation, debtor creation step, invoice creation step, field mapping.
 *
 * Run: node tests/payt-invoices-create.test.js
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
    administration_id:    'admin_1',
    invoice_number:       'FAC-001',
    debtor_number:        'DEB001',
    invoice_date:         '2026-01-01',
    due_date:             '2026-02-01',
    total_amount:         '1000',
    open_amount:          '1000',
    currency_code:        'EUR',
    debtor_lastname:      'Dupont',
    debtor_post_street_1: '1 rue de la Paix',
    debtor_post_postalcode: '75001',
    debtor_post_city:     'Paris',
    debtor_post_country_code: 'FR',
    ...overrides,
  };
}

function captureFetch(responses) {
  const calls = [];
  let i = 0;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null });
    const resp = responses[i++] || { ok: true, status: 200, data: {} };
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

const { default: handler } = await import('../api/payt-invoices-create.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n=== payt-invoices-create tests ===\n');

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

  await test('retourne 400 si invoices tableau vide', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', invoices: [] } }), res);
    assert(res._status === 400);
  });

  // ── 2. Ordre des appels : debtors avant invoices ─────────────────────────────
  console.log('\n2. Ordre des appels PAYT (debtors → invoices)');

  await test('fait 2 appels : POST /v1/debtors puis POST /v1/invoices', async () => {
    const calls = captureFetch([
      { ok: true, data: {} },            // debtors
      { ok: true, data: { errors: {} } }, // invoices
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), mockRes());
    assert(calls.length === 2, `Expected 2 calls, got ${calls.length}`);
    assert(calls[0].url.includes('/v1/debtors'), `First call should be /v1/debtors, got ${calls[0].url}`);
    assert(calls[1].url.includes('/v1/invoices'), `Second call should be /v1/invoices, got ${calls[1].url}`);
  });

  await test('payload debtors contient debtor_number et champs adresse', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), mockRes());
    const d = calls[0].body.debtors[0];
    assert(d.debtor_number === 'DEB001');
    assert(d.debtor_lastname === 'Dupont');
    assert(d.debtor_post_city === 'Paris');
  });

  await test('payload debtors contient administration_id', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), mockRes());
    assert(calls[0].body.administration_id === 'admin_1');
  });

  await test('si debtors échoue, continue quand même avec invoices', async () => {
    const calls = captureFetch([
      { ok: false, status: 422, data: { message: 'debtor error' } }, // debtors KO
      { ok: true, data: { errors: {} } },                             // invoices OK
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), res);
    assert(calls.length === 2, 'Should still call /v1/invoices after debtor failure');
    assert(res._body?.results?.['FAC-001']?.success === true);
  });

  // ── 3. Mapping des champs invoice ───────────────────────────────────────────
  console.log('\n3. Mapping des champs invoice');

  await test('invoice payload : book_amount_total = total_amount', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ total_amount: '1500.50' })] } }), mockRes());
    const inv = calls[1].body.invoices[0];
    assert(inv.book_amount_total === '1500.5', `Expected 1500.5, got ${inv.book_amount_total}`);
    assert(inv.amount_total === '1500.5');
  });

  await test('invoice payload : book_amount_open = open_amount', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ open_amount: '750' })] } }), mockRes());
    const inv = calls[1].body.invoices[0];
    assert(inv.book_amount_open === '750', `Expected 750, got ${inv.book_amount_open}`);
    assert(inv.amount_open === '750');
  });

  await test('invoice payload contient invoice_number, debtor_number, dates', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), mockRes());
    const inv = calls[1].body.invoices[0];
    assert(inv.invoice_number === 'FAC-001');
    assert(inv.debtor_number === 'DEB001');
    assert(inv.invoice_date === '2026-01-01');
    assert(inv.due_date === '2026-02-01');
  });

  await test('currency_code par défaut = EUR', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ currency_code: undefined })] } }), mockRes());
    assert(calls[1].body.invoices[0].currency_code === 'EUR');
  });

  // ── 4. Résultats par facture ─────────────────────────────────────────────────
  console.log('\n4. Résultats par facture');

  await test('succès PAYT → { success: true }', async () => {
    captureFetch([{ ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), res);
    assert(res._body?.results?.['FAC-001']?.success === true);
  });

  await test('erreurs PAYT par facture → { success: false, error }', async () => {
    captureFetch([{ ok: true, data: {} }, { ok: true, data: { errors: { 'FAC-001': ['debtor_not_found'] } } }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), res);
    const r = res._body?.results?.['FAC-001'];
    assert(!r.success);
    assert(r.error.includes('debtor_not_found'), `Expected debtor_not_found in error, got ${r.error}`);
  });

  await test('erreur HTTP sans errors[] → { success: false }', async () => {
    captureFetch([{ ok: true, data: {} }, { ok: false, status: 500, data: { message: 'Server error' } }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), res);
    assert(!res._body?.results?.['FAC-001']?.success);
  });

  await test('erreur réseau → { success: false }', async () => {
    let i = 0;
    globalThis.fetch = async () => {
      if (i++ === 0) return { ok: true, status: 200, json: async () => ({}) }; // debtors OK
      throw new Error('Network error'); // invoices KO
    };
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice()] } }), res);
    assert(!res._body?.results?.['FAC-001']?.success);
  });

  // ── 5. Groupement par administration ────────────────────────────────────────
  console.log('\n5. Groupement par administration');

  await test('2 admins → 4 appels (2×debtors + 2×invoices)', async () => {
    const calls = captureFetch([
      { ok: true, data: {} }, { ok: true, data: { errors: {} } },
      { ok: true, data: {} }, { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [
      makeInvoice({ administration_id: 'admin_1', invoice_number: 'FAC-A' }),
      makeInvoice({ administration_id: 'admin_2', invoice_number: 'FAC-B' }),
    ] } }), mockRes());
    assert(calls.length === 4, `Expected 4 calls, got ${calls.length}`);
  });

  await test('2 factures même admin → 1 appel debtors + 1 appel invoices', async () => {
    const calls = captureFetch([{ ok: true, data: {} }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', invoices: [
      makeInvoice({ invoice_number: 'FAC-A' }),
      makeInvoice({ invoice_number: 'FAC-B' }),
    ] } }), mockRes());
    assert(calls.length === 2, `Expected 2 calls, got ${calls.length}`);
    assert(calls[1].body.invoices.length === 2);
  });

  // ── Résumé ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Résultat : ${passed} passé(s), ${failed} échoué(s)`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
