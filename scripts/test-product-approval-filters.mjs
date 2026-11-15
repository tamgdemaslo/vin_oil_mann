import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
const dir=mkdtempSync(resolve(tmpdir(),'approval-filters-'));
try {
const fixture=(id,fields)=>({id,name:`Масло ${id}`,article:id,entityType:'product',groupPath:'Моторные масла',uomName:'шт',brand:'TEST',salePriceCents:500000,updatedAt:new Date('2026-10-23'),stockBalances:[],photos:[],storageAssignments:[],storefrontBindings:[],...fields});
const rows=[fixture('cross-mobil',{name:'Воздушный фильтр',brand:'Filtron',oemParts:'MOBIL ADV100'}),fixture('mobil-one',{name:'Mobil 1 ESP',brand:'Mobil'}),fixture('mobil-super',{name:'Mobil Super',brand:'Mobil'}),fixture('multi',{name:'Bardahl XTEC 5W-30',brand:'Bardahl',stockBalances:[{storeId:'test-store',quantity:2,reserve:0,available:2}],acea:'C3; C4',aceaExtra:'C4',ilsac:'GF-6A',oem:'BMW Longlife-04; VW 504.00/507.00'}),fixture('legacy',{brand:'Mannol',aceaExtra:'C4',ilsac:'GF-5'}),fixture('other',{acea:'C3',ilsac:'GF-6A',oem:'MB 229.51'}),fixture('transmission',{groupPath:'Трансмиссионные масла',atf:'Dexron VI; Dexron III',oemAtf:'MB 236.14'})];
const primaryBranch = { version: 'initial', rows, cardReads: 0, stockReads: 0 };
const secondaryBranch = { version: 'initial', rows: [fixture('second-only', { name: 'Mobil 1 other branch' })], cardReads: 0, stockReads: 0 };
const catalogFixture = globalThis.__catalogCacheTest = {
  currentBranch: 'fixture',
  branches: { fixture: primaryBranch, 'other-branch': secondaryBranch },
};
writeFileSync(resolve(dir,'db.cjs'), `
const state = globalThis.__catalogCacheTest;
const branch = () => state.branches[state.currentBranch];
exports.prisma = {
  $queryRaw: async (query, branchId) => Array.isArray(query) ? [{ version: state.branches[branchId].version }] : [],
  localProduct: {
    count: async () => branch().rows.length,
    findMany: async ({ include, select, where }) => {
      if (select?.stockBalances) {
        const source = state.branches[where.branchId];
        source.stockReads++;
        return source.rows.map(({id, stockBalances}) => ({id, stockBalances: structuredClone(stockBalances)}));
      }
      if (!include.stockBalances) {
        const source = state.branches[where.branchId];
        source.cardReads++;
        return source.rows.map(({stockBalances, ...card}) => structuredClone(card));
      }
      return structuredClone(branch().rows);
    },
  },
};
`);
writeFileSync(resolve(dir,'tenant.cjs'),'exports.getScopedBranchId = () => globalThis.__catalogCacheTest.currentBranch;');
const jiti=createJiti(import.meta.url,{interopDefault:true,alias:{'@/lib/db':resolve(dir,'db.cjs'),'@/lib/request-tenant-store':resolve(dir,'tenant.cjs'),'@':resolve('src')}});
const {searchCatalog,normalizeCatalogProductSelectionSnapshot}=await jiti.import('../src/lib/catalog-search.ts');
const search=filters=>searchCatalog({context:'products',...filters});
const ids=result=>result.products.map(row=>row.id).sort();
assert.deepEqual(ids(await search({q:'C4'})),['legacy','multi'],'the main search also finds a short specification');
assert.deepEqual(ids(await search({q:'Bardahl XTEC 5W-30'})),['multi'],'search finds the brand, series and viscosity together');
assert.deepEqual((await search({q:'mobil',sort:'relevance'})).products.map(row=>row.id),['mobil-one','mobil-super','cross-mobil'],'product names rank above cross-references for a brand search');
assert.deepEqual((await search({q:'mobil',sort:'name'})).products.map(row=>row.id),['cross-mobil','mobil-one','mobil-super'],'explicit name sorting stays alphabetical');
assert.deepEqual(ids(await search({q:'mobil 1'})),['mobil-one'],'a single digit matches the series as a whole token');
const branded = await search({brand:['bardahl'],acea:['C4'],stock:'inStock'});
assert.deepEqual(ids(branded),['multi']);
assert.deepEqual(branded.meta.facets.stock,{all:1,inStock:1,outOfStock:0});
const brands = await search({brand:['Bardahl'],acea:['C4']});
assert.deepEqual(brands.meta.facets.brands.map(option=>option.value),['Bardahl','Mannol'],'show other brands that match the selected approval');
const sorted = await search({acea:['C4'],sort:'brand',direction:'desc',limit:1});
assert.equal(sorted.products[0].id,'legacy');
assert.equal((await search({acea:['C4'],sort:'brand',direction:'desc',limit:1,offset:1})).products[0].id,'multi');
assert.deepEqual(ids(await search({acea:['C4']})),['legacy','multi'],'C4 includes multivalue and legacy ACEA');
assert.deepEqual(ids(await search({acea:['C4'],ilsac:['GF-6A']})),['multi'],'different standards intersect');
assert.deepEqual(ids(await search({ilsac:['GF-5','GF-6A']})),['legacy','multi','other'],'values within one standard are alternatives');
assert.deepEqual(ids(await search({engineOem:['VW 504.00/507.00']})),['multi'],'compound OEM remains atomic');
assert.deepEqual(ids(await search({engineOem:['VW 504.00']})),[],'partial OEM is not treated as verified full approval');
assert.deepEqual(ids(await search({atf:['Dexron VI'],oemAtf:['MB 236.14']})),['transmission']);
assert.deepEqual(ids(await search({acea:['C4'],ilsac:['GF-7B']})),[],'impossible combination gives empty results');
const result=await search({acea:['C4'],limit:1});
assert.equal(result.meta.total,2);assert.equal(result.meta.hasMore,true);
assert.equal(result.meta.facets.acea.find(x=>x.value==='C4').count,2,'duplicate legacy values count once per product');
assert.ok(result.meta.filterOptions.ilsac.includes('GF-6A'));
assert.equal(result.meta.facets.ilsac.find(x=>x.value==='GF-6A').count,1,'facet counts honor other selected standards');
const snapshot=normalizeCatalogProductSelectionSnapshot({ilsac:['GF-6A'],engineOem:['BMW Longlife-04'],atf:['Dexron VI'],oemAtf:['MB 236.14']});
assert.deepEqual(snapshot.engineOem,['BMW Longlife-04'],'bulk selections preserve approval filters');
assert.deepEqual(snapshot.ilsac,['GF-6A']);assert.deepEqual(snapshot.atf,['Dexron VI']);assert.deepEqual(snapshot.oemAtf,['MB 236.14']);
const inventorySearch = filters => searchCatalog({ context: 'products', ...filters }, { cacheInventoryCards: true });
const [initialStock, initialText] = await Promise.all([
  inventorySearch({ brand: ['Bardahl'], stock: 'inStock' }),
  inventorySearch({ q: 'mobil', sort: 'relevance' }),
]);
assert.deepEqual(ids(initialStock), ['multi']);
assert.deepEqual(initialText.products.map(row => row.id), ['mobil-one', 'mobil-super', 'cross-mobil']);
assert.equal(primaryBranch.cardReads, 1, 'concurrent searches share one card snapshot');
assert.equal(primaryBranch.stockReads, 2, 'each search reads current balances');
const multi = primaryBranch.rows.find(row => row.id === 'multi');
multi.stockBalances[0].reserve = 2;
multi.stockBalances[0].available = 0;
const afterReservation = await inventorySearch({ brand: ['Bardahl'], stock: 'outOfStock' });
assert.equal(afterReservation.products[0].totalQuantity, 2);
assert.equal(afterReservation.products[0].totalReserve, 2);
assert.equal(afterReservation.products[0].totalAvailable, 0);
assert.deepEqual(afterReservation.meta.facets.stock, { all: 1, inStock: 0, outOfStock: 1 });
assert.equal(primaryBranch.cardReads, 1, 'stock-only changes reuse card data');
multi.name = 'Bardahl renamed';
primaryBranch.version = 'changed';
assert.equal((await inventorySearch({ brand: ['Bardahl'] })).products[0].name, 'Bardahl renamed');
assert.equal(primaryBranch.cardReads, 2, 'a newer database version refreshes the cards');
catalogFixture.currentBranch = 'other-branch';
assert.deepEqual(ids(await inventorySearch({ q: 'mobil' })), ['second-only']);
assert.equal(secondaryBranch.cardReads, 1, 'a second branch has its own cache');
catalogFixture.currentBranch = 'fixture';
assert.deepEqual(ids(await inventorySearch({ q: 'mobil' })), ['cross-mobil', 'mobil-one', 'mobil-super']);
assert.equal(primaryBranch.cardReads, 2, 'returning to the first branch reuses only its snapshot');
console.log('Product approval filters: legacy ACEA, multivalue, AND/OR, OEM identity, ATF, pagination, counts and bulk selections passed');

}finally{delete globalThis.__catalogCacheTest;rmSync(dir,{recursive:true,force:true});}
