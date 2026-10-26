import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
const url=new URL(process.env.DATABASE_URL||'http://invalid');
assert.ok(['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='55447'&&url.pathname==='/eco_maintenance_test','Isolated local eco_maintenance_test only');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve('src')}});
const {prisma}=await jiti.import('../src/lib/db.ts');
const demands=await jiti.import('../src/lib/local-demand-write.ts');
const {runWithRequestTenant}=await jiti.import('../src/lib/request-tenant-store.ts');
const {shipmentCompositionQuote}=await jiti.import('../src/lib/shipment-maintenance.ts');
const branchId='maintenance-test',organizationId='maintenance-test-org',storeId='maintenance-test-store',productId='maintenance-test-oil';
const actor={login:'maintdemo',name:'Проверка ТО',role:'owner'};
const meta=(type,id)=>({meta:{href:`local://${type}/${id}`,type,mediaType:'application/json'}});
try{
await prisma.localOrganization.upsert({where:{id:organizationId},create:{id:organizationId,name:'Тест ТО'},update:{}});
await prisma.businessGroup.upsert({where:{id:'maintenance-test-group'},create:{id:'maintenance-test-group',name:'Тест ТО',slug:'maintenance-test'},update:{}});
await prisma.branch.upsert({where:{id:branchId},create:{id:branchId,businessGroupId:'maintenance-test-group',legacyOrganizationId:organizationId,name:'Тест ТО',shortName:'Тест ТО',slug:branchId},update:{}});
await prisma.localStore.upsert({where:{id:storeId},create:{id:storeId,branchId,organizationId,name:'Основной склад',isMain:true},update:{}});
await prisma.user.upsert({where:{login:'maintdemo'},create:{id:'maintenance-test-user',login:'maintdemo',name:'Проверка ТО',authRole:'owner',lastActiveBranchId:branchId},update:{}});
await prisma.businessGroupMembership.upsert({where:{businessGroupId_userId:{businessGroupId:'maintenance-test-group',userId:'maintenance-test-user'}},create:{businessGroupId:'maintenance-test-group',userId:'maintenance-test-user',role:'group_owner'},update:{}});
await prisma.branchMembership.upsert({where:{branchId_userId:{branchId,userId:'maintenance-test-user'}},create:{branchId,userId:'maintenance-test-user',roleId:'branch_owner',isDefaultBranch:true},update:{}});
await prisma.localProduct.upsert({where:{id:productId},create:{id:productId,branchId,name:'Bardahl XTEC 5W-30 тест',article:'TEST-OIL',groupPath:'Моторные масла',sae:'5W-30',oem:'Ford WSS-M2C913-D',uomName:'л',salePriceCents:72000},update:{}});
await prisma.localStockBalance.upsert({where:{productId_storeId:{productId,storeId}},create:{branchId,productId,storeId,quantity:24,available:24,buyPriceCents:40000},update:{}});
await runWithRequestTenant({mode:'branch',branchId,organizationId,allowedBranchIds:[branchId]},async()=>{
 const shared={version:1,label:'Салонный фильтр',source:'rossko',key:'cabin:CUK25007',referenceArticle:'CUK25007',offerId:'rossko:test',deliveryLabel:'29.10.2026, 16:45',selectedAt:new Date().toISOString(),specification:'Ford WSS-M2C913-D',viscosity:'5W-30',volume:'5.7',vehicle:{make:'FORD',model:'Kuga II',variantId:'37acc9fa21919a47785b000a24f61336c7a9f358a395b0cf772cb3dafe7926f7',year:'2015'}};
 const lines=[{...meta('product',productId),name:'Bardahl',quantity:5.7,price:720,discount:10,maintenance:{...shared,key:'engine-oil',label:'Моторное масло',source:'stock',referenceArticle:undefined}},{name:'Фильтр',quantity:1,price:572,discount:10,lineKind:'nonstock_product',oneOffProduct:{groupCode:'CABIN_FILTER',brand:'DELLO',article:'30830018211004',uomCode:'PCS',purchasePrice:null,purchaseSourceLabel:'Роско'},maintenance:shared},{...meta('service','maintenance-test-service'),name:'Замена масла',quantity:1,price:1000}];
 const created=await demands.createLocalDemand({organization:meta('organization',organizationId),store:meta('store',storeId),applicable:false,name:'ТО тест '+randomUUID().slice(0,8),positions:lines},{branchId,organizationId,actor});assert.equal(created.ok,true,created.error);
 let loaded=await demands.loadLocalDemandDetailPayload(created.id,branchId);assert.equal(loaded.ok,true,loaded.error);assert.equal(loaded.data.positions.length,3);assert.equal(loaded.data.header.sum,520840);
 const supplier=loaded.data.positions.find(p=>p.maintenance?.source==='rossko');assert.deepEqual(supplier.maintenance,shared);assert.equal(supplier.oneOffProduct.purchasePrice,null);assert.match(shipmentCompositionQuote('FORD Kuga II',loaded.data.positions,true),/5\s*208,40/);
 const update=await demands.updateLocalDemand(created.id,{applicable:false,positions:loaded.data.positions.map(p=>({...p,assortment:p.assortmentMeta?{meta:p.assortmentMeta}:undefined,price:p.price,quantity:p.maintenance?.source==='rossko'?2:p.quantity}))},actor,branchId,organizationId);assert.equal(update.ok,true,update.error);
 loaded=await demands.loadLocalDemandDetailPayload(created.id,branchId);assert.equal(loaded.data.header.sum,572320);assert.deepEqual(loaded.data.positions.find(p=>p.maintenance?.source==='rossko').maintenance,shared);
 const post=await demands.updateLocalDemand(created.id,{applicable:true},actor,branchId,organizationId);assert.equal(post.ok,false);assert.match(post.error,/закупочн/i);
 assert.equal(Number((await prisma.localStockBalance.findUnique({where:{productId_storeId:{productId,storeId}}})).quantity),24,'Draft and rejected posting must not debit stock');
 await prisma.localOrganization.upsert({where:{id:'maintenance-test-other-org'},create:{id:'maintenance-test-other-org',name:'Другой филиал'},update:{}});await prisma.branch.upsert({where:{id:'maintenance-test-other'},create:{id:'maintenance-test-other',businessGroupId:'maintenance-test-group',legacyOrganizationId:'maintenance-test-other-org',name:'Другой филиал',shortName:'Другой',slug:'maintenance-test-other'},update:{}});await assert.rejects(()=>demands.loadLocalDemandDetailPayload(created.id,'maintenance-test-other'),/другого филиала/);
 console.log(JSON.stringify({ok:true,demandId:created.id,totalCents:loaded.data.header.sum,checks:['mixed stock + supplier + service persisted','metadata survives update/reload','discounted quote equals server total','no inventory movement for draft','supplier without cost cannot post','branch isolation']}));
});
}finally{await prisma.$disconnect()}
