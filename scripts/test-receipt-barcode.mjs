import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':resolve('src')}});
const {normalizeBindableBarcode,productBarcodePatch,isProductBarcodeSearch}=await jiti.import('../src/lib/product-barcode-input.ts');
assert.equal(normalizeBindableBarcode(' 4006381333931\r\n'),'4006381333931');
for(const value of ['',null,'\x1d0100000000000000', 'a'.repeat(121),'кириллица'])assert.throws(()=>normalizeBindableBarcode(value));
assert.deepEqual(productBarcodePatch({},'4006381333931'),{barcodeEan13:'4006381333931'});
assert.deepEqual(productBarcodePatch({},'96385074'),{barcodeEan8:'96385074'});
assert.deepEqual(productBarcodePatch({barcodeEan13:'1234567890128'},'4006381333931'),{barcodeCode128:'4006381333931'});
assert.deepEqual(productBarcodePatch({code:'ECO-TEST'},'ECO-TEST'),{});
assert.throws(()=>productBarcodePatch({barcodeEan13:'old',barcodeEan8:'old',barcodeCode128:'old'},'new-code'));
assert.equal(isProductBarcodeSearch('4006381333931'),true);
assert.equal(isProductBarcodeSearch('ECO-ABC123'),true);
assert.equal(isProductBarcodeSearch('Фильтр масляный'),false);
const dir=await mkdtemp(join(tmpdir(),'receipt-barcode-test-'));
const context={branchId:'branch-test',businessGroupId:'business-test',userId:'tester'};
const fresh=(id,branchId='branch-test')=>({id,branchId,name:id,entityType:'product',archived:false,barcodeEan13:null,barcodeEan8:null,barcodeCode128:null,code:null,searchText:'',quantity:7});
const h=globalThis.__receiptBarcodeTest={products:[fresh('one'),fresh('two'),fresh('foreign','another-branch')],audits:[],invalidations:0,session:{user:{id:'tester'}},branch:{ok:true,context},lookups:0};
const locks=new Map();
const matches=(product,where)=>{
 assert.equal(where.branchId,'branch-test','all lookups stay inside the active branch');
 if(product.branchId!==where.branchId)return false;
 if(where.archived===false&&product.archived)return false;
 if(where.entityType?.not===product.entityType)return false;
 if(typeof where.id==='string'&&product.id!==where.id)return false;
 if(where.id?.not===product.id)return false;
 return !where.OR||where.OR.some(condition=>Object.entries(condition).some(([key,value])=>product[key]===value));
};
h.db={localProduct:{findMany:async({where})=>{h.lookups++;return h.products.filter(p=>matches(p,where));}},$transaction:async operation=>{
 const releases=[];
 const tx={
  $queryRaw:async sql=>{assert.match(sql.sql,/pg_advisory_xact_lock/);const key=sql.values[0];assert.ok(key.includes('branch-test'));const before=locks.get(key)||Promise.resolve();let release;const held=new Promise(resolve=>{release=resolve});locks.set(key,before.then(()=>held));await before;releases.push(release);return [{locked:''}];},
  localProduct:{findFirst:async({where})=>h.products.find(p=>matches(p,where))||null,update:async({where,data})=>{assert.equal(where.branchId,'branch-test');assert.ok(releases.length===2);assert.ok(Object.keys(data).every(key=>['barcodeEan13','barcodeEan8','barcodeCode128','searchText'].includes(key)),'binding must not change quantities or other catalog data');const p=h.products.find(p=>p.id===where.id);Object.assign(p,data);return p;}},
  branchAuditLog:{create:async({data})=>{assert.equal(data.branchId,'branch-test');h.audits.push(data);}},
 };
 try{return await operation(tx)}finally{for(const release of releases.reverse())release()}
}};
try{
 const stub={
  db:'exports.prisma=globalThis.__receiptBarcodeTest.db;',
  admin:'exports.invalidateProductFilterOptions=()=>{globalThis.__receiptBarcodeTest.invalidations++};exports.getLocalAdminProduct=async(id,branch)=>globalThis.__receiptBarcodeTest.products.find(p=>p.id===id&&p.branchId===branch);',
  auth:'exports.getSession=async()=>globalThis.__receiptBarcodeTest.session;',
  branch:'exports.requireBranchApi=async()=>globalThis.__receiptBarcodeTest.branch;exports.runWithBranchApiContext=async(ctx,fn)=>fn();',
 };
 const alias={'@':resolve('src')};const names={db:'db',admin:'local-inventory-admin',auth:'auth',branch:'branch-api'};
 for(const[name,code]of Object.entries(stub)){const path=join(dir,name+'.cjs');await writeFile(path,code);alias['@/lib/'+names[name]]=path}
 const isolated=createJiti(import.meta.url,{moduleCache:false,alias});
 const {bindReceiptProductBarcode}=await isolated.import('../src/lib/receipt-product-barcode.ts');
 const {GET,POST}=await isolated.import('../src/app/api/local-inventory/products/barcode/route.ts');
 const {NextRequest}=await isolated.import('next/server');
 const code='4006381333931';
 const get=barcode=>new NextRequest('https://example.test/api/local-inventory/products/barcode?'+new URLSearchParams({barcode}));
 const post=body=>new NextRequest('https://example.test/api/local-inventory/products/barcode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await (await GET(get(code))).json()).status,'NOT_FOUND');
 let result=await bindReceiptProductBarcode(context,{productId:'one',barcode:code});assert.equal(result.ok,true);
 assert.equal(h.products[0].barcodeEan13,code);assert.equal(h.products[0].quantity,7);assert.equal(h.audits.length,1);assert.equal(h.invalidations,1);
 result=await bindReceiptProductBarcode(context,{productId:'one',barcode:code});assert.equal(result.alreadyLinked,true);assert.equal(h.audits.length,1,'retry must be idempotent');
 assert.equal((await (await GET(get(code))).json()).product.id,'one');
 assert.equal((await POST(post({productId:'two',barcode:code}))).status,409);
 assert.equal((await POST(post({productId:'foreign',barcode:'ECO-FOREIGN'}))).status,404);
 h.products[1].archived=true;assert.equal((await POST(post({productId:'two',barcode:'ECO-ARCHIVED'}))).status,404);h.products[1].archived=false;
 h.products[1].entityType='service';assert.equal((await POST(post({productId:'two',barcode:'ECO-SERVICE'}))).status,404);h.products[1].entityType='product';
 const race=await Promise.all([bindReceiptProductBarcode(context,{productId:'one',barcode:'ECO-RACE'}),bindReceiptProductBarcode(context,{productId:'two',barcode:'ECO-RACE'})]);
 assert.equal(race.filter(r=>r.ok).length,1);assert.equal(race.filter(r=>r.status===409).length,1);
 h.products[1].barcodeEan13=code;assert.equal((await (await GET(get(code))).json()).status,'CONFLICT');h.products[1].barcodeEan13=null;
 assert.equal((await POST(post({productId:'one',barcode:'ECO-FULL'}))).status,409,'filled Code128 is preserved');
 assert.equal((await POST(post({productId:'one',barcode:'\x1d01000'}))).status,400);
 h.session=null;const before=h.lookups;assert.equal((await GET(get(code))).status,401);assert.equal((await POST(post({productId:'one',barcode:code}))).status,401);assert.equal(h.lookups,before);
 h.session={user:{id:'tester'}};h.branch={ok:false,response:Response.json({error:'Select a branch'},{status:409})};assert.equal((await GET(get(code))).status,409);assert.equal((await POST(post({productId:'one',barcode:code}))).status,409);
}finally{delete globalThis.__receiptBarcodeTest;await rm(dir,{recursive:true,force:true})}
console.log('Receipt barcode: permanent binding, exact lookup, branch isolation, conflicts, preserved fields, idempotency and concurrent owners passed');
