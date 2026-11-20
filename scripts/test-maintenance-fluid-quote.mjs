import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { resolve } from 'node:path';
const j = createJiti(import.meta.url, { alias: { '@': resolve('src') } });
const { quoteFluidLineCurrent: current } = await j.import('../src/lib/maintenance-fluid-quote.ts');
const { quoteClientText, quoteExtraCents, quoteOilAmount } = await j.import('../src/lib/maintenance-quote.ts');
const item = { revisionId: 'revision-a', componentModel: 'TEST-A', systemCode: 'AUTOMATIC_TRANSMISSION', systemLabel: 'АКПП', sourceStatus: 'primary_source',
  requiresReview: false, automaticSelectionEligible: true, specifications: ['Toyota WS'], viscosityGrades: [],
  capacities: [{ serviceContext: 'PARTIAL', qualifier: 'EXACT', nominalLiters: 4.7 }, { serviceContext: 'FULL_REPLACEMENT', nominalLiters: 8 }] };
const profile = { items: [item] };
const product = { id: 'fluid', name: 'TEST ATF 1 л', article: 'TEST', price: 1000, available: 5, unit: 'шт.', litresPerUnit: 1 };
const amount = quoteOilAmount(product, 4.7);
assert.deepEqual(amount, { quantity: 5, suppliedLitres: 5, cents: 500000, enough: true });
const row = { id: 'fluid:AUTOMATIC_TRANSMISSION', name: product.name, stockStoreId: 'store-a', quantity: amount.quantity, price: product.price,
  fluid: { systemCode: item.systemCode, systemLabel: item.systemLabel, specification: 'Toyota WS', serviceMethodLabel: 'Частичная замена', serviceLitres: 4.7,
    productId: product.id, profileRevisionId: 'revision-a', componentModel: 'TEST-A', litresPerUnit: 1, suppliedLitres: 5, unit: 'шт.', approvalStatus: 'unknown', manualCompatibilityConfirmed: true } };
assert.equal(current(row, profile, 'store-a'), true);
assert.equal(current(row, profile, 'store-b'), false);
assert.equal(current(row, null, 'store-a'), false);
for (const patch of [{ requiresReview: true }, { researchResult: true }, { automaticSelectionEligible: false }, { sourceStatus: 'catalog_preview' },
  { revisionId: 'revision-b' }, { componentModel: 'TEST-B' }, { specifications: ['Toyota T-IV'] }, { viscosityGrades: ['75W-90'] }, { capacities: [{ serviceContext: 'TOTAL', nominalLiters: 4.7 }] }])
  assert.equal(current(row, { items: [{ ...item, ...patch }] }, 'store-a'), false);
for (const patch of [{ manualCompatibilityConfirmed: false }, { serviceLitres: 8 }, { suppliedLitres: 4 }, { approvalStatus: 'manufacturer_claim', manualCompatibilityConfirmed: false }])
  assert.equal(current({ ...row, fluid: { ...row.fluid, ...patch } }, profile, 'store-a'), false);
assert.equal(current({ ...row, quantity: 4 }, profile, 'store-a'), false);
assert.equal(current(row, { items: [{ ...item, capacities: [] }, { ...item, specifications: ['Toyota T-IV'] }] }, 'store-a'), false,
  'specification and service capacity must belong to the same eligible aggregate item');
const text = quoteClientText('TEST автомобиль', '', 0, [], [row]);
assert.match(text, /АКПП: TEST ATF 1 л/);
assert.match(text, /Требования: Toyota WS/);
assert.match(text, /Частичная замена; объём замены 4.7 л/);
assert.match(text, /К покупке: 5 л/);
assert.match(text, /5 шт\./);
assert.equal(quoteExtraCents([row]), amount.cents);
assert.doesNotMatch(text, /Моторное масло:/);
assert.doesNotMatch(text, /official_approval|manualCompatibilityConfirmed|fluid:AUTOMATIC/);
const supplier = { ...row, quantity: 6, supplierProductId: 'rossko:offer-exact', supplierDeliveryLabel: 'доставка: 22.11.2026, 11:00–12:00',
  fluid: { ...row.fluid, source: 'rossko', suppliedLitres: 6, quantityMultiple: 3, localProductId: 'catalogue-card', supplierOfferId: 'rossko:offer-exact',
    deliveryLabel: 'доставка: 22.11.2026, 11:00–12:00', packageEvidence: 'Точный артикул; фасовка 1 л по карточке' } };
assert.equal(current(supplier, profile, 'store-a'), true);
assert.equal(current({ ...supplier, quantity: 5, fluid: { ...supplier.fluid, suppliedLitres: 5 } }, profile, 'store-a'), false, 'supplier multiplicity is mandatory in restored quote rows');
assert.equal(current({ ...supplier, supplierProductId: 'rossko:another-offer' }, profile, 'store-a'), false);
assert.equal(current({ ...supplier, fluid: { ...supplier.fluid, packageEvidence: '' } }, profile, 'store-a'), false);
assert.equal(current({ ...supplier, fluid: { ...supplier.fluid, unit: 'кг' } }, profile, 'store-a'), false);
const supplierText = quoteClientText('TEST автомобиль', '', 0, [], [supplier]);
assert.match(supplierText, /К покупке: 6 л/);
assert.match(supplierText, /Ориентировочная поставка: 22\.11\.2026, 11:00–12:00/);
assert.equal(quoteExtraCents([supplier]), 600000);
console.log('PASS fluid quantity/copy and current profile/store/service/verification guards; no inferred ATF applicability');
