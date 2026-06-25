/**
 * tests/blob-upload.test.js
 *
 * Guards for the Blob hardening (public model):
 *  - uploads use addRandomSuffix:true so public URLs are not guessable from
 *    the original filename
 *  - the misleading, unused blob-get proxy (and its blobProxyUrl helper) is
 *    removed, so no code suggests private access that does not exist
 *
 * put() comes from @vercel/blob (hard to execute offline), so the upload
 * options are asserted against the handler source.
 *
 * Run: node tests/blob-upload.test.js
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(__dirname, p), 'utf8');

const UPLOAD = read('../api/blob-upload.js');
const HTML   = read('../invoice-processor.html');

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}`); console.error(`    → ${e.message}`); failed++; }
}
function assert(condition, msg) { if (!condition) throw new Error(msg || 'Assertion failed'); }

// ── Tests ───────────────────────────────────────────────────────────────────

console.log('\nblob-upload hardening\n');

test('upload forces addRandomSuffix:true (unguessable URLs)', () => {
  assert(/addRandomSuffix\s*:\s*true/.test(UPLOAD), 'put() must set addRandomSuffix: true');
});

test('upload keeps public access + pdf content type', () => {
  assert(/access\s*:\s*'public'/.test(UPLOAD), "access should stay 'public'");
  assert(/contentType\s*:\s*'application\/pdf'/.test(UPLOAD), 'contentType should be application/pdf');
});

test('misleading blob-get proxy endpoint is removed', () => {
  assert(!existsSync(join(__dirname, '../api/blob-get.js')), 'api/blob-get.js should be deleted');
});

test('dead blobProxyUrl helper is removed from the frontend', () => {
  assert(!/blobProxyUrl/.test(HTML), 'blobProxyUrl helper should be removed');
  assert(!/blob-get/.test(HTML), 'no reference to the removed blob-get endpoint should remain');
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
