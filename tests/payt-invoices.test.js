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

  // Helper: mock administrations + invoices sequence
  function mockAdminThenInvoices(adminIds, invoicePages) {
    const adminResponse = {
      ok: true, status: 200,
      body: { data: adminIds.map(id => ({ id })), pagination: { cursor: null } },
    };
    globalThis.fetch = async (url) => {
      if (url.includes('/administrations')) {
        return { ok: adminResponse.ok, status: adminResponse.status, json: async () => adminResponse.body };
      }
      const adminId = new URL(url).searchParams.get('administration_id');
      const pages = invoicePages[adminId] || [];
      const cursor = new URL(url).searchParams.get('cursor');
      const pageIdx = cursor ? parseInt(cursor.replace('c', '')) : 0;
      const page = pages[pageIdx] || { data: [], pagination: { cursor: null } };
      return { ok: true, status: 200, json: async () => page };
    };
  }

  await test('retourne 502 si /administrations répond 401', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Unauthorized' }) });
    const res = mockRes();
    await handler(mockReq({ body: { token: 'bad_token' } }), res);
    assert(res._status === 502, `Expected 502, got ${res._status}`);
    assert(res._body?.error === 'upstream_unreachable', `Wrong error: ${res._body?.error}`);
  });

  await test('retourne 200 avec factures vides si aucune administration', async () => {
    globalThis.fetch = async () => ({
      ok: true, status: 200,
      json: async () => ({ data: [], pagination: { cursor: null } }),
    });
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._status === 200, `Expected 200, got ${res._status}`);
    assert(res._body?.invoices?.length === 0, `Expected 0, got ${res._body?.invoices?.length}`);
  });

  await test('continue si une administration échoue (les autres sont retournées)', async () => {
    // admin_1 → OK, admin_2 → 403, admin_3 → OK
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (url.includes('/administrations')) {
        return { ok: true, status: 200, json: async () => ({
          data: [{ id: 'admin_1' }, { id: 'admin_2' }, { id: 'admin_3' }],
          pagination: { cursor: null },
        })};
      }
      const adminId = u.searchParams.get('administration_id');
      if (adminId === 'admin_2') return { ok: false, status: 403, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => makePage(5, null) };
    };
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._status === 200, `Expected 200, got ${res._status}`);
    assert(res._body?.invoices?.length === 10, `Expected 10 (5+0+5), got ${res._body?.invoices?.length}`);
  });

  // ── 3. Pagination ──────────────────────────────────────────────────────────
  console.log('\n3. Pagination');

  await test('retourne les factures d\'une seule admin, une seule page', async () => {
    mockAdminThenInvoices(['admin_1'], {
      admin_1: [{ data: makePage(42).data, pagination: { cursor: null } }],
    });
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._status === 200, `Expected 200, got ${res._status}`);
    assert(res._body?.invoices?.length === 42, `Expected 42, got ${res._body?.invoices?.length}`);
  });

  await test('s\'arrête si page sans curseur (même si pleine)', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/administrations')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'a1' }], pagination: { cursor: null } }) };
      return { ok: true, status: 200, json: async () => makePage(100, null) };
    };
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._body?.invoices?.length === 100, `Expected 100, got ${res._body?.invoices?.length}`);
  });

  await test('continue si page partielle mais avec curseur (pages non-uniformes)', async () => {
    let invoiceCall = 0;
    globalThis.fetch = async (url) => {
      if (url.includes('/administrations')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'a1' }], pagination: { cursor: null } }) };
      invoiceCall++;
      if (invoiceCall === 1) return { ok: true, status: 200, json: async () => makePage(47, 'cursor_next') };
      return { ok: true, status: 200, json: async () => makePage(30, null) };
    };
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._body?.invoices?.length === 77, `Expected 77, got ${res._body?.invoices?.length}`);
  });

  await test('cumule les factures de plusieurs administrations', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/administrations')) return { ok: true, status: 200, json: async () => ({
        data: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }], pagination: { cursor: null },
      })};
      return { ok: true, status: 200, json: async () => makePage(10, null) };
    };
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(res._body?.invoices?.length === 30, `Expected 30 (3×10), got ${res._body?.invoices?.length}`);
  });

  await test('envoie administration_id en query param pour chaque admin', async () => {
    const calledAdminIds = [];
    globalThis.fetch = async (url) => {
      if (url.includes('/administrations')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'adm_42' }], pagination: { cursor: null } }) };
      calledAdminIds.push(new URL(url).searchParams.get('administration_id'));
      return { ok: true, status: 200, json: async () => makePage(5, null) };
    };
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(calledAdminIds.length === 1, `Expected 1 invoice call, got ${calledAdminIds.length}`);
    assert(calledAdminIds[0] === 'adm_42', `Expected adm_42, got ${calledAdminIds[0]}`);
  });

  // ── 4. Format de la réponse ────────────────────────────────────────────────
  console.log('\n4. Format de la réponse');

  await test('retourne { invoices: [...] } avec les données PAYT intactes', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/administrations')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'a1' }], pagination: { cursor: null } }) };
      return { ok: true, status: 200, json: async () => makePage(2, null) };
    };
    const res = mockRes();
    await handler(mockReq({ body: { token: 'tok' } }), res);
    assert(Array.isArray(res._body?.invoices), 'invoices should be an array');
    assert('invoice_number' in res._body.invoices[0], 'Should contain invoice_number');
    assert('administration_id' in res._body.invoices[0], 'Should contain administration_id');
  });

  await test('retourne { invoices: [] } si admin sans factures', async () => {
    globalThis.fetch = async (url) => {
      if (url.includes('/administrations')) return { ok: true, status: 200, json: async () => ({ data: [{ id: 'a1' }], pagination: { cursor: null } }) };
      return { ok: true, status: 200, json: async () => ({ data: [], pagination: { cursor: null } }) };
    };
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
