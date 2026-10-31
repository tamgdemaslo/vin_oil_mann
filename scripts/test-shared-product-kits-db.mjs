import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { PrismaClient } from '@prisma/client';
const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.pathname.startsWith('/eco_kits_test_'), 'Separate local eco_kits_test_* database required');
const jiti = createJiti(import.meta.url, { alias: { '@': resolve('src') } });
const raw = new PrismaClient();
const { prisma } = await jiti.import('../src/lib/db.ts');
const { runWithRequestTenant } = await jiti.import('../src/lib/request-tenant-store.ts');
const { saveSharedKit, readSharedKit, listSharedKits, updateSharedKit, sharedKitNetwork } = await jiti.import('../src/lib/shared-product-kits.ts');
const { planSharedKitMigration } = await jiti.import('../src/lib/shared-product-kit-migration.ts');
const context = (branchId, group = 'shared-test-group', allowed = ['shared-a', 'shared-b', 'shared-c']) => ({ mode: 'branch', branchId, organizationId: null, businessGroupId: group, allowedBranchIds: allowed, permissions: ['branch_owner'] });
const inBranch = (branchId, fn, group) => runWithRequestTenant(context(branchId, group), fn);
try {
  for (const id of ['shared-test-group', 'shared-foreign-group']) await raw.businessGroup.upsert({ where: { id }, create: { id, slug: id, name: id }, update: {} });
  for (const id of ['shared-a', 'shared-b', 'shared-c', 'shared-foreign']) {
    await raw.branch.upsert({ where: { id }, create: { id, businessGroupId: id === 'shared-foreign' ? 'shared-foreign-group' : 'shared-test-group', name: id, shortName: id, slug: id }, update: {} });
    for (const suffix of ['main', 'extra']) await raw.localStore.upsert({ where: { id: `${id}-${suffix}` }, create: { id: `${id}-${suffix}`, branchId: id, name: suffix, isMain: suffix === 'main' }, update: {} });
    for (const [part, qty, price] of [['oil', 12, id === 'shared-b' ? 12000 : 10000], ['filter', id === 'shared-b' ? 1 : 2, 50000]]) {
      if (id === 'shared-c' && part === 'filter') continue;
      const productId = `${id}-${part}`;
      await raw.localProduct.upsert({ where: { id: productId }, create: { id: productId, branchId: id, name: part, article: part === 'oil' ? 'ATF-1' : 'FILTER-1', brand: 'ZF', uomName: part === 'oil' ? 'л' : 'шт.', salePriceCents: price }, update: {} });
      await raw.localStockBalance.upsert({ where: { productId_storeId: { productId, storeId: `${id}-main` } }, create: { branchId: id, productId, storeId: `${id}-main`, available: qty, quantity: qty }, update: {} });
    }
  }
  await raw.sharedProductKit.deleteMany({ where: { businessGroupId: { in: ['shared-test-group', 'shared-foreign-group'] } } });
  await raw.localProduct.deleteMany({ where: { id: { in: ['shared-c-filter-manual', 'shared-c-filter-duplicate'] } } });
  await raw.productKit.deleteMany({ where: { branchId: { in: ['shared-a', 'shared-b'] } } });
  const input = { name: 'Общий комплект АКПП', items: [{ productId: 'shared-a-oil', quantity: 6 }, { productId: 'shared-a-filter', quantity: 1 }] };
  const { id } = await inBranch('shared-a', () => saveSharedKit('shared-a', input));
  await assert.rejects(() => runWithRequestTenant({ ...context('shared-a'), permissions: ['mechanic'] }, () => saveSharedKit('shared-a', input)), /Недостаточно прав/);
  await assert.rejects(() => runWithRequestTenant({ ...context('shared-a'), permissions: ['group_analyst', 'branch_owner'] }, () => saveSharedKit('shared-a', input)), /Недостаточно прав/);
  assert.equal(await raw.sharedProductKit.count(), 1, 'Creating once must persist one template');
  const a = (await inBranch('shared-a', () => readSharedKit('shared-a', id))).kit;
  const b = (await inBranch('shared-b', () => readSharedKit('shared-b', id))).kit;
  assert.equal(a.id, b.id); assert.equal(a.ready, 2); assert.equal(b.ready, 1);
  assert.equal(a.priceCents, 110000); assert.equal(b.priceCents, 122000);
  assert.ok(b.items.every(item => item.product.id.startsWith('shared-b-')));
  assert.ok(b.items.every(item => item.product.meta.href.endsWith(item.product.id)));
  assert.equal((await inBranch('shared-b', () => listSharedKits('shared-b', {}))).total, 1);
  await assert.rejects(() => inBranch('shared-foreign', () => readSharedKit('shared-foreign', id), 'shared-foreign-group'), /не найден/);
  await assert.rejects(() => inBranch('shared-b', () => saveSharedKit('shared-b', { ...input, items: [{ productId: 'shared-a-oil', quantity: 6 }] })), /текущего филиала/);
  await assert.rejects(() => inBranch('shared-b', () => saveSharedKit('shared-b', { ...input, items: [{ productId: 'shared-b-oil', quantity: 6 }, { productId: 'shared-b-filter', quantity: 1 }] })), /уже существует/);
  const c = (await inBranch('shared-c', () => readSharedKit('shared-c', id))).kit;
  assert.equal(c.ready, 0); assert.equal(c.priceComplete, false); assert.ok(c.items.some(item => item.blocked && item.mappingIssue));
  // Editing a common composition in another branch updates the same row.
  await inBranch('shared-b', () => saveSharedKit('shared-b', { name: b.name, version: b.version, items: b.items.map(item => ({ productId: item.productId, templateItemId: item.templateItemId, quantity: item.quantity === 6 ? 7 : 1 })) }, id));
  let changed = (await inBranch('shared-a', () => readSharedKit('shared-a', id))).kit;
  assert.equal(changed.items[0].quantity, 7);
  await assert.rejects(() => inBranch('shared-a', () => updateSharedKit('shared-a', id, { action: 'archive', version: a.version })), /изменён/);
  await inBranch('shared-a', () => updateSharedKit('shared-a', id, { action: 'target', storeId: 'shared-a-main', quantity: 5, version: changed.version }));
  changed = (await inBranch('shared-b', () => readSharedKit('shared-b', id))).kit;
  assert.equal(changed.target, 0);
  await inBranch('shared-b', () => updateSharedKit('shared-b', id, { action: 'target', storeId: 'shared-b-main', quantity: 3, version: changed.version }));
  assert.equal((await inBranch('shared-a', () => readSharedKit('shared-a', id))).kit.target, 5);
  assert.equal((await inBranch('shared-b', () => readSharedKit('shared-b', id))).kit.target, 3);
  await assert.rejects(() => inBranch('shared-b', async () => { const kit = (await readSharedKit('shared-b', id)).kit; return updateSharedKit('shared-b', id, { action: 'target', storeId: 'shared-a-main', quantity: 999, version: kit.version }); }), /Склад недоступен/);
  const branches = (await raw.branch.findMany({ where: { businessGroupId: 'shared-test-group' } })).map(branch => ({ ...branch, displayName: branch.name }));
  const networkContext = { mode: 'branch', branchId: 'shared-a', organizationId: null, businessGroupId: 'shared-test-group', branch: branches.find(branch => branch.id === 'shared-a'), branches, userId: 'local-test', groupRole: 'group_owner', branchRole: 'branch_owner' };
  const network = await sharedKitNetwork(networkContext, {});
  assert.equal(network.total, 1); assert.equal(network.kits.length, 1);
  assert.equal(network.kits[0].locations.length, 6);
  assert.equal(network.kits[0].locations.find(location => location.branchId === 'shared-c').mappingIssues, 1);
  assert.equal((await sharedKitNetwork(networkContext, { branchId: 'shared-b' })).kits.length, 1);
  assert.equal((await sharedKitNetwork(networkContext, { branchId: 'shared-b' })).kits[0].locations.length, 2);
  await assert.rejects(() => sharedKitNetwork(networkContext, { branchId: 'shared-foreign' }), /Нет доступа/);
  // An explicit mapping resolves duplicate local cards without modifying other branches.
  await raw.localProduct.create({ data: { id: 'shared-c-filter-manual', branchId: 'shared-c', name: 'filter', article: 'FILTER-1', brand: 'ZF', uomName: 'шт.', salePriceCents: 60000 } });
  await raw.localProduct.create({ data: { id: 'shared-c-filter-duplicate', branchId: 'shared-c', name: 'filter duplicate', article: 'FILTER-1', brand: 'ZF', uomName: 'шт.', salePriceCents: 61000 } });
  const ambiguous = (await inBranch('shared-c', () => readSharedKit('shared-c', id))).kit;
  const boundItems = ambiguous.items.map(item => ({ productId: item.blocked ? 'shared-c-filter-manual' : item.productId, templateItemId: item.templateItemId, quantity: item.quantity }));
  await inBranch('shared-c', () => saveSharedKit('shared-c', { name: ambiguous.name, version: ambiguous.version, items: boundItems }, id));
  assert.equal((await inBranch('shared-c', () => readSharedKit('shared-c', id))).kit.priceComplete, true);
  assert.equal((await inBranch('shared-b', () => readSharedKit('shared-b', id))).kit.items[1].productId, 'shared-b-filter');
  const latest = (await inBranch('shared-a', () => readSharedKit('shared-a', id))).kit;
  const race = await Promise.allSettled(['Общее имя 1', 'Общее имя 2'].map(name => inBranch('shared-a', () => saveSharedKit('shared-a', { name, version: latest.version, items: latest.items.map(item => ({ productId: item.productId, templateItemId: item.templateItemId, quantity: item.quantity })) }, id))));
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  const archive = (await inBranch('shared-b', () => readSharedKit('shared-b', id))).kit;
  await inBranch('shared-b', () => updateSharedKit('shared-b', id, { action: 'archive', version: archive.version }));
  assert.equal((await inBranch('shared-a', () => listSharedKits('shared-a', {}))).total, 0);
  assert.equal((await inBranch('shared-c', () => listSharedKits('shared-c', { archived: true }))).total, 1);
  await inBranch('shared-a', () => updateSharedKit('shared-a', id, { action: 'restore', version: archive.version + 1 }));
  // Seed duplicate legacy rows for the real maintenance command rehearsal.
  for (const branchId of ['shared-a', 'shared-b']) {
    await raw.productKit.create({ data: { id: `legacy-${branchId}`, branchId, name: 'Перенос АКПП' } });
    await raw.productKitItem.createMany({ data: [{ branchId, kitId: `legacy-${branchId}`, productId: `${branchId}-oil`, quantity: 6, position: 0 }, { branchId, kitId: `legacy-${branchId}`, productId: `${branchId}-filter`, quantity: 1, position: 1 }] });
    await raw.productKitStockTarget.create({ data: { branchId, kitId: `legacy-${branchId}`, storeId: `${branchId}-main`, quantity: 4 } });
  }
  const legacy = await raw.productKit.findMany({ include: { items: { include: { product: true }, orderBy: { position: 'asc' } }, targets: true } });
  const plan = planSharedKitMigration(legacy, branches);
  assert.equal(plan.sharedCount, 1); assert.equal(plan.mergedCount, 1);
  await raw.sharedProductKit.deleteMany({});
  fs.writeFileSync('/private/tmp/shared-kit-network-preview.json', JSON.stringify(network));
  console.log('shared kits DB: create once, common editing/archive, local products/prices/targets, mapping, aliases, concurrent writes and group isolation: ok');
} finally { await raw.$disconnect(); await prisma.$disconnect(); }
