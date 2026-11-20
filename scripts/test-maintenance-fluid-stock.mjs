import assert from 'node:assert/strict';import{resolve}from'node:path';import{createJiti}from'jiti';
const mock=resolve('scripts/fixtures/maintenance-fluid-stock-mocks.mjs'),j=createJiti(import.meta.url,{alias:{'@':resolve('src'),'@/lib/db':mock,'@/lib/auth':mock,'@/lib/branch-api':mock}});
const {loadMaintenanceFluidStock:load}=await j.import('../src/lib/maintenance-fluid-stock.ts');
const {POST}=await j.import('../src/app/api/maintenance-quote/fluid-stock/route.ts');
const balance=(storeId,available,branchId='branchA')=>({storeId,available,branchId});
const product=(id,fields={})=>({id,name:id,article:id,brand:'Test',branchId:'branchA',archived:false,entityType:'product',groupPath:'Трансмиссионные масла',sae:'75W-90',oem:'',atf:'Toyota WS',oemAtf:'',apiSpec:'GL-4',searchText:'',uomName:'шт.',packageVolume:'1 л',salePriceCents:12345,stockBalances:[balance('storeA',2),balance('storeB',99)],...fields});
const state=globalThis[Symbol.for('maintenance-fluid-stock-test')]={authenticated:true,denied:false,rows:[],contexts:[],storeQueries:[],productQueries:[],stores:[{id:'storeA',branchId:'branchA'},{id:'storeB',branchId:'branchB'}]};
const base={branchId:'branchA',storeId:'storeA'};
state.rows=[product('WS'),product('wrong-engine',{groupPath:'Моторные масла'}),product('name-only',{atf:'',name:'Toyota WS'}),product('negative',{atf:'Toyota WS;not approved Toyota WS'}),product('false-official',{attributes:{official_approval:false}}),product('other-store',{stockBalances:[balance('storeX',99)]}),product('other-branch',{branchId:'branchB',stockBalances:[balance('storeA',99,'branchB')]}),product('service',{entityType:'service'}),product('archived',{archived:true}),product('wrong-viscosity',{sae:'80W-90'}),product('missing-viscosity',{sae:''})];
let response=await load({...base,systemCode:'AUTOMATIC_TRANSMISSION',specifications:['Toyota WS'],viscosity:'75W90'});
assert.deepEqual(response.products.map(row=>row.id),['WS','false-official']);assert.equal(response.products[0].available,2);assert.equal(response.products[0].price,123.45);assert.equal(response.products[0].litresPerUnit,1);
for(const row of response.products){assert.equal(row.approvalStatus,'unknown');assert.equal(row.requiresManualReview,true);assert.equal(typeof row.compatibilityEvidence,'string');}
response=await load({...base,systemCode:'AUTOMATIC_TRANSMISSION',specifications:['Toyota WS; SAE 75W-90']});
assert.deepEqual(response.products.map(row=>row.id),['WS','false-official'],'inline SAE must constrain the SAE field instead of being lost or compared to OEM declarations');
assert.deepEqual((await load({...base,systemCode:'AUTOMATIC_TRANSMISSION',specifications:['Toyota WS; SAE 75W-90'],viscosity:'80W-90'})).products,[],'conflicting inline and selected viscosities cannot be ignored');
assert.deepEqual((await load({...base,systemCode:'AUTOMATIC_TRANSMISSION',specifications:['SAE 75W-90']})).products,[],'viscosity alone never proves the required fluid specification');
assert.deepEqual(state.productQueries[0].select.stockBalances.where,{branchId:'branchA',storeId:'storeA'});assert.deepEqual(state.productQueries[0].where.stockBalances,{some:{branchId:'branchA',storeId:'storeA',available:{gt:0}}});
response=await load({...base,systemCode:'MANUAL_TRANSMISSION',specifications:['Toyota WS','API GL-5'],viscosity:'75W-90'});assert.deepEqual(response.products,[],'every supplied technical specification must match');
response=await load({...base,systemCode:'MANUAL_TRANSMISSION',specifications:['Toyota WS','API GL-4'],viscosity:'75W-90'});assert.equal(response.products.length,2,'gear API field participates positively');
response=await load({...base,systemCode:'MANUAL_TRANSMISSION',specifications:['API GL-4+'],viscosity:'75W-90'});assert.equal(response.products.length,0,'GL4 is not inferred equivalent to GL4+');
response=await load({...base,systemCode:'MANUAL_TRANSMISSION',specifications:['Toyota WS'],viscosity:'unknown'});assert.equal(response.products.length,0);assert.ok(response.reason);
state.rows=[product('DOT4',{groupPath:'Тормозные жидкости',atf:'',oem:'DOT 4'}),product('DOT4-LV',{groupPath:'Тормозные жидкости',atf:'',oem:'DOT4LV'}),product('coolant-dot',{groupPath:'Антифриз',atf:'',oem:'DOT4'}),product('DOT-name-only',{groupPath:'Тормозные жидкости',atf:'',name:'DOT 4'}),product('DOT-negative',{groupPath:'Тормозные жидкости',atf:'',oem:'DOT 4',searchText:'not approved DOT 4'})];
response=await load({...base,systemCode:'BRAKE_FLUID',specifications:['DOT4']});assert.deepEqual(response.products.map(row=>row.id),['DOT4']);
response=await load({...base,systemCode:'BRAKE_FLUID',specifications:['DOT4','ISO CLASS 6']});assert.equal(response.products.length,0,'DOT4 alone does not prove low-viscosity ISO class6');
state.rows=[product('coolant-proof',{groupPath:'Антифриз',atf:'',oem:'GLACEOL RX (тип D)',packageVolume:'5 л'}),product('coolant-name-only',{groupPath:'Антифриз',atf:'',name:'GLACEOL RX (тип D)'}),product('coolant-wrong-type',{groupPath:'Тормозные жидкости',atf:'',oem:'GLACEOL RX (тип D)'})];
response=await load({...base,systemCode:'ENGINE_COOLANT',specifications:['GLACEOL RX (тип D)']});assert.deepEqual(response.products.map(row=>row.id),['coolant-proof']);assert.equal(response.products[0].litresPerUnit,5);
state.rows=[product('G12',{groupPath:'Антифриз',atf:'',oem:'G12'}),product('G12++',{groupPath:'Антифриз',atf:'',oem:'G12++'})];
response=await load({...base,systemCode:'ENGINE_COOLANT',specifications:['G12++']});assert.deepEqual(response.products.map(row=>row.id),['G12++'],'G12 must not match the meaningful G12++ suffix');
response=await load({...base,systemCode:'ENGINE_COOLANT',specifications:['G12']});assert.deepEqual(response.products.map(row=>row.id),['G12'],'G12++ is not inferred backward-equivalent without a verified rule');
state.rows=[product('explicit-CVT',{groupPath:'Трансмиссионные масла / CVT',atf:'Nissan NS-2'})];
response=await load({...base,systemCode:'AUTOMATIC_TRANSMISSION',specifications:['Nissan NS-2']});assert.equal(response.products.length,0,'an explicit CVT family cannot silently become conventional ATF');
response=await load({...base,systemCode:'CVT_TRANSMISSION',specifications:['Nissan NS-2']});assert.equal(response.products.length,1);
state.rows=[product('PS-proof',{groupPath:'Жидкости ГУР',atf:'',oem:'CHF 11S',uomName:'л',packageVolume:null,stockBalances:[balance('storeA',4.7)]}),product('PS-ATF-unproven',{groupPath:'Трансмиссионные масла',atf:'CHF 11S'}),product('PS-package-unknown',{groupPath:'Жидкости ГУР',atf:'',oem:'CHF 11S',packageVolume:null})];
response=await load({...base,systemCode:'POWER_STEERING',specifications:['CHF 11S']});assert.deepEqual(response.products.map(row=>row.id),['PS-proof','PS-package-unknown']);assert.equal(response.products[0].litresPerUnit,1);assert.equal(response.products[0].available,4.7);assert.equal(response.products[1].litresPerUnit,null,'incomplete package is not invented from technical spec');assert.ok(response.products[1].requiresManualReview);
state.rows=[
 product('PS-Dexron-II',{groupPath:'Трансмиссионные масла / ATF',sae:'',atf:'Dexron II'}),
 product('PS-Dexron-OEM-field',{groupPath:'Трансмиссионные масла / ATF',sae:'',atf:'',oemAtf:'Dexron II'}),
 product('PS-wrong-Dexron-III',{groupPath:'Трансмиссионные масла / ATF',sae:'',atf:'Dexron III'}),
 product('PS-gear-SAE',{groupPath:'Трансмиссионные масла / ATF',sae:'75W-90',atf:'Dexron II'}),
 product('PS-synthetic-gear',{groupPath:'Трансмиссионные масла / ATF gear oil',sae:'',atf:'Dexron II'}),
 product('PS-CVT',{groupPath:'Трансмиссионные масла / CVT ATF',sae:'',atf:'Dexron II'}),
 product('PS-Dexron-name-only',{groupPath:'Трансмиссионные масла / ATF',sae:'',name:'ATF Dexron II',atf:''}),
 product('PS-Dexron-engine-OEM-only',{groupPath:'Трансмиссионные масла / ATF',sae:'',atf:'',oem:'Dexron II'}),
 product('PS-generic-transmission',{groupPath:'Трансмиссионные масла',sae:'',atf:'Dexron II'}),
 product('PS-negative-Dexron',{groupPath:'Трансмиссионные масла / ATF',sae:'',atf:'Dexron II',searchText:'not approved Dexron II'}),
];
response=await load({...base,systemCode:'POWER_STEERING',specifications:['ATF DEXRON II']});
assert.deepEqual(response.products.map(row=>row.id),['PS-Dexron-II','PS-Dexron-OEM-field'],'a primary exact PS DexronII requirement may use the same positively declared class on explicitly typed ATF, never a different class or role');
assert.ok(response.products.every(row=>row.requiresManualReview&&row.approvalStatus==='unknown'));
state.rows.push(product('ATF-claims-CHF',{groupPath:'Трансмиссионные масла / ATF',sae:'',atf:'CHF 11S'}));
response=await load({...base,systemCode:'POWER_STEERING',specifications:['CHF 11S']});assert.equal(response.products.length,0,'CHF does not authorize any ATF cross-role exception');
response=await load({...base,systemCode:'POWER_STEERING',specifications:['Dexron']});assert.equal(response.products.length,0,'unversioned Dexron is insufficient exact-grade proof');
state.rows=[product('PS-Dexron-IID',{groupPath:'Трансмиссионные масла / ATF',sae:'',atf:'Dexron II D'})];
response=await load({...base,systemCode:'POWER_STEERING',specifications:['DEXRON IID']});assert.equal(response.products.length,1,'verified dictionary spelling is retained for an exact grade');
response=await load({...base,systemCode:'POWER_STEERING',specifications:['DEXRON II']});assert.equal(response.products.length,0,'IID is not silently promoted to broader II or vice versa');
state.rows[0].searchText='not approved Dexron II D';
response=await load({...base,systemCode:'POWER_STEERING',specifications:['DEXRON IID']});assert.equal(response.products.length,0,'negative declarations retain the same verified spelling normalization as positives');

for(const [systemCode,groupPath,specification,apiSpec,viscosity] of [
 ['ROBOT_TRANSMISSION','Трансмиссионные масла / DSG','VW G 052 182','',undefined],
 ['TRANSFER_CASE','Раздаточные масла','Toyota LF','',undefined],
 ['FRONT_DIFFERENTIAL','Редукторные масла','API GL-5','GL-5','75W-90'],
 ['REAR_DIFFERENTIAL','Редукторные масла','API GL-5','GL-5','75W-90'],
 ['AWD_COUPLING','Трансмиссионные масла','VW G 060 175','',undefined],
]){
 state.rows=[product('per-system',{groupPath,atf:specification,apiSpec})];
 const found=await load({...base,systemCode,specifications:[specification],viscosity});
 assert.equal(found.products.length,1,systemCode+' must use the same positive structured compatibility boundary');assert.equal(found.products[0].requiresManualReview,true);
}
state.rows=[product('invalid-bulk-unit',{groupPath:'Жидкости ГУР',atf:'',oem:'CHF 11S',uomName:'шт.',packageVolume:'200 л',markingMode:'BULK_OIL_FROM_MARKED_BARREL'})];
assert.equal((await load({...base,systemCode:'POWER_STEERING',specifications:['CHF 11S']})).products[0].litresPerUnit,null,'actual loader must preserve invalid marked bulk packaging as a blocked card');
state.rows=[product('PS-proof',{groupPath:'Жидкости ГУР',atf:'',oem:'CHF 11S',uomName:'л',packageVolume:null,stockBalances:[balance('storeA',4.7)]})];
await assert.rejects(()=>load({...base,systemCode:'ENGINE_OIL',specifications:['BMW LL04']}),/Unsupported/);
const request=body=>new Request('http://local/api/maintenance-quote/fluid-stock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const body={storeId:'storeA',systemCode:'POWER_STEERING',specifications:['CHF 11S']};
state.authenticated=false;assert.equal((await POST(request(body))).status,401);state.authenticated=true;state.denied=true;assert.equal((await POST(request(body))).status,403);state.denied=false;
assert.equal((await POST(request({...body,storeId:'storeB'}))).status,404,'foreign branch store is not available');assert.equal((await POST(request({...body,systemCode:'ENGINE_OIL'}))).status,400);assert.equal((await POST(request({...body,specifications:[]}))).status,400);
let http=await POST(request(body));assert.equal(http.status,200);assert.equal(http.headers.get('Cache-Control'),'no-store');assert.equal((await http.json()).products[0].available,4.7);
state.fail=true;http=await POST(request(body));assert.equal(http.status,500);assert.doesNotMatch(JSON.stringify(await http.json()),/private|database URL/);
delete globalThis[Symbol.for('maintenance-fluid-stock-test')];console.log('PASS generic fluid stock: strict family/declarations, cumulative specs, mandatory supplied gear SAE, negatives, no inferred approval/name proof, chosen branch/store, bulk/package, authenticated route and safe errors');
