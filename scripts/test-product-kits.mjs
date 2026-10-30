import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { resolve } from 'node:path';
const jiti = createJiti(import.meta.url, { alias: { '@': resolve('src') } });
const { calculateKit, validateKitInput, mergeKitPositions } = await jiti.import('../src/lib/product-kit-calculation.ts');
const oil = { productId: 'oil', quantity: 6, available: 18, priceCents: 10000 };
const filter = { productId: 'filter', quantity: 1, available: 2, priceCents: 50000 };
const kit = calculateKit([oil, filter], 5);
assert.equal(kit.ready, 2);
assert.equal(kit.status, 'ready');
assert.equal(kit.priceCents, 110000);
assert.equal(kit.missingKits, 3);
assert.deepEqual(kit.items.map(i => [i.missingNext, i.missingTarget]), [[0,12], [1,3]]);
assert.equal(calculateKit([oil, { ...filter, available: 0 }], 1).status, 'partial');
assert.equal(calculateKit([{ ...oil, available: 0 }, { ...filter, available: -2 }], 1).status, 'empty');
assert.equal(calculateKit([], 0).ready, 0);
assert.equal(calculateKit([{ ...oil, quantity: 0.1, available: 0.3 }], 0).ready, 3);
assert.equal(calculateKit([{ ...oil, quantity: 0.001, available: 0.002 }], 0).ready, 2);
const blocked = calculateKit([oil, { ...filter, blocked: true }], 5);
assert.equal(blocked.ready, 0);
assert.equal(blocked.items[1].missingTarget, 5);
assert.equal(blocked.items[1].missingNext, 1);
// Availability is independent: neither calculation consumes a shared product.
assert.equal(calculateKit([oil], 0).ready, 3);
assert.equal(calculateKit([oil], 0).ready, 3);
assert.equal(calculateKit([oil], 0).items[0].missingTarget, 0);
assert.deepEqual(validateKitInput({ name: ' Набор ', items: [{ productId: 'oil', quantity: 0.125 }] }), { name: 'Набор', items: [{ productId: 'oil', quantity: 0.125 }] });
for (const quantity of [0, -1, NaN, Infinity, 0.0001, 1_000_001, '2', null]) {
  assert.throws(() => validateKitInput({ name: 'Набор', items: [{ productId: 'oil', quantity }] }));
}
assert.throws(() => validateKitInput({ name: '', items: [oil] }));
assert.throws(() => validateKitInput({ name: 'Набор', items: [] }));
assert.throws(() => validateKitInput({ name: 'Набор', items: [oil, oil] }));
const old = [{ assortmentMeta: { href: 'local://product/oil' }, quantity: 0.1, price: 80, discount: 10 }];
const lines = [{ assortmentMeta: { href: 'local://product/oil' }, quantity: 0.2, price: 100, discount: 0 }, { assortmentMeta: { href: 'local://product/filter' }, quantity: 1, price: 500 }];
const merged = mergeKitPositions(old, lines);
assert.equal(merged.length, 2);
assert.equal(merged[0].quantity, 0.3);
assert.equal(merged[0].price, 80);
assert.equal(merged[0].discount, 10);
assert.equal(old[0].quantity, 0.1);
assert.equal(lines[0].quantity, 0.2);
assert.equal(mergeKitPositions(merged, lines)[1].quantity, 2);
const { parseKitLaborCents, buildKitClientQuote } = await jiti.import('../src/lib/product-kit-quote.ts');
assert.equal(parseKitLaborCents(''), null);
assert.equal(parseKitLaborCents('  '), null);
assert.equal(parseKitLaborCents('0'), 0);
assert.equal(parseKitLaborCents('1500,50'), 150050);
assert.equal(parseKitLaborCents('1500.50'), 150050);
assert.equal(parseKitLaborCents('1000000'), 100000000);
for (const value of ['-1', 'NaN', 'Infinity', '1e3', '0.001', '1000000.01', '12abc']) {
  assert.throws(() => parseKitLaborCents(value));
}
const quoteKit = { name: 'Замена масла', items: [
  { ...oil, name: 'Масло', article: 'ATF-1', unit: 'л' },
  { ...filter, name: 'Фильтр', article: '', unit: 'шт.' },
] };
const quote = buildKitClientQuote(quoteKit, 150050).replaceAll('\u00a0', ' ');
assert.match(quote, /Масло \(ATF-1\) — 6 л × 100 ₽ = 600 ₽/);
assert.match(quote, /Фильтр — 1 шт\. × 500 ₽ = 500 ₽/);
assert.match(quote, /Запчасти: 1 100 ₽/);
assert.match(quote, /Работа: 1 500,5 ₽/);
assert.match(quote, /Итого с работой: 2 600,5 ₽/);
assert.match(buildKitClientQuote(quoteKit, 0).replaceAll('\u00a0', ' '), /Работа: 0 ₽\nИтого с работой: 1 100 ₽/);
assert.match(buildKitClientQuote(quoteKit, null), /Стоимость работы уточняется\./);
assert.doesNotMatch(buildKitClientQuote(quoteKit, null), /Итого с работой/);
const fractionalQuote = buildKitClientQuote({ name: 'Масло на долив', items: [{ ...quoteKit.items[0], quantity: 0.125, priceCents: 999 }] }, 1);
assert.match(fractionalQuote, /0,125 л × 9,99 ₽ = 1,25 ₽/);
assert.match(fractionalQuote, /Итого с работой: 1,26 ₽/);
assert.throws(() => buildKitClientQuote(quoteKit, -1));
const { applyBranchQueryPolicy } = await jiti.import('../src/lib/db.ts');
for (const model of ['ProductKit', 'ProductKitItem', 'ProductKitStockTarget']) {
  const tenant = { mode: 'branch', branchId: 'branch-a', allowedBranchIds: ['branch-a'] };
  assert.equal(applyBranchQueryPolicy(model, 'findMany', { where: {} }, tenant).where.branchId, 'branch-a');
  assert.throws(() => applyBranchQueryPolicy(model, 'create', { data: { branchId: 'branch-b' } }, tenant));
}
console.log('product kits: calculations, quantities, validation, expansion, independent stock, tenant isolation: ok');
await import('./test-product-kit-network.mjs');
