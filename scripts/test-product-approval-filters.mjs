import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
const dir=mkdtempSync(resolve(tmpdir(),'approval-filters-'));
try {
const fixture=(id,fields)=>({id,name:`Масло ${id}`,article:id,entityType:'product',groupPath:'Моторные масла',uomName:'шт',brand:'TEST',salePriceCents:500000,updatedAt:new Date('2026-10-23'),stockBalances:[],photos:[],storageAssignments:[],storefrontBindings:[],...fields});
const rows=[fixture('multi',{acea:'C3; C4',aceaExtra:'C4',ilsac:'GF-6A',oem:'BMW Longlife-04; VW 504.00/507.00'}),fixture('legacy',{aceaExtra:'C4',ilsac:'GF-5'}),fixture('other',{acea:'C3',ilsac:'GF-6A',oem:'MB 229.51'}),fixture('transmission',{groupPath:'Трансмиссионные масла',atf:'Dexron VI; Dexron III',oemAtf:'MB 236.14'})];
writeFileSync(resolve(dir,'db.cjs'),`exports.prisma={$queryRaw:async()=>[],localProduct:{findMany:async()=>${JSON.stringify(rows)}.map(row=>({...row,updatedAt:new Date(row.updatedAt)}))}}`);
writeFileSync(resolve(dir,'tenant.cjs'),'exports.getScopedBranchId=()=>"fixture";');
const jiti=createJiti(import.meta.url,{interopDefault:true,alias:{'@/lib/db':resolve(dir,'db.cjs'),'@/lib/request-tenant-store':resolve(dir,'tenant.cjs'),'@':resolve('src')}});
const {searchCatalog,normalizeCatalogProductSelectionSnapshot}=await jiti.import('../src/lib/catalog-search.ts');
const search=filters=>searchCatalog({context:'products',...filters});
const ids=result=>result.products.map(row=>row.id).sort();
assert.deepEqual(ids(await search({q:'C4'})),['legacy','multi'],'the main search also finds a short specification');
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
console.log('Product approval filters: legacy ACEA, multivalue, AND/OR, OEM identity, ATF, pagination, counts and bulk selections passed');

}finally{rmSync(dir,{recursive:true,force:true});}
