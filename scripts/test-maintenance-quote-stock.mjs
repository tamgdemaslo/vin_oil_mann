import assert from 'node:assert/strict';import{resolve}from'node:path';import{createJiti}from'jiti';
const mock=resolve('scripts/fixtures/maintenance-quote-stock-mock.mjs'),j=createJiti(import.meta.url,{alias:{'@':resolve('src'),'@/lib/db':mock}});
const {loadMaintenanceQuoteStock:load}=await j.import('../src/lib/maintenance-quote-stock.ts');
const balance=(storeId,available,branchId='branchA')=>({branchId,storeId,available});
const product=(id,fields={})=>({id,branchId:'branchA',archived:false,name:id,article:id,brand:'Test',entityType:'product',groupPath:'Моторные масла',sae:'5W-30',oem:'',acea:'C3',apiSpec:'SL',ilsac:'',uomName:'шт.',packageVolume:'1 л',salePriceCents:10000,stockBalances:[balance('storeA',2),balance('storeB',99)],...fields});
const state=globalThis[Symbol.for('maintenance-quote-stock-test')]={queries:[],rows:[
 product('BMW',{oem:'BMW Longlife-04'}),product('C3-SP',{apiSpec:'SP'}),product('C3-SL'),
 product('other-warehouse',{oem:'BMW Longlife-04',stockBalances:[balance('storeB',99)]}),
 product('other-branch',{branchId:'branchB',oem:'BMW Longlife-04',stockBalances:[balance('storeA',99,'branchB')]}),
 product('archived',{archived:true,oem:'BMW Longlife-04'}),product('service',{entityType:'service',oem:'BMW Longlife-04'}),
 product('ATF',{groupPath:'Трансмиссионные масла',oem:'BMW Longlife-04'}),product('BMW-no-SAE',{oem:'BMW Longlife-04',sae:''}),
 product('BMW-negative',{oem:'BMW Longlife-04',apiSpec:'not compatible BMW Longlife-04'}),
]};
const base={branchId:'branchA',storeId:'storeA'};
const simple=await load({...base,specification:'BMW Longlife-04',viscosity:'5W-30'});
assert.deepEqual(simple.map(row=>row.id),['BMW'],'simple current OEM path retained; wrong type, warehouse, branch, unknown SAE and negative declaration excluded');
assert.equal(simple[0].available,2,'must not sum the other warehouse99 units');
assert.equal(simple[0].price,100);assert.equal(simple[0].litresPerUnit,1);
assert.deepEqual(state.queries[0].where.stockBalances,{some:{branchId:'branchA',storeId:'storeA',available:{gt:0}}});
assert.deepEqual(state.queries[0].select.stockBalances.where,{branchId:'branchA',storeId:'storeA'});
const cumulative=await load({...base,specification:'ACEA C3; API SP',viscosity:'5W-30'});
assert.deepEqual(cumulative.map(row=>row.id),['C3-SP'],'ACEA alone must not hide a required API mismatch');
const manualViscosity=await load({...base,specification:'BMW Longlife-04',viscosity:''});
assert.ok(manualViscosity.some(row=>row.id==='BMW-no-SAE'),'blank viscosity remains the existing explicit manual-choice mode');
state.rows=[product('FORD',{oem:'Ford WSS-M2C948-B',sae:'5W-20'})];
assert.deepEqual((await load({...base,specification:'WSS-M2C948-B',viscosity:'5W-20'})).map(row=>row.id),['FORD'],'existing Ford custom OEM normalization retained');
state.rows=[product('ROZLIV',{oem:'BMW Longlife-04',uomName:'л',packageVolume:null,stockBalances:[balance('storeA',4.7),balance('storeB',100)]})];
assert.equal((await load({...base,specification:'BMW Longlife-04',viscosity:'5W-30'}))[0].available,4.7);
state.rows=[product('INVALID-BULK',{oem:'BMW Longlife-04',uomName:'шт.',packageVolume:'200 л',markingMode:'BULK_OIL_FROM_MARKED_BARREL'})];
assert.equal((await load({...base,specification:'BMW Longlife-04',viscosity:'5W-30'}))[0].litresPerUnit,null,'marked barrel requires liter sale unit before package calculations');
delete globalThis[Symbol.for('maintenance-quote-stock-test')];console.log('PASS actual stock-loader boundary: cumulative API/ACEA+SAE, simple BMW/Ford OEM, selected warehouse/branch stock, manual blank SAE, negative declarations and bulk liters');
