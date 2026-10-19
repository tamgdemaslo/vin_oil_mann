import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@': resolve('src') } });
const { normalizeReceiptProductDetails, receiptProductChanges } = await jiti.import('../src/lib/rossko-receipt-product.ts');
const details = {
  name: 'Фильтр воздушный Filtron AP 139/2', brand: 'Filtron', article: 'AP 139/2',
  category: 'Фильтры воздушные', oemParts: '12345\n67890', barcodeEan13: '4006381333931',
  barcodeEan8: '96385074', barcodeCode128: 'ECO-TEST123', salePrice: 1900.25,
};
assert.equal(normalizeReceiptProductDetails(details).oemParts, '12345; 67890');
assert.deepEqual(receiptProductChanges(details, details, details), {}, 'unchanged filled cards need no update');
assert.deepEqual(receiptProductChanges(details, details, { ...details, brand: null, article: null }), { brand: 'Filtron', article: 'AP 139/2' }, 'receipt fills missing brand and article');
assert.deepEqual(receiptProductChanges({ ...details, brand: 'MANN', oemParts: '', salePrice: 0 }, details, details), { brand: 'MANN', oemParts: '', salePrice: 0 }, 'explicit changes, cleared OEM and zero price persist');

for (const invalid of [
  { brand: '' }, { article: '' }, { category: '' }, { name: ' ' },
  { barcodeEan13: '4006381333932' }, { barcodeEan8: '96385075' },
  { barcodeEan13: '123' }, { barcodeCode128: 'кириллица' },
  { salePrice: -1 }, { salePrice: NaN }, { salePrice: '1900' },
]) assert.throws(() => normalizeReceiptProductDetails({ ...details, ...invalid }), JSON.stringify(invalid));
assert.equal(normalizeReceiptProductDetails({ ...details, barcodeEan13: '', barcodeEan8: '' }).barcodeCode128, 'ECO-TEST123');
const dir = await mkdtemp(join(tmpdir(), 'receipt-product-test-'));
try {
  const stub = join(dir, 'admin.cjs');
  await writeFile(stub, `exports.createLocalAdminProduct = async (payload, actor, branchId, options) => {
    globalThis.__receiptProductPayload = { payload, actor, branchId, options };
    return { ok: true, product: { id: 'created-product', ...payload } };
  }; exports.supplierCounterpartyIdentityWhere = () => ({});`);
  const isolated = createJiti(import.meta.url, { moduleCache: false, alias: {
    '@/lib/local-inventory-admin': stub, '@': resolve('src'),
  } });
  const { resolveOrCreateRosskoLocalProduct, suggestRosskoProductGroup } = await isolated.import('../src/lib/rossko-product-import.ts');
  assert.equal(suggestRosskoProductGroup([{ id: 'old', name: 'Фильтр воздушный', groupPath: 'Запчасти / Воздушные фильтры', brand: 'MANN', article: 'C1' }], 'Фильтр воздушный'), 'Запчасти / Воздушные фильтры');
  const audits = [];
  const tx = {
    $queryRaw: async () => [],
    localProduct: { update: async () => ({}) },
    branchAuditLog: { create: async (event) => audits.push(event) },
  };
  const result = await resolveOrCreateRosskoLocalProduct({
    context: { branchId: 'branch-test', businessGroupId: 'business-test', userId: 'user-test' },
    actor: { login: 'tester' }, orderId: '123', sourceLineKey: 'rossko:123:part', partGuid: 'part',
    brand: details.brand, article: details.article, name: 'Фильтр воздушный', nameOverride: details.name,
    category: details.category, oemParts: details.oemParts, barcodeEan13: details.barcodeEan13,
    barcodeEan8: details.barcodeEan8, barcodeCode128: details.barcodeCode128,
    purchasePriceCents: 100000, retailPriceCents: 190025, transaction: tx,
  });
  assert.equal(result.created, true);
  const captured = globalThis.__receiptProductPayload;
  assert.equal(captured.branchId, 'branch-test');
  assert.equal(captured.options.transaction, tx);
  for (const key of ['name', 'brand', 'article', 'oemParts', 'barcodeEan13', 'barcodeEan8', 'barcodeCode128']) assert.equal(captured.payload[key], details[key], key);
  assert.equal(captured.payload.groupPath, details.category);
  assert.equal(captured.payload.salePrice, 1900.25);
  assert.equal(audits[0].data.action, 'ROSSKO_PRODUCT_CREATED');
  delete globalThis.__receiptProductPayload;
} finally { await rm(dir, { recursive: true, force: true }); }
console.log('ROSSKO receipt product validation and persistence — passed');
