/**
 * tests/payt-invoices-update.test.js
 *
 * Unit tests for api/payt-invoices-update.js
 * Tests: validation, amount calculation, avoir (credit note) creation.
 *
 * Run: node tests/payt-invoices-update.test.js
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

function makeUpdate(overrides = {}) {
  return {
    administration_id: 'admin_1',
    invoice_number:    'FAC-001',
    debtor_number:     'DEB001',
    invoice_date:      '2026-01-01',
    due_date:          '2026-02-01',
    total_amount:      '1000',
    open_amount:       '1000',
    currency_code:     'EUR',
    new_status:        'En cours',
    amount_paid:       '0',
    payment_date:      '2026-03-01',
    ...overrides,
  };
}

// Captures all fetch calls made during a test
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

const { default: handler } = await import('../api/payt-invoices-update.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n=== payt-invoices-update tests ===\n');

  // ── 1. Validation ───────────────────────────────────────────────────────────
  console.log('1. Validation des entrées');

  await test('retourne 405 si méthode GET', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    assert(res._status === 405, `Expected 405, got ${res._status}`);
  });

  await test('retourne 400 si token manquant', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { updates: [makeUpdate()] } }), res);
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert(res._body?.error === 'missing_token');
  });

  await test('retourne 400 si updates manquant', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert(res._body?.error === 'missing_updates');
  });

  await test('retourne 400 si updates tableau vide', async () => {
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', updates: [] } }), res);
    assert(res._status === 400);
  });

  // ── 2. Calcul des montants ──────────────────────────────────────────────────
  console.log('\n2. Calcul des montants envoyés à PAYT');

  await test('Payée : book_amount_open = 0', async () => {
    const calls = captureFetch([{ ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'Payée', open_amount: '800', amount_paid: '800' })] } }), mockRes());
    const inv = calls[0].body.invoices[0];
    assert(inv.book_amount_open === '0', `Expected 0, got ${inv.book_amount_open}`);
    assert(inv.amount_open === '0');
  });

  await test('Clôturée : book_amount_open = 0', async () => {
    const calls = captureFetch([{ ok: true, data: { errors: {} } }, { ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'Clôturée', open_amount: '500', amount_paid: '0' })] } }), mockRes());
    const inv = calls[0].body.invoices[0];
    assert(inv.book_amount_open === '0', `Expected 0, got ${inv.book_amount_open}`);
  });

  await test('paiement partiel : book_amount_open = open - paid', async () => {
    const calls = captureFetch([{ ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'En cours', open_amount: '1000', amount_paid: '300' })] } }), mockRes());
    const inv = calls[0].body.invoices[0];
    assert(inv.book_amount_open === '700', `Expected 700, got ${inv.book_amount_open}`);
  });

  await test('paiement partiel : book_amount_open ne peut pas être négatif', async () => {
    const calls = captureFetch([{ ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'En cours', open_amount: '100', amount_paid: '500' })] } }), mockRes());
    const inv = calls[0].body.invoices[0];
    assert(inv.book_amount_open === '0', `Expected 0 (floor), got ${inv.book_amount_open}`);
  });

  // ── 3. Avoir (Clôturée) ─────────────────────────────────────────────────────
  console.log('\n3. Création de l\'avoir (Clôturée)');

  await test('Clôturée sans paiement : crée avoir = open_amount', async () => {
    const calls = captureFetch([
      { ok: true, data: { errors: {} } },  // POST /v1/invoices (update)
      { ok: true, data: { errors: {} } },  // POST /v1/invoices (credit note)
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'Clôturée', open_amount: '600', amount_paid: '0' })] } }), res);
    assert(calls.length === 2, `Expected 2 calls, got ${calls.length}`);
    const cn = calls[1].body.invoices[0];
    assert(cn.book_amount_total === '-600', `Expected -600, got ${cn.book_amount_total}`);
    assert(cn.book_amount_open === '0');
    assert(res._body?.results?.['FAC-001']?.credit_note, 'credit_note should be set');
  });

  await test('Clôturée avec paiement partiel : avoir = open - paid', async () => {
    const calls = captureFetch([
      { ok: true, data: { errors: {} } },
      { ok: true, data: { errors: {} } },
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'Clôturée', open_amount: '1000', amount_paid: '400' })] } }), res);
    const cn = calls[1].body.invoices[0];
    assert(cn.book_amount_total === '-600', `Expected -600, got ${cn.book_amount_total}`);
  });

  await test('Clôturée avec avoir = 0 : pas de 2ème appel PAYT', async () => {
    const calls = captureFetch([{ ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'Clôturée', open_amount: '0', amount_paid: '0' })] } }), mockRes());
    assert(calls.length === 1, `Expected 1 call (no credit note), got ${calls.length}`);
  });

  await test('credit note contient sent_at au format ISO 8601', async () => {
    const calls = captureFetch([
      { ok: true, data: { errors: {} } },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'Clôturée', open_amount: '500', amount_paid: '0' })] } }), mockRes());
    const cn = calls[1].body.invoices[0];
    assert(typeof cn.sent_at === 'string', 'sent_at doit être une chaîne');
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cn.sent_at), `sent_at doit être ISO 8601 UTC, got "${cn.sent_at}"`);
  });

  await test('sent_at absent sur la facture de mise à jour (non avoir)', async () => {
    const calls = captureFetch([{ ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'En cours', amount_paid: '200' })] } }), mockRes());
    const inv = calls[0].body.invoices[0];
    assert(!('sent_at' in inv), `sent_at ne doit pas être présent sur une facture normale`);
  });

  await test('numéro avoir contient le numéro de facture', async () => {
    const calls = captureFetch([
      { ok: true, data: { errors: {} } },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'Clôturée', open_amount: '500', amount_paid: '0' })] } }), mockRes());
    const cnNumber = calls[1].body.invoices[0].invoice_number;
    assert(cnNumber.includes('FAC-001'), `Credit note number should include invoice number, got ${cnNumber}`);
  });

  await test('numéro avoir = AVOIR-{invoice_number} (sans timestamp)', async () => {
    const calls = captureFetch([
      { ok: true, data: { errors: {} } },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'Clôturée', open_amount: '500', amount_paid: '0' })] } }), mockRes());
    const cnNumber = calls[1].body.invoices[0].invoice_number;
    assert(cnNumber === 'AVOIR-FAC-001', `Expected AVOIR-FAC-001, got ${cnNumber}`);
  });

  // ── 4. Erreurs upstream ─────────────────────────────────────────────────────
  console.log('\n4. Erreurs upstream PAYT');

  await test('erreur HTTP PAYT → success=false avec message', async () => {
    captureFetch([{ ok: false, status: 422, data: { message: 'Invalid data' } }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate()] } }), res);
    assert(res._status === 200);
    const r = res._body?.results?.['FAC-001'];
    assert(!r.success, 'Should not be success');
    assert(r.errors.length > 0, 'Should have errors');
  });

  await test('erreur PAYT avec errors[] par facture → success=false', async () => {
    captureFetch([{ ok: true, data: { errors: { 'FAC-001': ['Montant invalide'] } } }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate()] } }), res);
    const r = res._body?.results?.['FAC-001'];
    assert(!r.success);
    assert(r.errors.includes('Montant invalide'), `Expected error message, got ${r.errors}`);
  });

  await test('erreur réseau → success=false avec message impossible de joindre', async () => {
    globalThis.fetch = async () => { throw new Error('Network error'); };
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate()] } }), res);
    const r = res._body?.results?.['FAC-001'];
    assert(!r.success);
    assert(r.errors[0].includes('PAYT'), `Expected PAYT error, got ${r.errors[0]}`);
  });

  await test('échec avoir → warning sur la facture, pas d\'erreur bloquante', async () => {
    captureFetch([
      { ok: true, data: { errors: {} } },          // update OK
      { ok: false, status: 422, data: { message: 'CN error' } }, // avoir KO
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({ new_status: 'Clôturée', open_amount: '500', amount_paid: '0' })] } }), res);
    const r = res._body?.results?.['FAC-001'];
    assert(r.success, 'Invoice update should still succeed');
    assert(r.warnings.length > 0, 'Should have a warning about failed credit note');
  });

  // ── 5. Groupement par administration ────────────────────────────────────────
  console.log('\n5. Groupement par administration');

  await test('2 admins → 2 appels séparés à PAYT', async () => {
    const calls = captureFetch([
      { ok: true, data: { errors: {} } },
      { ok: true, data: { errors: {} } },
    ]);
    await handler(mockReq({ body: { token: 'tok', updates: [
      makeUpdate({ administration_id: 'admin_1', invoice_number: 'FAC-A' }),
      makeUpdate({ administration_id: 'admin_2', invoice_number: 'FAC-B' }),
    ] } }), mockRes());
    assert(calls.length === 2, `Expected 2 calls, got ${calls.length}`);
    const adminIds = calls.map(c => c.body.administration_id);
    assert(adminIds.includes('admin_1') && adminIds.includes('admin_2'));
  });

  await test('2 factures même admin → 1 seul appel PAYT avec 2 factures', async () => {
    const calls = captureFetch([{ ok: true, data: { errors: {} } }]);
    await handler(mockReq({ body: { token: 'tok', updates: [
      makeUpdate({ invoice_number: 'FAC-A' }),
      makeUpdate({ invoice_number: 'FAC-B' }),
    ] } }), mockRes());
    assert(calls.length === 1, `Expected 1 call, got ${calls.length}`);
    assert(calls[0].body.invoices.length === 2);
  });

  // ── 6. Cas 10 — Scénario deux phases ────────────────────────────────────────
  console.log('\n6. Cas 10 — Scénario deux phases (push partiel → invoice-edit Clôturée)');

  await test('Cas 10b — Phase 2 : Clôturée via invoice-edit, solde restant=600, avoir=-600', async () => {
    // Phase 1 (push) : total=1000, amountPaid=400, book_amount_open=600 envoyé à PAYT
    // Phase 2 (invoice-edit) : l'utilisateur voit open_amount=600, entre amount_paid=0,
    // marque Clôturée → avoir = open_amount - amount_paid = 600 - 0 = 600
    const calls = captureFetch([
      { ok: true, data: { errors: {} } },  // POST /v1/invoices (update open→0)
      { ok: true, data: { errors: {} } },  // POST /v1/invoices (credit note -600)
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok', updates: [makeUpdate({
      new_status:  'Clôturée',
      open_amount: '600',
      amount_paid: '0',
    })] } }), res);
    assert(calls.length === 2, `Expected 2 calls, got ${calls.length}`);
    const inv = calls[0].body.invoices[0];
    assert(inv.book_amount_open === '0', `Invoice doit être soldée (open=0), got ${inv.book_amount_open}`);
    const cn = calls[1].body.invoices[0];
    assert(cn.book_amount_total === '-600', `Avoir doit être -600, got ${cn.book_amount_total}`);
    assert(cn.book_amount_open  === '0',   `Avoir doit avoir open=0`);
    assert(res._body?.results?.['FAC-001']?.credit_note, 'credit_note doit être renseigné');
  });

  // ── Résumé ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Résultat : ${passed} passé(s), ${failed} échoué(s)`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
