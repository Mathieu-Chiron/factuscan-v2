/**
 * tests/push-cache-clear.test.js
 *
 * Tests pour la suppression des factures pushées du dataset local.
 * Après un push réussi, les factures avec pushStatus='success' doivent être
 * retirées de S.invoices et du cache (localStorage / DB) immédiatement,
 * sans attendre un rechargement de page.
 *
 * La logique testée est isolée dans clearPushedInvoices() — appelée par
 * pushAndExport() après la fin de l'envoi (API + PDF).
 *
 * Run: node tests/push-cache-clear.test.js
 */

// ── Logique extraite de invoice-processor.html ───────────────────────────────
// Copie exacte de la logique appliquée dans pushAndExport() après le push.

function clearPushedInvoices(invoices) {
  return invoices.filter(inv => inv.pushStatus !== 'success');
}

function newCur(invoices, oldCur) {
  if (!invoices.length) return -1;
  return Math.min(oldCur, invoices.length - 1);
}

// ── Test runner ───────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
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

function makeInv(num, pushStatus = null) {
  return { data: { invoice_number: `FAC-${num}` }, pushStatus };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

console.log('\n=== push-cache-clear tests ===\n');
console.log('1. Filtrage des factures pushées');

test('toutes success → dataset vide après clear', () => {
  const before = [makeInv(1, 'success'), makeInv(2, 'success')];
  const after = clearPushedInvoices(before);
  assert(after.length === 0, `Expected 0, got ${after.length}`);
});

test('toutes en erreur → toutes conservées', () => {
  const before = [makeInv(1, 'error'), makeInv(2, 'error')];
  const after = clearPushedInvoices(before);
  assert(after.length === 2, `Expected 2, got ${after.length}`);
});

test('mix success + error → seules les erreurs restent', () => {
  const before = [makeInv(1, 'success'), makeInv(2, 'error'), makeInv(3, 'success')];
  const after = clearPushedInvoices(before);
  assert(after.length === 1, `Expected 1, got ${after.length}`);
  assert(after[0].data.invoice_number === 'FAC-2', `Expected FAC-2, got ${after[0].data.invoice_number}`);
});

test('pushStatus null → facture conservée', () => {
  const before = [makeInv(1, null), makeInv(2, 'success')];
  const after = clearPushedInvoices(before);
  assert(after.length === 1);
  assert(after[0].pushStatus === null);
});

test('pushStatus sending → facture conservée', () => {
  const before = [makeInv(1, 'sending')];
  const after = clearPushedInvoices(before);
  assert(after.length === 1);
});

console.log('\n2. Recalcul du curseur après suppression');

test('S.cur pointe sur une facture restante → inchangé', () => {
  const remaining = [makeInv(3, 'error')];
  assert(newCur(remaining, 0) === 0);
});

test('S.cur hors limite après suppression → ramené au dernier', () => {
  const remaining = [makeInv(2, 'error')];
  assert(newCur(remaining, 5) === 0, `Expected 0, got ${newCur(remaining, 5)}`);
});

test('dataset vide après suppression → S.cur = -1', () => {
  assert(newCur([], 0) === -1);
  assert(newCur([], 2) === -1);
});

console.log('\n3. Scénarios réels');

test('push partiel (2 ok, 1 erreur) → 1 facture reste en cache', () => {
  const before = [
    makeInv(1, 'success'),
    makeInv(2, 'success'),
    makeInv(3, 'error'),
  ];
  const after = clearPushedInvoices(before);
  assert(after.length === 1, `Expected 1 remaining, got ${after.length}`);
  assert(after[0].data.invoice_number === 'FAC-3');
});

test('push complet (toutes ok) → 0 factures en cache', () => {
  const before = [makeInv(1, 'success'), makeInv(2, 'success'), makeInv(3, 'success')];
  const after = clearPushedInvoices(before);
  assert(after.length === 0);
  assert(newCur(after, 2) === -1, 'S.cur doit être -1 quand dataset vide');
});

test('aucune facture pushée (toutes en erreur) → dataset inchangé', () => {
  const before = [makeInv(1, 'error'), makeInv(2, 'error')];
  const after = clearPushedInvoices(before);
  assert(after.length === 2);
  assert(after.every(i => i.pushStatus === 'error'));
});

// ── Résumé ────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(40)}`);
console.log(`Résultat : ${passed} passé(s), ${failed} échoué(s)`);
if (failed > 0) process.exit(1);
