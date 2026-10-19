import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
import { resolve } from 'node:path';

const url = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/eco_kits_test_')) {
  throw new Error('Use a separate local eco_kits_test_* database only');
}
const jiti = createJiti(import.meta.url, { alias: { '@': resolve('src') } });
const { prisma } = await jiti.import('../src/lib/db.ts');
const { listKits, saveKit, readKit, updateKitState } = await jiti.import('../src/lib/product-kits.ts');
const branchId = 'kits-demo';
const storeId = 'kits-main';
const storeOther = 'kits-extra';
try {
  await prisma.businessGroup.upsert({ where: { id: 'kits-group' }, create: { id: 'kits-group', name: 'Тест комплектов', slug: 'kits-demo' }, update: {} });
  await prisma.localOrganization.upsert({ where: { id: 'kits-org' }, create: { id: 'kits-org', name: 'Экоплатформа · тестовый филиал', isDefault: true }, update: {} });
  await prisma.branch.upsert({ where: { id: branchId }, create: { id: branchId, businessGroupId: 'kits-group', name: 'Тестовый филиал', shortName: 'Тестовый филиал', slug: 'kits-demo', legacyOrganizationId: 'kits-org' }, update: {} });
  await prisma.user.upsert({ where: { login: 'kitsdemo' }, create: { id: 'kits-user', login: 'kitsdemo', name: 'Тест комплектов', authRole: 'owner', lastActiveBranchId: branchId }, update: {} });
  await prisma.businessGroupMembership.upsert({ where: { businessGroupId_userId: { businessGroupId: 'kits-group', userId: 'kits-user' } }, create: { businessGroupId: 'kits-group', userId: 'kits-user', role: 'group_owner' }, update: {} });
  await prisma.branchMembership.upsert({ where: { branchId_userId: { branchId, userId: 'kits-user' } }, create: { branchId, userId: 'kits-user', roleId: 'branch_owner', isDefaultBranch: true }, update: {} });
  for (const [id, name] of [[storeId, 'Основной склад'], [storeOther, 'Дополнительный склад']]) {
    await prisma.localStore.upsert({ where: { id }, create: { id, branchId, name, organizationId: 'kits-org', isMain: id === storeId }, update: {} });
  }
  const fixtures = [
    ['kits-oil', 'Трансмиссионное масло ATF', 'ATF-001', 'л', 95000, 18],
    ['kits-filter', 'Фильтр АКПП 6HP', '6HP-F01', 'шт.', 180000, 2],
    ['kits-gasket', 'Прокладка поддона АКПП', '6HP-G01', 'шт.', 65000, 8],
    ['kits-cvt-filter', 'Фильтр вариатора CVT', 'CVT-F01', 'шт.', 120000, 0],
    ['kits-dsg', 'Масло DSG', 'DSG-001', 'л', 110000, 0],
  ];
  for (const [id, name, article, uomName, salePriceCents, available] of fixtures) {
    await prisma.localProduct.upsert({ where: { id }, create: { id, branchId, name, article, uomName, salePriceCents, searchText: `${name} ${article}` }, update: { archived: false } });
    await prisma.localStockBalance.upsert({ where: { productId_storeId: { productId: id, storeId } }, create: { branchId, productId: id, storeId, quantity: available, available, reserve: 0 }, update: { available, quantity: available } });
  }
  await prisma.productKit.deleteMany({ where: { branchId } });
  const composition = [{ productId: 'kits-oil', quantity: 6 }, { productId: 'kits-filter', quantity: 1 }, { productId: 'kits-gasket', quantity: 1 }];
  const saved = await saveKit(branchId, { name: 'Замена масла АКПП 6HP', items: composition });
  let kit = (await readKit(branchId, saved.id, storeId)).kit;
  assert.equal(kit.ready, 2);
  assert.equal(kit.priceCents, 815000);
  await updateKitState(branchId, kit.id, { action: 'target', storeId, quantity: 5 });
  kit = (await readKit(branchId, kit.id, storeId)).kit;
  assert.equal(kit.target, 5);
  assert.deepEqual(kit.items.map(item => item.missingTarget), [12, 3, 0]);
  assert.equal((await readKit(branchId, kit.id, storeOther)).kit.target, 0);
  assert.equal((await readKit(branchId, kit.id, storeOther)).kit.ready, 0);
  await assert.rejects(() => readKit('other-branch', kit.id, storeId), /Склад недоступен/);
  await assert.rejects(() => saveKit('other-branch', { name: 'Нельзя', items: composition }), /недоступные товары/);
  await assert.rejects(() => updateKitState(branchId, kit.id, { action: 'target', storeId, quantity: -1 }), /целым/);
  await assert.rejects(() => saveKit(branchId, { name: 'Неверный состав', items: [{ productId: 'missing', quantity: 1 }] }, kit.id), /Обновите/);
  const changes = await Promise.allSettled([
    saveKit(branchId, { name: kit.name, items: composition, version: kit.version }, kit.id),
    saveKit(branchId, { name: 'Конкурентное изменение 6HP', items: composition, version: kit.version }, kit.id),
  ]);
  assert.equal(changes.filter(result => result.status === 'fulfilled').length, 1);
  kit = (await readKit(branchId, kit.id, storeId)).kit;
  await assert.rejects(() => saveKit(branchId, { name: 'Нельзя', version: kit.version, items: [{ productId: 'missing', quantity: 1 }] }, kit.id), /недоступные/);
  assert.equal((await readKit(branchId, kit.id, storeId)).kit.items.length, 3);
  await updateKitState(branchId, kit.id, { action: 'archive', version: kit.version });
  assert.equal((await listKits(branchId, { storeId })).total, 0);
  assert.equal((await listKits(branchId, { storeId, archived: true })).total, 1);
  kit = (await readKit(branchId, kit.id, storeId)).kit;
  await updateKitState(branchId, kit.id, { action: 'restore', version: kit.version });
  // Composite foreign keys enforce tenant isolation even without application guards.
  await assert.rejects(() => prisma.productKitItem.create({ data: { branchId: 'other-branch', kitId: kit.id, productId: 'kits-oil', quantity: 1 } }));
  await assert.rejects(() => prisma.productKitStockTarget.create({ data: { branchId: 'other-branch', kitId: kit.id, storeId, quantity: 1 } }));
  await assert.rejects(() => prisma.productKitItem.updateMany({ where: { branchId, kitId: kit.id }, data: { quantity: 0 } }));
  await prisma.localProduct.update({ where: { id: 'kits-filter' }, data: { archived: true } });
  assert.equal((await readKit(branchId, kit.id, storeId)).kit.ready, 0);
  await prisma.localProduct.update({ where: { id: 'kits-filter' }, data: { archived: false } });
  const partial = await saveKit(branchId, { name: 'Замена масла вариатора CVT', items: [{ productId: 'kits-oil', quantity: 5 }, { productId: 'kits-cvt-filter', quantity: 1 }] });
  const empty = await saveKit(branchId, { name: 'Замена масла DSG', items: [{ productId: 'kits-dsg', quantity: 6 }] });
  await updateKitState(branchId, partial.id, { action: 'target', storeId, quantity: 3 });
  await updateKitState(branchId, empty.id, { action: 'target', storeId, quantity: 2 });
  assert.equal((await readKit(branchId, partial.id, storeId)).kit.status, 'partial');
  assert.equal((await readKit(branchId, empty.id, storeId)).kit.status, 'empty');
  const search = await listKits(branchId, { storeId, q: '6HP' });
  assert.equal(search.total, 1);
  // Restore the human-readable name after the concurrency test.
  kit = (await readKit(branchId, kit.id, storeId)).kit;
  await saveKit(branchId, { name: 'Замена масла АКПП 6HP', version: kit.version, items: composition }, kit.id);
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Kaliningrad' }).format(new Date());
  if (!await prisma.cashShift.findFirst({ where: { branchId, serviceDate: date } })) {
    await prisma.cashShift.create({ data: { branchId, serviceDate: date, timezone: 'Europe/Kaliningrad', openedAt: new Date(), openedBy: 'kitsdemo', openedByRole: 'owner' } });
  }
  console.log('product kits DB: migration constraints, stock targets, prices, archive/restore, concurrent edits, branch boundaries: ok');
  console.log('Synthetic fixtures kept in the isolated local database for browser preview.');
} finally { await prisma.$disconnect(); }
