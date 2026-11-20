import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { resolve } from 'node:path';
const j = createJiti(import.meta.url, { alias: { '@': resolve('src') } });
const { mannQuoteServiceCapacities: choices } = await j.import('../src/lib/mann-quote-service-capacities.ts');
const item = { systemCode: 'AUTOMATIC_TRANSMISSION', sourceStatus: 'primary_source', automaticSelectionEligible: true, requiresReview: false,
  capacities: [{ serviceContext: 'PARTIAL', qualifier: 'EXACT', nominalLiters: 4.7 }, { serviceContext: 'FULL_REPLACEMENT', qualifier: 'EXACT', nominalLiters: 8 },
    { serviceContext: 'TOTAL', nominalLiters: 9 }, { serviceContext: 'DRY_FILL', nominalLiters: 10 }, { nominalLiters: 7 }] };
const profile = { items: [item] };
assert.deepEqual(choices(profile, item.systemCode).map(c => [c.context, c.litres]), [['FULL_REPLACEMENT', 8], ['PARTIAL', 4.7]]);
for (const update of [{ requiresReview: true }, { researchResult: true }, { automaticSelectionEligible: false }, { sourceStatus: 'catalog_preview' }])
  assert.deepEqual(choices({ items: [{ ...item, ...update }] }, item.systemCode), []);
for (const capacity of [{ serviceContext: 'PARTIAL', nominalLiters: 4.7, qualifier: 'RANGE', minLiters: 4, maxLiters: 5 },
  { serviceContext: 'PARTIAL', nominalLiters: 4.7, qualifier: 'APPROXIMATE' }, { serviceContext: 'PARTIAL', nominalLiters: Infinity }])
  assert.deepEqual(choices({ items: [{ ...item, capacities: [capacity] }] }, item.systemCode), []);
const conflict = { ...item, capacities: [...item.capacities, { serviceContext: 'PARTIAL', nominalLiters: 5 }] };
assert.deepEqual(choices({ items: [conflict] }, item.systemCode).map(c => c.context), ['FULL_REPLACEMENT']);
assert.deepEqual(choices({ items: [item, item] }, item.systemCode), choices(profile, item.systemCode));
assert.deepEqual(choices({ items: [{ ...item, systemCode: 'ENGINE_OIL' }] }, 'ENGINE_OIL'), []);
const engine = { ...item, systemCode: 'ENGINE_OIL', capacities: [{ serviceContext: 'WITH_FILTER', nominalLiters: 7 }] };
assert.equal(choices({ items: [engine] }, 'ENGINE_OIL')[0].litres, 7);
assert.deepEqual(choices(profile, 'ENGINE_COOLANT'), []);
console.log('PASS service methods preserve partial/full litres, reject total/dry/unknown/range/review/conflicting values and never infer applicability');
