import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';
import ts from 'typescript';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { alias: { '@': resolve('src') } });
const tenantStore = await jiti.import('../src/lib/request-tenant-store.ts');
const { applyBranchQueryPolicy } = await jiti.import('../src/lib/db.ts');
const calculations = await jiti.import('../src/lib/product-kit-calculation.ts');
function load(file, dependencies) {
  const code = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => { assert.ok(id in dependencies, `Unexpected dependency: ${id}`); return dependencies[id]; }, console });
  return exports;
}
const branchApi = load('../src/lib/branch-api.ts', {
  'next/server': {}, '@/lib/branch-context': {}, '@/lib/request-tenant-store': tenantStore,
});
const branch = (id, group = 'group') => ({ id, businessGroupId: group, displayName: `Точка ${id}`, shortName: id, name: id, status: 'active' });
const context = { mode: 'branch', branchId: 'a', businessGroupId: 'group', userId: 'tester', branch: branch('a'), branches: [branch('a'), branch('b'), branch('empty'), branch('foreign', 'another-group')], groupRole: 'group_owner', branchRole: 'branch_owner' };
const stores = [{ id: 'a-main', branchId: 'a', archived: false, name: 'Основной' }, { id: 'b-main', branchId: 'b', archived: false, name: 'Основной' }, { id: 'b-extra', branchId: 'b', archived: false, name: 'Дополнительный' }, { id: 'hidden-main', branchId: 'hidden', archived: false, name: 'Недоступный' }];
const makeKit = (id, branchId, name = 'Замена масла АКПП') => ({ id, branchId, name, archived: false, version: 1, targets: [], items: [
  { productId: `${branchId}-oil`, quantity: 6, product: { id: `${branchId}-oil`, name: 'Масло', article: 'ATF', uomName: 'л', salePriceCents: 10000, archived: false, entityType: 'product' } },
  { productId: `${branchId}-filter`, quantity: 1, product: { id: `${branchId}-filter`, name: 'Фильтр', salePriceCents: 50000, archived: false, entityType: 'product' } },
] });
const records = [makeKit('kit-a', 'a'), makeKit('kit-b', 'b'), makeKit('no-store', 'empty'), makeKit('hidden-kit', 'hidden'), makeKit('foreign-kit', 'foreign')];
const balance = (branchId, storeId, product, available) => ({ branchId, storeId, productId: `${branchId}-${product}`, available, quantity: available, reserve: 0, buyPriceCents: null, slotName: null });
const balances = [balance('a', 'a-main', 'oil', 12), balance('a', 'a-main', 'filter', 2), balance('b', 'b-main', 'oil', 0), balance('b', 'b-main', 'filter', 1), balance('b', 'b-extra', 'oil', 6), balance('b', 'b-extra', 'filter', 0), balance('hidden', 'hidden-main', 'filter', 999)];
const calls = [];
const matches = (row, where) => Object.entries(where).every(([key, condition]) => {
  if (condition && typeof condition === 'object') {
    if ('in' in condition) return condition.in.includes(row[key]);
    if ('contains' in condition) return row[key].toLowerCase().includes(condition.contains.toLowerCase());
  }
  return row[key] === condition;
});
const model = (name, rows) => ({
  findMany: async args => {
    const scoped = applyBranchQueryPolicy(name, 'findMany', args);
    calls.push({ name, args: scoped, tenant: tenantStore.getRequestTenant() });
    const found = rows.filter(row => matches(row, scoped.where));
    return found.slice(scoped.skip || 0, (scoped.skip || 0) + (scoped.take || found.length));
  },
  count: async args => {
    const scoped = applyBranchQueryPolicy(name, 'count', args);
    return rows.filter(row => matches(row, scoped.where)).length;
  },
});
const prisma = { productKit: model('ProductKit', records), localStore: model('LocalStore', stores), localStockBalance: model('LocalStockBalance', balances) };
const kitService = load('../src/lib/product-kits.ts', { '@/lib/db': { prisma }, '@/lib/product-kit-calculation': calculations });
const { listNetworkKits } = load('../src/lib/product-kit-network.ts', { '@/lib/db': { prisma }, '@/lib/branch-api': branchApi, '@/lib/product-kits': kitService });
await branchApi.runWithBranchApiContext(context, async () => {
  const result = await listNetworkKits(context, {});
  assert.equal(tenantStore.getRequestTenant().branchId, 'a', 'Aggregate reads must restore the selected tenant');
  assert.equal(result.total, 3);
  assert.deepEqual(Array.from(result.kits, kit => kit.id), ['kit-a', 'kit-b', 'no-store']);
  assert.equal(result.branches.length, 3, 'A branch in a different business group must be excluded');
  assert.equal(result.kits[0].branch.name, 'Точка a');
  assert.equal(result.kits[0].locations[0].ready, 2);
  assert.equal(result.kits[0].canManage, true);
  assert.equal(result.kits[1].canManage, false);
  assert.deepEqual(Array.from(result.kits[1].locations, location => location.ready), [0, 0], 'Split stock must not form one kit across two stores');
  assert.deepEqual(Array.from(result.kits[1].locations, location => location.status), ['partial', 'partial']);
  assert.equal(result.kits[2].locations.length, 0, 'A kit without an active warehouse is still visible');
  assert.equal(result.kits[2].ready, 0);
  assert.equal(result.kits[2].priceCents, 110000);
  assert.equal(result.currentStores.length, 1);
  assert.equal(result.currentBranchId, 'a');
  const filtered = await listNetworkKits(context, { branchId: 'b', q: 'АКПП' });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.kits[0].id, 'kit-b');
  assert.equal((await listNetworkKits(context, { q: 'несуществующий' })).total, 0);
  assert.equal((await listNetworkKits(context, { archived: true })).total, 0);
  const queryCount = calls.length;
  for (const branchId of ['hidden', 'foreign']) await assert.rejects(() => listNetworkKits(context, { branchId }), /Нет доступа/);
  assert.equal(calls.length, queryCount, 'An unauthorized branch must be rejected before database reads');
  for (const call of calls) {
    assert.equal(call.tenant.mode, 'all');
    assert.ok(call.args.where.branchId.in.every(id => ['a', 'b', 'empty'].includes(id)));
    assert.throws(() => applyBranchQueryPolicy('ProductKit', 'updateMany', { where: { branchId: 'b' }, data: { archived: true } }, call.tenant), /изменения запрещены/);
  }
  const localOnly = { ...context, branches: [branch('a')] };
  assert.equal((await listNetworkKits(localOnly, {})).total, 1);
  const all = await listNetworkKits({ ...context, mode: 'all', branchId: null, branch: null }, {});
  assert.equal(all.canCreate, false);
  assert.ok(all.kits.every(kit => !kit.canManage));
  for (let index = 0; index < 31; index++) records.push(makeKit(`extra-${index}`, 'a', 'Дополнительный'));
  assert.equal((await listNetworkKits(context, { branchId: 'a' })).kits.length, 30);
  const secondPage = await listNetworkKits(context, { branchId: 'a', page: 1 });
  assert.equal(secondPage.total, 32);
  assert.equal(secondPage.kits.length, 2);
});
// A caller-selected branch must never expand local shipment reads or writes.
assert.throws(() => applyBranchQueryPolicy('ProductKit', 'findMany', { where: { branchId: 'b' } }, { mode: 'branch', branchId: 'a', allowedBranchIds: ['a'] }), /другого филиала/);
console.log('product kit network: shared authorized catalog, per-store availability, pagination, filters and isolated writes: ok');
let routeContext;
let authorized = false;
const endpoint = load('../src/app/api/product-kits/network/route.ts', {
  'next/server': { NextResponse: { json: data => data } },
  '@/lib/branch-api': { requireBranchApi: async options => { assert.equal(options.allowAll, true); assert.equal(options.requireActive, false); return authorized ? { ok: true, context } : { ok: false, response: { status: 401 } }; } },
  '@/lib/product-kit-api-error': { kitErrorResponse: error => ({ error: error.message, status: error.status }) },
  '@/lib/product-kit-network': { listNetworkKits: async (verifiedContext, input) => { routeContext = verifiedContext; return listNetworkKits(verifiedContext, input); } },
});
assert.equal((await endpoint.GET({ nextUrl: new URL('https://example.test/api/product-kits/network') })).status, 401);
authorized = true;
const response = await endpoint.GET({ nextUrl: new URL('https://example.test/api/product-kits/network?branchId=b&page=-10&q=%20АКПП%20') });
assert.equal(response.total, 1);
assert.equal(routeContext, context, 'The endpoint must use the authenticated scope');
assert.equal((await endpoint.GET({ nextUrl: new URL('https://example.test/api/product-kits/network?branchId=hidden') })).status, 403);
