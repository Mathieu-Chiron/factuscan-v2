/**
 * tests/cron-daily.test.js
 *
 * Unit tests for api/cron-daily.js
 *  - auth gate: rejects requests without the correct CRON_SECRET (no DB, no email)
 *  - query target: the daily summary must query the real `invoices` table
 *    (session_id), NOT the non-existent `datasets` table (user_id) that made
 *    the cron throw and send a false "Erreur cron daily" email every morning.
 *
 * The SQL is built with neon tagged templates and needs a live Neon endpoint
 * to execute, so query correctness is asserted against the handler source.
 *
 * Run: node tests/cron-daily.test.js
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

process.env.CRON_SECRET = 'test_cron_secret';

const { default: handler } = await import('../api/cron-daily.js');

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '../api/cron-daily.js'), 'utf8');

// ── Mock helpers ─────────────────────────────────────────────────────────────

function mockReq({ headers = {} } = {}) {
  return { method: 'POST', headers, body: {} };
}

function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body  = body; return res; };
  return res;
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

console.log('\ncron-daily.js\n');

await test('rejects request without CRON_SECRET (401, no DB/email call)', async () => {
  let fetched = false;
  globalThis.fetch = async () => { fetched = true; return { ok: true, status: 200, json: async () => ({}) }; };
  const res = mockRes();
  await handler(mockReq({ headers: {} }), res);
  assert(res._status === 401, `expected 401, got ${res._status}`);
  assert(fetched === false, 'must not touch DB or send email when unauthorized');
});

await test('rejects request with wrong CRON_SECRET (401)', async () => {
  const res = mockRes();
  await handler(mockReq({ headers: { authorization: 'Bearer wrong' } }), res);
  assert(res._status === 401, `expected 401, got ${res._status}`);
});

await test('queries the real `invoices` table, not `datasets`', async () => {
  assert(/\bFROM\s+invoices\b/i.test(SRC), 'summary query should read FROM invoices');
  assert(!/\bdatasets\b/.test(SRC), 'must not reference the non-existent `datasets` table');
});

await test('counts distinct users via session_id, not user_id', async () => {
  assert(/session_id/.test(SRC), 'should COUNT DISTINCT session_id');
  assert(!/\buser_id\b/.test(SRC), 'must not reference the non-existent `user_id` column');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
