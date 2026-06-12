/**
 * tests/isolation.test.js
 *
 * Integration tests for user data isolation.
 * Tests that User A cannot see User B's invoices or PAYT settings.
 *
 * Run: TEST_MODE=true node --env-file=env.local tests/isolation.test.js
 */

process.env.TEST_MODE = 'true';

import { neon } from '@neondatabase/serverless';
import { default as dbSaveHandler }       from '../api/db-save.js';
import { default as dbLoadHandler }       from '../api/db-load.js';
import { default as userSettingsHandler } from '../api/user-settings.js';

// ── Mock helpers ───────────────────────────────────────────────────────────

function mockReq({ method = 'POST', body = {}, userId = null } = {}) {
  return {
    method,
    body,
    headers: userId ? { 'x-test-user-id': userId } : {},
  };
}

function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => { res._status = code; return res; };
  res.json   = (body)  => { res._body  = body; return res; };
  return res;
}

// ── Test runner ────────────────────────────────────────────────────────────

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

// ── Test data ──────────────────────────────────────────────────────────────

const USER_A = 'test_isolation_userA';
const USER_B = 'test_isolation_userB';
const FILE_A = 'facture_user_a.pdf';
const FILE_B = 'facture_user_b.pdf';

async function cleanup(sql) {
  await sql`DELETE FROM invoices      WHERE session_id     IN (${USER_A}, ${USER_B})`;
  await sql`DELETE FROM user_settings WHERE clerk_user_id  IN (${USER_A}, ${USER_B})`;
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n=== Isolation tests (User A vs User B) ===\n');

  const sql = neon(process.env.DATABASE_URL);
  await cleanup(sql);

  // ── 1. Unauthorized access ────────────────────────────────────────────
  console.log('1. Accès non autorisé');

  await test('db-load retourne 401 sans token', async () => {
    const res = mockRes();
    await dbLoadHandler(mockReq({ userId: null }), res);
    assert(res._status === 401, `Expected 401, got ${res._status}`);
  });

  await test('db-save retourne 401 sans token', async () => {
    const res = mockRes();
    await dbSaveHandler(mockReq({ userId: null, body: { invoices: [] } }), res);
    assert(res._status === 401, `Expected 401, got ${res._status}`);
  });

  await test('user-settings retourne 401 sans token', async () => {
    const res = mockRes();
    await userSettingsHandler(mockReq({ method: 'GET', userId: null }), res);
    assert(res._status === 401, `Expected 401, got ${res._status}`);
  });

  // ── 2. User A sauvegarde ses données ─────────────────────────────────
  console.log('\n2. User A sauvegarde ses données');

  await test('User A sauvegarde une facture', async () => {
    const res = mockRes();
    await dbSaveHandler(mockReq({ userId: USER_A, body: { invoices: [{ fileName: FILE_A, status: 'validated', data: { invoice_number: 'INV-A-001' } }] } }), res);
    assert(res._status === 200 && res._body?.ok, `Expected 200/ok, got ${res._status}`);
  });

  await test('User A sauvegarde son token PAYT', async () => {
    const res = mockRes();
    await userSettingsHandler(mockReq({ method: 'POST', userId: USER_A, body: { payt_token: 'token_user_a' } }), res);
    assert(res._status === 200 && res._body?.ok);
  });

  // ── 3. User B sauvegarde ses données ─────────────────────────────────
  console.log('\n3. User B sauvegarde ses données');

  await test('User B sauvegarde une facture', async () => {
    const res = mockRes();
    await dbSaveHandler(mockReq({ userId: USER_B, body: { invoices: [{ fileName: FILE_B, status: 'validated', data: { invoice_number: 'INV-B-001' } }] } }), res);
    assert(res._status === 200 && res._body?.ok);
  });

  await test('User B sauvegarde son token PAYT', async () => {
    const res = mockRes();
    await userSettingsHandler(mockReq({ method: 'POST', userId: USER_B, body: { payt_token: 'token_user_b' } }), res);
    assert(res._status === 200 && res._body?.ok);
  });

  // ── 4. Isolation des factures ─────────────────────────────────────────
  console.log('\n4. Isolation des factures');

  await test('User A ne voit QUE ses factures', async () => {
    const res = mockRes();
    await dbLoadHandler(mockReq({ userId: USER_A }), res);
    assert(res._status === 200);
    const names = (res._body?.invoices || []).map(i => i.fileName);
    assert(names.includes(FILE_A),  `User A devrait voir ${FILE_A}`);
    assert(!names.includes(FILE_B), `User A NE devrait PAS voir ${FILE_B}`);
  });

  await test('User B ne voit QUE ses factures', async () => {
    const res = mockRes();
    await dbLoadHandler(mockReq({ userId: USER_B }), res);
    assert(res._status === 200);
    const names = (res._body?.invoices || []).map(i => i.fileName);
    assert(names.includes(FILE_B),  `User B devrait voir ${FILE_B}`);
    assert(!names.includes(FILE_A), `User B NE devrait PAS voir ${FILE_A}`);
  });

  // ── 5. Isolation du token PAYT ────────────────────────────────────────
  console.log('\n5. Isolation du token PAYT');

  await test('User A récupère uniquement son token PAYT', async () => {
    const res = mockRes();
    await userSettingsHandler(mockReq({ method: 'GET', userId: USER_A }), res);
    assert(res._status === 200);
    assert(res._body?.payt_token === 'token_user_a', `Got "${res._body?.payt_token}"`);
    assert(res._body?.payt_token !== 'token_user_b', 'User A NE devrait PAS voir le token de User B');
  });

  await test('User B récupère uniquement son token PAYT', async () => {
    const res = mockRes();
    await userSettingsHandler(mockReq({ method: 'GET', userId: USER_B }), res);
    assert(res._status === 200);
    assert(res._body?.payt_token === 'token_user_b', `Got "${res._body?.payt_token}"`);
    assert(res._body?.payt_token !== 'token_user_a', 'User B NE devrait PAS voir le token de User A');
  });

  // ── 6. Suppression par User A n'affecte pas User B ───────────────────
  console.log('\n6. Suppression de User A sans impact sur User B');

  await test('User A vide ses factures', async () => {
    const res = mockRes();
    await dbSaveHandler(mockReq({ userId: USER_A, body: { invoices: [] } }), res);
    assert(res._status === 200 && res._body?.ok);
  });

  await test('User A a 0 factures après suppression', async () => {
    const res = mockRes();
    await dbLoadHandler(mockReq({ userId: USER_A }), res);
    const count = res._body?.invoices?.length ?? -1;
    assert(count === 0, `Expected 0, got ${count}`);
  });

  await test('User B conserve ses factures après suppression de User A', async () => {
    const res = mockRes();
    await dbLoadHandler(mockReq({ userId: USER_B }), res);
    const invoices = res._body?.invoices || [];
    assert(invoices.length === 1, `Expected 1, got ${invoices.length}`);
    assert(invoices[0].fileName === FILE_B);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────
  await cleanup(sql);
  console.log('\n  (données de test supprimées)\n');

  // ── Résumé ────────────────────────────────────────────────────────────
  const total = passed + failed;
  console.log(`=== ${passed}/${total} tests passés${failed ? ` — ${failed} ÉCHOUÉ(S)` : ' ✓'} ===\n`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
