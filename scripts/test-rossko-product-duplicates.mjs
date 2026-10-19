import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@': resolve('src') } });
const { isRosskoArticleDuplicate, findRosskoArticleDuplicate } = await jiti.import('../src/lib/rossko-product-duplicate.ts');
const input = { article: 'W 712/95', brand: 'MANN-FILTER' };
const existing = { id: 'existing', name: 'Existing filter', article: 'W-712/95', brand: 'MANN',
  uomName: 'шт.', packageVolume: '1', weight: '0.2', modificationCode: 'legacy' };
assert.equal(isRosskoArticleDuplicate(existing, input), true, 'packaging and legacy units must not bypass the article check');
assert.equal(isRosskoArticleDuplicate({ ...existing, brand: null }, input), true);
assert.equal(isRosskoArticleDuplicate({ ...existing, brand: 'OTHER' }, input), false);
assert.equal(isRosskoArticleDuplicate({ ...existing, article: 'C27161' }, { ...input, article: 'C2716/1' }), false);
assert.equal(isRosskoArticleDuplicate({ ...existing, article: 'W712/950' }, input), false);
assert.equal(isRosskoArticleDuplicate({ ...existing, article: null, rosskoPartNumber: 'W712/95', rosskoBrand: 'MANN FILTER' }, input), true);
assert.equal(isRosskoArticleDuplicate(existing, { ...input, article: '' }), false);
const client = { $queryRaw: async sql => {
  assert.match(sql.sql, /branch_id = \?/);
  assert.match(sql.sql, /archived = false/);
  assert.match(sql.sql, /entity_type <> 'service'/);
  assert.ok(sql.values.includes('branch-test'));
  return [{ ...existing, article: 'W712/950' }, existing];
} };
assert.equal((await findRosskoArticleDuplicate(client, { ...input, branchId: 'branch-test' })).id, existing.id);

const dir = await mkdtemp(join(tmpdir(), 'rossko-duplicate-test-'));
const h = globalThis.__rosskoDuplicateTest = { rows: [], created: 0, session: { user: { id: 'tester' } }, searchCalls: 0 };
let gate = Promise.resolve();
const checkSQL = sql => {
  assert.ok(sql.values.includes('branch-test'));
  assert.match(sql.sql, /archived = false/);
  return h.rows;
};
h.db = {
  $queryRaw: async sql => checkSQL(sql),
  localProduct: { findMany: async () => [] }, localCounterparty: { findMany: async () => [] },
  $transaction: async operation => {
    let release;
    const tx = { $queryRaw: async sql => {
      if (sql.sql.includes('pg_advisory_xact_lock')) {
        assert.ok(sql.values.includes('product-article:branch-test:W71295'));
        const previous = gate;
        gate = new Promise(resolve => { release = resolve; });
        await previous;
        return [{ locked: '' }];
      }
      assert.ok(release, 'lock must precede duplicate lookup');
      return checkSQL(sql);
    } };
    tx.__create = payload => {
      assert.ok(release, 'create must hold transaction lock');
      const product = { id: `created-${++h.created}`, ...payload };
      h.rows.push(product);
      return { ok: true, product };
    };
    try { return await operation(tx); } finally { release?.(); }
  },
};
try {
  const stubs = {
    auth: 'exports.getSession = async () => globalThis.__rosskoDuplicateTest.session;',
    branch: 'exports.requireBranchApi = async () => ({ok:true, context:{branchId:"branch-test"}}); exports.runWithBranchApiContext = async (context, fn) => fn();',
    db: 'exports.prisma = globalThis.__rosskoDuplicateTest.db;',
    admin: 'exports.productPayloadHasMarkingSettings = () => false; exports.canManageWarehouseMarking = () => true; exports.supplierCounterpartyIdentityWhere = () => ({}); exports.createLocalAdminProduct = async (payload, user, branchId, options) => { if(options?.transaction) return options.transaction.__create(payload); throw new Error("ROSSKO save bypassed transaction guard"); };',
    rossko: 'exports.rosskoConfig = async () => ({deliveryId:"delivery"}); exports.rosskoSearch = async () => { globalThis.__rosskoDuplicateTest.searchCalls++; return {PartsList:{Part:{guid:"NSIN0023147296",brand:"MANN-FILTER",partnumber:"W 712/95",name:"Фильтр масляный"}}}; };',
    integration: 'exports.rosskoIntegrationError = () => ({error:"provider unavailable"});',
    importer: 'exports.buildRosskoProductName = p => p.sourceName; exports.recommendedRosskoRetailCents = () => null; exports.suggestRosskoProductGroup = () => "Фильтры";',
  };
  const alias = { '@': resolve('src') };
  const names = { auth:'auth', branch:'branch-api', db:'db', admin:'local-inventory-admin', rossko:'rossko', integration:'rossko-integration', importer:'rossko-product-import' };
  for (const [name, code] of Object.entries(stubs)) {
    const path = join(dir, `${name}.cjs`);
    await writeFile(path, code);
    alias[`@/lib/${names[name]}`] = path;
  }
  const isolated = createJiti(import.meta.url, { moduleCache:false, alias });
  const create = await isolated.import('../src/app/api/local-inventory/products/route.ts');
  const preview = await isolated.import('../src/app/api/products/rossko/link/route.ts');
  const payload = { ...input, name:'New filter', entityType:'product', uomName:'шт', rosskoPartNumber:input.article, groupPath:'Фильтры', minimumBalance:'1' };
  const request = body => new Request('https://example.test/api', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  h.rows = [existing];
  let response = await preview.POST(request({url:'https://kgd.rossko.ru/product/?text=NSIN0023147296'}));
  assert.equal(response.status,409);
  assert.equal((await response.json()).existingProduct.id,'existing');
  assert.equal(h.searchCalls,1,'duplicate check must precede optional OEM search');
  response = await create.POST(request(payload));
  assert.equal(response.status,409);
  assert.equal(h.created,0);
  h.rows = [];
  response = await preview.POST(request({url:'https://kgd.rossko.ru/product/?text=NSIN0023147296'}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).fields.minimumBalance,'1');
  const parallel = await Promise.all([create.POST(request(payload)),create.POST(request(payload))]);
  assert.deepEqual(parallel.map(r=>r.status).sort(),[200,409]);
  assert.equal(h.created,1,'parallel saves create only one product');
  h.session = null;
  assert.equal((await create.POST(request(payload))).status,401);
  assert.equal((await preview.POST(request({url:'invalid'}))).status,401);
} finally {
  delete globalThis.__rosskoDuplicateTest;
  await rm(dir,{recursive:true,force:true});
}
console.log('ROSSKO duplicate guards: article identity, branch filters, preview/save conflicts, minimum balance and parallel saves passed');
