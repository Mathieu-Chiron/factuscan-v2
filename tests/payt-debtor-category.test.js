/**
 * tests/payt-debtor-category.test.js
 *
 * Tests for debtor category injection in api/payt-push.js.
 * When invoices are posted, each debtor must carry category = administration_name
 * (the name of the creditor / target company).
 *
 * Run: node tests/payt-debtor-category.test.js
 */

// ── Mock helpers ──────────────────────────────────────────────────────────────

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
    administration_name:          'Acme SA',
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
  console.log('\n=== payt-debtor-category tests ===\n');

  // ── 1. Catégorie portée par le débiteur ──────────────────────────────────────
  console.log('1. Catégorie injectée dans le payload debtors');

  await test('category = administration_name du payload', async () => {
    const calls = captureFetch([
      { ok: true, data: {} },             // contacts
      { ok: true, data: {} },             // debtors
      { ok: true, data: { errors: {} } }, // invoices
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ administration_name: 'Acme SA' })] } }), mockRes());
    const debtorCall = calls.find(c => c.url.includes('/v1/debtors'));
    assert(debtorCall, 'debtors call should exist');
    const debtor = debtorCall.body.debtors[0];
    assert(debtor.category === 'Acme SA', `Expected category "Acme SA", got "${debtor.category}"`);
  });

  await test('category absente si administration_name non fourni', async () => {
    const calls = captureFetch([
      { ok: true, data: {} },
      { ok: true, data: {} },
      { ok: true, data: { errors: {} } },
    ]);
    const inv = makeInvoice();
    delete inv.administration_name;
    await handler(mockReq({ body: { token: 'tok', invoices: [inv] } }), mockRes());
    const debtorCall = calls.find(c => c.url.includes('/v1/debtors'));
    const debtor = debtorCall.body.debtors[0];
    assert(!('category' in debtor), `category should not be set when administration_name is missing, got "${debtor.category}"`);
  });

  await test('category = chaîne vide → non incluse dans le payload', async () => {
    const calls = captureFetch([
      { ok: true, data: {} },
      { ok: true, data: {} },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ administration_name: '' })] } }), mockRes());
    const debtorCall = calls.find(c => c.url.includes('/v1/debtors'));
    const debtor = debtorCall.body.debtors[0];
    assert(!('category' in debtor), `category should not be set when administration_name is empty string`);
  });

  // ── 2. Même catégorie pour tous les débiteurs d'une même admin ────────────────
  console.log('\n2. Tous les débiteurs d\'une même admin reçoivent la même catégorie');

  await test('2 débiteurs, même admin → même category sur les deux', async () => {
    const calls = captureFetch([
      { ok: true, data: {} },
      { ok: true, data: {} },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [
      makeInvoice({ invoice_number: 'FAC-A', debtor_number: 'DEB001', debtor_identifier: 'DEB001', administration_name: 'Acme SA' }),
      makeInvoice({ invoice_number: 'FAC-B', debtor_number: 'DEB002', debtor_identifier: 'DEB002', administration_name: 'Acme SA' }),
    ] } }), mockRes());
    const debtorCall = calls.find(c => c.url.includes('/v1/debtors'));
    const debtors = debtorCall.body.debtors;
    assert(debtors.length === 2, `Expected 2 debtors, got ${debtors.length}`);
    assert(debtors[0].category === 'Acme SA', `Debtor 0 category: expected "Acme SA", got "${debtors[0].category}"`);
    assert(debtors[1].category === 'Acme SA', `Debtor 1 category: expected "Acme SA", got "${debtors[1].category}"`);
  });

  await test('débiteur dédupliqué → category toujours présente', async () => {
    const calls = captureFetch([
      { ok: true, data: {} },
      { ok: true, data: {} },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [
      makeInvoice({ invoice_number: 'FAC-A', debtor_number: 'DEB001', administration_name: 'Acme SA' }),
      makeInvoice({ invoice_number: 'FAC-B', debtor_number: 'DEB001', administration_name: 'Acme SA' }),
    ] } }), mockRes());
    const debtorCall = calls.find(c => c.url.includes('/v1/debtors'));
    assert(debtorCall.body.debtors.length === 1, 'debtors should be deduplicated');
    assert(debtorCall.body.debtors[0].category === 'Acme SA');
  });

  // ── 3. Catégories distinctes par administration ───────────────────────────────
  console.log('\n3. Catégories distinctes selon l\'administration');

  await test('2 admins → chaque debtor porte le nom de sa propre admin', async () => {
    const calls = captureFetch(Array(6).fill({ ok: true, data: { errors: {} } }));
    await handler(mockReq({ body: { token: 'tok', invoices: [
      makeInvoice({ invoice_number: 'FAC-A', administration_id: 'admin_1', administration_name: 'Acme SA' }),
      makeInvoice({ invoice_number: 'FAC-B', administration_id: 'admin_2', administration_name: 'Beta Corp', debtor_number: 'DEB002', debtor_identifier: 'DEB002' }),
    ] } }), mockRes());
    const debtorCalls = calls.filter(c => c.url.includes('/v1/debtors'));
    assert(debtorCalls.length === 2, `Expected 2 debtors calls, got ${debtorCalls.length}`);
    const admin1Debtor = debtorCalls.find(c => c.body.administration_id === 'admin_1').body.debtors[0];
    const admin2Debtor = debtorCalls.find(c => c.body.administration_id === 'admin_2').body.debtors[0];
    assert(admin1Debtor.category === 'Acme SA',   `admin_1 category: expected "Acme SA", got "${admin1Debtor.category}"`);
    assert(admin2Debtor.category === 'Beta Corp', `admin_2 category: expected "Beta Corp", got "${admin2Debtor.category}"`);
  });

  await test('category préservée avec noms longs et caractères spéciaux', async () => {
    const longName = 'Société Anonyme des Travaux Publics & Associés (S.A.T.P.A)';
    const calls = captureFetch([
      { ok: true, data: {} },
      { ok: true, data: {} },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ administration_name: longName })] } }), mockRes());
    const debtorCall = calls.find(c => c.url.includes('/v1/debtors'));
    assert(debtorCall.body.debtors[0].category === longName, `Expected full name, got "${debtorCall.body.debtors[0].category}"`);
  });

  // ── 4. La catégorie n'affecte pas les autres étapes ──────────────────────────
  console.log('\n4. Impact sur les autres étapes du pipeline');

  await test('category n\'apparaît pas dans le payload contacts', async () => {
    const calls = captureFetch([
      { ok: true, data: {} },
      { ok: true, data: {} },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ administration_name: 'Acme SA' })] } }), mockRes());
    const contactCall = calls.find(c => c.url.includes('/v1/contacts'));
    assert(!('category' in contactCall.body.contacts[0]), 'category should not be in contacts payload');
  });

  await test('category n\'apparaît pas dans le payload invoices', async () => {
    const calls = captureFetch([
      { ok: true, data: {} },
      { ok: true, data: {} },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ administration_name: 'Acme SA' })] } }), mockRes());
    const invoiceCall = calls.find(c => c.url.includes('/v1/invoices'));
    assert(!('category' in invoiceCall.body.invoices[0]), 'category should not be in invoices payload');
  });

  await test('category présente → résultat success=true inchangé', async () => {
    captureFetch([
      { ok: true, data: {} },
      { ok: true, data: {} },
      { ok: true, data: { errors: {} } },
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', invoices: [makeInvoice({ administration_name: 'Acme SA' })] } }), res);
    assert(res._body?.results?.['FAC-001']?.success === true, 'Invoice should succeed with category set');
  });

  // ── Résumé ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Résultat : ${passed} passé(s), ${failed} échoué(s)`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
