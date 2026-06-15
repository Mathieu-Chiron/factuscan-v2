/**
 * tests/payt-invoices.test.js
 *
 * Unit tests for api/payt-invoices-get.js
 * Tests pagination, error handling, and token validation.
 *
 * Run: node tests/payt-invoices.test.js
 */

// ── Mock helpers ────────────────────────────────────────────────────────────

function mockReq({ method = 'POST', body = {} } = {}) {
  return { method, body };
}

function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body  = body; return res; };
  return res;
}

function makePage(count, cursor = null) {
  return {
    data: Array.from({ length: count }, (_, i) => ({
      id: `inv_${Math.random().toString(36).slice(2)}`,
      invoice_number: `FAC-${1000 + i}`,
      administration_id: 'admin_1',
      total_amount: '100.00',
      open_amount: '50.00',
    })),
    pagination: { cursor },
  };
}

function mockFetchSequence(pages) {
  let call = 0;
  globalThis.fetch = async (url) => {
    const page = pages[call++];
    if (!page) throw new Error(`Unexpected fetch call #${call} to ${url}`);
    return {
      ok: page.ok ?? true,
      status: page.status ?? 200,
      json: async () => page.body,
    };
  };
}

// ── Test runner ─────────────────────────────────────────────────────────────

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

// ── Load handler ─────────────────────────────────────────────────────────────

const { default: handler } = await import('../api/payt-invoices-get.js');

// ── Tests ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n=== payt-invoices-get tests ===\n');

  // ── 1. Validation ──────────────────────────────────────────────────────────
  console.log('1. Validation des entrées');

  await test('retourne 405 si méthode GET', async () => {
    const res = mockRes();
    await handler(mockReq({ method: 'GET' }), res);
    assert(res._status === 405, `Expected 405, got ${res._status}`);
    assert(res._body?.error === 'Method not allowed', `Wrong error: ${res._body?.error}`);
  });

  await test('retourne 400 si token manquant', async () => {
    const res = mockRes();
    await handler(mockReq({ body: {} }), res);
    assert(res._status === 400, `Expected 400, got ${res._status}`);
    assert(res._body?.error === 'missing_token', `Wrong error: ${res._body?.error}`);
  });

  await test('retourne 400 si body absent', async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: null }, res);
    assert(res._status === 400, `Expected 400, got ${res._status}`);
  });

  // ── 2. Erreurs upstream ────────────────────────────────────────────────────
  console.log('\n2. Erreurs upstream PAYT');

  await test('retourne 502 si PAYT répond 401', async () => {
    mockFetchSequence([{ ok: false, status: 401, body: { message: 'Unauthorized' } }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'bad_token' } }), res);
    assert(res._status === 502, `Expected 502, got ${res._status}`);
    assert(res._body?.error === 'upstream_unreachable', `Wrong error: ${res._body?.error}`);
    assert(res._body?.message === 'Unauthorized', `Wrong message: ${res._body?.message}`);
  });

  await test('retourne 502 si PAYT répond 403', async () => {
    mockFetchSequence([{ ok: false, status: 403, body: { message: 'Forbidden' } }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'bad_token' } }), res);
    assert(res._status === 502, `Expected 502, got ${res._status}`);
  });

  await test('retourne 502 si PAYT répond 500 sans message', async () => {
    mockFetchSequence([{ ok: false, status: 500, body: {} }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._status === 502, `Expected 502, got ${res._status}`);
    assert(res._body?.message === 'HTTP 500', `Wrong fallback message: ${res._body?.message}`);
  });

  // ── 3. Pagination ──────────────────────────────────────────────────────────
  console.log('\n3. Pagination');

  await test('retourne les factures si une seule page (< 100 items)', async () => {
    const page = makePage(42);
    mockFetchSequence([{ body: page }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._status === 200, `Expected 200, got ${res._status}`);
    assert(res._body?.invoices?.length === 42, `Expected 42, got ${res._body?.invoices?.length}`);
  });

  await test('s\'arrête si page sans curseur (même si pleine)', async () => {
    const page = makePage(100, null); // 100 items, pas de curseur → dernière page
    mockFetchSequence([{ body: page }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._status === 200, `Expected 200, got ${res._status}`);
    assert(res._body?.invoices?.length === 100, `Expected 100, got ${res._body?.invoices?.length}`);
  });

  await test('continue si page partielle mais avec curseur (pages non-uniformes)', async () => {
    // PAYT peut retourner < 100 items sur une page intermédiaire avec un curseur
    mockFetchSequence([
      { body: makePage(47, 'cursor_next') }, // page partielle mais pas la dernière
      { body: makePage(30, null) },           // vraie dernière page
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._status === 200, `Expected 200, got ${res._status}`);
    assert(res._body?.invoices?.length === 77, `Expected 77, got ${res._body?.invoices?.length}`);
  });

  await test('pagine sur 3 pages et cumule toutes les factures', async () => {
    mockFetchSequence([
      { body: makePage(100, 'cursor_1') },
      { body: makePage(100, 'cursor_2') },
      { body: makePage(37,  null) },       // dernière page
    ]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._status === 200, `Expected 200, got ${res._status}`);
    assert(res._body?.invoices?.length === 237, `Expected 237, got ${res._body?.invoices?.length}`);
  });

  await test('passe le curseur en query param à la page suivante', async () => {
    const calledUrls = [];
    globalThis.fetch = async (url) => {
      calledUrls.push(url);
      const call = calledUrls.length;
      const body = call === 1 ? makePage(100, 'cursor_abc') : makePage(5, null);
      return { ok: true, status: 200, json: async () => body };
    };
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(calledUrls.length === 2, `Expected 2 calls, got ${calledUrls.length}`);
    assert(calledUrls[0].includes('per_page=100'), `Missing per_page: ${calledUrls[0]}`);
    assert(!calledUrls[0].includes('cursor='), `First call should not have cursor: ${calledUrls[0]}`);
    assert(calledUrls[1].includes('cursor=cursor_abc'), `Second call missing cursor: ${calledUrls[1]}`);
  });

  await test('n\'envoie pas administration_id dans la requête', async () => {
    const calledUrls = [];
    globalThis.fetch = async (url) => {
      calledUrls.push(url);
      return { ok: true, status: 200, json: async () => makePage(10, null) };
    };
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(!calledUrls[0].includes('administration_id'), `Should not filter by admin: ${calledUrls[0]}`);
  });

  // ── 4. Format de la réponse ────────────────────────────────────────────────
  console.log('\n4. Format de la réponse');

  await test('retourne { invoices: [...] } avec les données PAYT intactes', async () => {
    const page = makePage(2, null);
    mockFetchSequence([{ body: page }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(Array.isArray(res._body?.invoices), 'invoices should be an array');
    assert('invoice_number' in res._body.invoices[0], 'Should contain invoice_number');
    assert('administration_id' in res._body.invoices[0], 'Should contain administration_id');
  });

  await test('retourne { invoices: [] } si PAYT renvoie data vide', async () => {
    mockFetchSequence([{ body: { data: [], pagination: { cursor: null } } }]);
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._status === 200, `Expected 200, got ${res._status}`);
    assert(res._body?.invoices?.length === 0, `Expected 0, got ${res._body?.invoices?.length}`);
  });

  // ── Résumé ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Résultat : ${passed} passé(s), ${failed} échoué(s)`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
