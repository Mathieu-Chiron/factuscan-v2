/**
 * tests/extract-auth.test.js
 *
 * Unit tests for api/extract.js authentication gate.
 * Ensures the endpoint is no longer an open proxy to the Anthropic API:
 *   - no valid Clerk session  → 401, and Anthropic is never called
 *   - valid session (TEST_MODE bypass) → request is proxied as before
 *
 * Run: TEST_MODE=true node tests/extract-auth.test.js
 */

process.env.TEST_MODE = 'true';
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-test-key';

const { default: handler } = await import('../api/extract.js');

// ── Mock helpers ─────────────────────────────────────────────────────────────

function mockReq({ method = 'POST', body = {}, headers = {} } = {}) {
  return { method, body, headers };
}

function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body  = body; return res; };
  return res;
}

function captureFetch(response = { ok: true, status: 200, data: { content: [{ text: '{}' }] } }) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.data ?? {},
    };
  };
  return calls;
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}`); console.error(`    → ${e.message}`); failed++; }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('\nextract.js — authentication gate\n');

await test('rejects unauthenticated request with 401', async () => {
  const calls = captureFetch();
  const req = mockReq({ headers: {}, body: { messages: [] } });
  const res = mockRes();
  await handler(req, res);
  assert(res._status === 401, `expected 401, got ${res._status}`);
  assert(calls.length === 0, 'Anthropic API must NOT be called without auth');
});

await test('rejects non-POST method with 405', async () => {
  const calls = captureFetch();
  const req = mockReq({ method: 'GET', headers: { 'x-test-user-id': 'user_1' } });
  const res = mockRes();
  await handler(req, res);
  assert(res._status === 405, `expected 405, got ${res._status}`);
  assert(calls.length === 0, 'Anthropic API must NOT be called for GET');
});

await test('proxies to Anthropic when a valid session is present', async () => {
  const calls = captureFetch();
  const req = mockReq({
    headers: { 'x-test-user-id': 'user_1' },
    body: { model: 'claude-sonnet-4-5', max_tokens: 10, messages: [] },
  });
  const res = mockRes();
  await handler(req, res);
  assert(res._status === 200, `expected 200, got ${res._status}`);
  assert(calls.length === 1, `expected 1 Anthropic call, got ${calls.length}`);
  assert(calls[0].url.includes('api.anthropic.com'), 'should call Anthropic');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
