import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
const url=new URL(process.env.DATABASE_URL||'http://invalid');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/eco_barrels_test','Disposable local eco_barrels_test only');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve('src')}});
const {prisma}=await jiti.import('../src/lib/db.ts');
const lib=await jiti.import('../src/lib/bulk-oil-barrels.ts');
const {runWithRequestTenant}=await jiti.import('../src/lib/request-tenant-store.ts');
const branchId=`first-barrel-${randomUUID()}`,storeId=`${branchId}-store`,productId=`${branchId}-oil`;
const actor={login:'test',name:'Test',role:'owner'},code=(n)=>`010460123456789021${String(n).padStart(13,'0')}\u001d93abcd`;
const tx=(fn)=>prisma.$transaction(fn,{timeout:15000});
const product=()=>prisma.localProduct.findUnique({where:{id:productId}});
const attach=(volumeLiters=205,markingCode=code(1),id=productId)=>tx(t=>lib.attachExistingBarrelTx(t,{branchId,productId:id,storeId,volumeLiters,markingCode,actor}));
let checks=0;
async function check(name,fn){await fn();checks++;console.log(`PASS ${name}`);}
try{
 await prisma.businessGroup.create({data:{id:`${branchId}-group`,name:'Test',slug:`${branchId}-group`}});
 await prisma.branch.create({data:{id:branchId,businessGroupId:`${branchId}-group`,name:'Test branch',shortName:'TEST',slug:branchId}});
 await prisma.localStore.create({data:{id:storeId,branchId,name:'Test store'}});
 await prisma.localProduct.create({data:{id:productId,branchId,name:'GENESIS EURO 5W-40 на разлив',uomName:'л',markingEnabled:true,markingMode:'BULK_OIL_FROM_MARKED_BARREL',markingStatus:'REQUIRES_CHECK',markingSettings:{declaredVolumeLiters:205,currentVolumeLiters:54.998,allowRepeatedBarrelCode:true,partialWithdrawalEnabled:true}}});
 await prisma.localStockBalance.create({data:{branchId,productId,storeId,quantity:55,available:55,buyPriceCents:10000}});
 await runWithRequestTenant({mode:'branch',branchId,organizationId:branchId,allowedBranchIds:[branchId]},async()=>{
  await check('enable with 55 litres and no code succeeds and can be retried',async()=>{for(let i=0;i<2;i++)await tx(async t=>lib.enableWarehouseBarrelTrackingTx(t,branchId,await t.localProduct.findUnique({where:{id:productId}}),storeId,actor));const p=await product();assert.equal(p.markingSettings.barrelTrackingEnabled,true);assert.equal(p.markingSettings.activeBarrelId,'');assert.equal(await prisma.localBulkOilBarrel.count({where:{branchId,productId}}),0);});
  await check('invalid code and insufficient capacity roll back attachment',async()=>{await assert.rejects(attach(205,'bad'),/DataMatrix/);await assert.rejects(attach(50),/превышает/);assert.equal(await prisma.localBulkOilBarrel.count({where:{branchId,productId}}),0);});
  await check('existing drum attaches at warehouse 55, not legacy 54.998; no second receipt',async()=>{await attach();const p=await product();assert.equal(p.markingSettings.currentVolumeLiters,55);assert.equal(p.markingSettings.warehouseLinked,true);const b=await prisma.localBulkOilBarrel.findFirst({where:{branchId,productId}});assert.equal(b.status,'OPEN');assert.equal(Number(b.remainingLiters),55);assert.equal(Number(b.receivedLiters),205);const s=await prisma.localStockBalance.findFirst({where:{branchId,productId,storeId}});assert.equal(Number(s.quantity),55);assert.equal(await prisma.inventoryLedgerEntry.count({where:{branchId}}),0);assert.equal(await prisma.localInventoryDocument.count({where:{branchId}}),0);});
  await check('repeat attachment is rejected without adding stock',async()=>{await assert.rejects(attach(),/уже есть открытая/);assert.equal(await prisma.localBulkOilBarrel.count({where:{branchId,productId}}),1);});
  await check('sealed barrels remain separate from existing drum',async()=>{const id=`${productId}-sealed`;await prisma.localProduct.create({data:{id,branchId,name:'Second oil',uomName:'л',markingEnabled:true,markingMode:'BULK_OIL_FROM_MARKED_BARREL',markingSettings:{}}});await prisma.localStockBalance.create({data:{branchId,productId:id,storeId,quantity:225,available:225}});await prisma.localBulkOilBarrel.create({data:{branchId,productId:id,storeId,number:'SEALED',markingCode:code(2),gtin:'04601234567890',receivedLiters:170,remainingLiters:170,status:'SEALED'}});await attach(205,code(3),id);const p=await prisma.localProduct.findUnique({where:{id}});assert.equal(p.markingSettings.currentVolumeLiters,55);assert.equal(Number((await prisma.localBulkOilBarrel.findFirst({where:{branchId,productId:id,status:'SEALED'}})).remainingLiters),170);});
 });
 console.log(`First barrel onboarding: ${checks} checks passed.`);
}finally{await prisma.$disconnect();}
