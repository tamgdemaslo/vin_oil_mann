import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { resolve } from 'node:path';
const j = createJiti(import.meta.url, { alias: { '@': resolve('src') } });
const { quoteFluidOfferAmount: amount } = await j.import('../src/lib/maintenance-fluid-offer-amount.ts');
const product = { id: 'p', name: 'TEST fluid', article: 'TEST', unit: 'шт.', price: 1000, litresPerUnit: 1, available: 20 };
assert.deepEqual(amount(product, 4.7), { quantity: 5, suppliedLitres: 5, cents: 500000, enough: true });
assert.deepEqual(amount({ ...product, quantityMultiple: 3 }, 4.7), { quantity: 6, suppliedLitres: 6, cents: 600000, enough: true });
assert.equal(amount({ ...product, quantityMultiple: 3, available: 5 }, 4.7).enough, false);
assert.deepEqual(amount({ ...product, litresPerUnit: 4, quantityMultiple: 3 }, 7), { quantity: 3, suppliedLitres: 12, cents: 300000, enough: true });
assert.deepEqual(amount({ ...product, unit: 'л' }, 4.7), { quantity: 4.7, suppliedLitres: 4.7, cents: 470000, enough: true });
for (const multiple of [0, -1, 1.5, Infinity, NaN]) assert.equal(amount({ ...product, quantityMultiple: multiple }, 4.7), null);
for (const patch of [{ unit: 'кг' }, { unit: '' }, { unit: 'мл' }, { price: Infinity }, { litresPerUnit: null }, { litresPerUnit: 0 }, { available: NaN }, { unit: 'л', quantityMultiple: 2 }])
  assert.equal(amount({ ...product, ...patch }, 4.7), null);
assert.equal(amount(product, NaN), null);
assert.equal(amount(product, 0), null);
console.log('PASS exact service litres, whole packs, supplier multiplicity, bulk litres, insufficient quantity and no mass/unit inference');
