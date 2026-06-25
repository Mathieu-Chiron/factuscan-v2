/**
 * tests/db-save.test.js
 *
 * Guards for db-save atomicity + auth:
 *  - the batch of upserts and the snapshot DELETE run inside a single
 *    neon transaction (sql.transaction), so a mid-batch failure can't leave
 *    the user's invoices in a half-written state
 *  - auth/validation gates: 401 without a session, 405 on non-POST, 400 when
 *    invoices is not an array — all before touching the database
 *
 * The upsert/delete SQL needs a live Neon endpoint to execute, so atomicity is
 * asserted against the handler source (same approach as cron-daily).
 *
 * Run: TEST_MODE=true node tests/db-save.test.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.TEST_MODE = 'true';

const { default: handler } = await import('../api/db-save.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../api/db-save.js'), 'utf8');

// ── Mock helpers ─────────────────────────────────────────────────────────────

function mockReq({ method = 'POST', body = {}, headers = {} } = {}) {
  return { method, body, headers };
}
function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (c) => { res._status = c; return res; };
  res.json   = (b) => { res._body  = b; return res; };
  return res;
}

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}`); console.error(`    → ${e.message}`); failed++; }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('\ndb-save atomicity + auth\n');

await test('rejects unauthenticated request with 401 (no DB)', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const res = mockRes();
  await handler(mockReq({ headers: {}, body: { invoices: [] } }), res);
  assert(res._status === 401, `expected 401, got ${res._status}`);
  assert(!fetched, 'must not touch DB without a session');
});

await test('rejects non-POST with 405', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'GET', headers: { 'x-test-user-id': 'user_1' } }), res);
  assert(res._status === 405, `expected 405, got ${res._status}`);
});

await test('rejects non-array invoices with 400 (no DB)', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const res = mockRes();
  await handler(mockReq({ headers: { 'x-test-user-id': 'user_1' }, body: { invoices: 'nope' } }), res);
  assert(res._status === 400, `expected 400, got ${res._status}`);
  assert(!fetched, 'must not touch DB on invalid payload');
});

await test('upserts + delete run in a single transaction', () => {
  assert(/sql\.transaction\s*\(/.test(SRC), 'must wrap the batch in sql.transaction(...)');
});

await test('DELETE is not executed standalone (it is part of the transaction)', () => {
  assert(!/await\s+sql`\s*DELETE FROM invoices/.test(SRC), 'DELETE must not be awaited outside the transaction');
});

await test('still upserts and prunes invoices', () => {
  assert(/INSERT INTO invoices/.test(SRC), 'should still upsert invoices');
  assert(/DELETE FROM invoices/.test(SRC), 'should still prune removed invoices');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
