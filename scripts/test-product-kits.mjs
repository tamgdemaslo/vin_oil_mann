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
const { applyBranchQueryPolicy } = await jiti.import('../src/lib/db.ts');
for (const model of ['ProductKit', 'ProductKitItem', 'ProductKitStockTarget']) {
  const tenant = { mode: 'branch', branchId: 'branch-a', allowedBranchIds: ['branch-a'] };
  assert.equal(applyBranchQueryPolicy(model, 'findMany', { where: {} }, tenant).where.branchId, 'branch-a');
  assert.throws(() => applyBranchQueryPolicy(model, 'create', { data: { branchId: 'branch-b' } }, tenant));
}
console.log('product kits: calculations, quantities, validation, expansion, independent stock, tenant isolation: ok');
