import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const transpile = (source) => ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
const exported={};
vm.runInNewContext(transpile(fs.readFileSync('src/lib/inventory-unit-cost.ts','utf8')),{exports:exported});
const resolve=exported.resolveInventoryAverageCost;
assert.equal(resolve(90000,120000,120000),90000,'Known warehouse average must not be overwritten');
assert.equal(resolve(0,120000,120000),120000,'Explicitly entered price reconstructs unknown cost');
assert.equal(resolve(null,120000,120000),120000);
assert.equal(resolve(null,120000,undefined),null,'An old snapshot is not an explicit price confirmation');
assert.equal(resolve(0,120000,110000),0,'Stale audit value must not confirm another price');
const source=fs.readFileSync('src/lib/warehouse-inventory.ts','utf8');
const start=source.indexOf('export async function updateInventoryLineUnitCost(');
const end=source.indexOf('export async function updateInventoryLineResolution(',start);
async function exercise(price,status='AWAITING_APPROVAL',found=true){
 const writes=[],audit=[],exports={}; let locks=0;
 const session={id:'s',branchId:'branch-main',status,approvedAt:new Date()};
 const tx={
  async $queryRaw(){locks++;},
  inventorySession:{async findUnique(){return session;},async update({data}){writes.push({session:data});return {...session,...data};}},
  inventoryLine:{async findFirst(){return found?{id:'a',unitCostSnapshotCents:null,status:'COUNTED',differenceQuantity:{toNumber:()=>2}}:null;},async update({data}){writes.push({line:data});return data;}},
  localStockBalance:{async update(){throw new Error('Editing an unposted price must not mutate warehouse balances');}},
 };
 vm.runInNewContext(transpile(source.slice(start,end)),{
  exports,Prisma:{sql:(parts,...values)=>({parts,values})},
  prisma:{$transaction:(fn)=>fn(tx)},
  costForDifference:(difference,price)=>difference.toNumber()*price,
  async recalculateSessionSummary(){},async writeAudit(_tx,value){audit.push(value);},mapLine:(x)=>x,mapSession:(x)=>x,
 });
 return {result:await exports.updateInventoryLineUnitCost('s','a',{unitCostCents:price},{login:'tester'}),writes,audit,locks};
}
let result=await exercise(123456);
assert.equal(result.result.ok,true);
assert.equal(result.result.data.line.hasEnteredUnitCost,true);
assert.equal(result.writes[0].line.unitCostSnapshotCents,123456);
assert.equal(result.writes[0].line.differenceCostCents,246912);
assert.equal(result.writes[1].session.status,'REVIEW');
assert.equal(result.writes[1].session.approvedAt,null);
assert.equal(result.writes[1].session.approvedById,null);
assert.equal(result.audit[0].action,'SET_UNIT_COST');
assert.equal(result.locks,1);
for(const price of [undefined,0,-1,1.5,'123',Infinity,2147483648]){
 result=await exercise(price);assert.equal(result.result.ok,false);assert.equal(result.writes.length,0);
}
for(const status of ['POSTED','REVERSED','CANCELLED','COUNTING']){
 result=await exercise(10000,status);assert.equal(result.result.ok,false);assert.equal(result.writes.length,0);
}
result=await exercise(10000,'REVIEW',false);assert.equal(result.result.ok,false);assert.equal(result.writes.length,0);
console.log('Inventory unit cost: precision, validation, scoped line, approval reset, terminal guards, audit and unknown-cost reconstruction passed.');

const {Prisma}=await import('@prisma/client');
const D=Prisma.Decimal;
const costing={};
vm.runInNewContext(transpile(fs.readFileSync('src/lib/inventory-costing.ts','utf8')),{exports:costing});
const postStart=source.indexOf('export async function postInventorySession(');
const postEnd=source.indexOf('export async function reverseInventorySession(',postStart);
async function post({oldQuantity,oldCost,difference,price,entered=price}){
 const writes=[],ledgers=[],exports={};
 const line={id:'a',productId:'p',status:'COUNTED',finalAction:difference>0?'SURPLUS_RECEIPT':'SHORTAGE_EXPENSE',differenceQuantity:new D(difference),finalQuantity:new D(oldQuantity+difference),unitCostSnapshotCents:price,affectsManagementProfit:true,product:{name:'Oil'}};
 const balance={id:'b',quantity:new D(oldQuantity),reserve:new D(0),buyPriceCents:oldCost};
 const session={id:'s',branchId:'branch-main',warehouseId:'w',status:'AWAITING_APPROVAL',approvedAt:new Date(),warehouse:{},organization:{}};
 const tx={
  async $queryRaw(){},
  inventorySession:{async findUnique(){return session;},async update(){return session;}},
  inventoryLine:{async findMany(){return [line];},async updateMany(){}},
  inventoryAuditLog:{async findMany(){return entered==null?[]:[{inventoryLineId:'a',newValueJson:{unitCostSnapshotCents:entered}}];}},
  localStockBalance:{async findUnique(){return balance;},async update({data}){writes.push(data);}},
  inventoryLedgerEntry:{async create({data}){ledgers.push(data);return {id:'ledger'};}},
  inventoryMovementLink:{async create(){}},inventoryLock:{async updateMany(){}},
 };
 vm.runInNewContext(transpile(source.slice(postStart,postEnd)),{
  exports,Prisma,ZERO:new D(0),prisma:{$transaction:(fn)=>fn(tx)},cleanText:(x)=>x??null,asRecord:(x)=>x??{},resolveInventoryAverageCost:resolve,
  calculateWeightedAverageCostCents:costing.calculateWeightedAverageCostCents,requireBalanceAverageCost:costing.requireBalanceAverageCost,
  costForDifference:(qty,price)=>Math.round(Math.abs(qty.toNumber())*price),
  ledgerMovementForAction:()=>difference>0?'INVENTORY_SURPLUS':'INVENTORY_SHORTAGE',
  async lockInventoryCostKeys(){},async lockBarrelProducts(){},async syncBulkOilWarehouseTx(){},async createResultDocument(){return null;},
  async recalculateSessionSummary(){},async writeAudit(){},toJson:(x)=>x,
 });
 return {result:await exports.postInventorySession('s',{}, {role:'owner',login:'tester'}),writes,ledgers};
}
let posted=await post({oldQuantity:1,oldCost:0,difference:-1,price:90000});
assert.equal(posted.result.ok,true);
assert.equal(posted.ledgers[0].unitCostSnapshot,90000);
assert.equal(posted.ledgers[0].raw.balanceBefore.averageCostCents,90000,'Reversal must have the reconstructed before-cost');
assert.equal(posted.ledgers[0].raw.balanceBefore.recordedAverageCostCents,0,'Original unknown value must remain in the audit snapshot');
assert.equal(posted.writes[0].buyPriceCents,90000);
posted=await post({oldQuantity:2,oldCost:60000,difference:1,price:90000});
assert.equal(posted.result.ok,true);assert.equal(posted.writes[0].buyPriceCents,70000);
posted=await post({oldQuantity:2,oldCost:60000,difference:-1,price:90000});
assert.equal(posted.result.ok,true);assert.equal(posted.ledgers[0].unitCostSnapshot,60000);
posted=await post({oldQuantity:2,oldCost:0,difference:1,price:90000});
assert.equal(posted.result.ok,true);assert.equal(posted.writes[0].buyPriceCents,90000);
posted=await post({oldQuantity:1,oldCost:0,difference:-1,price:90000,entered:null});
assert.equal(posted.result.ok,false);assert.equal(posted.writes.length,0);assert.equal(posted.ledgers.length,0);
posted=await post({oldQuantity:0,oldCost:null,difference:2,price:90000});
assert.equal(posted.result.ok,true);assert.equal(posted.writes[0].quantity.toNumber(),2);
console.log('Inventory posting: entered missing cost, weighted surplus, preserved average, reversal snapshot and unconfirmed-cost block passed.');

const client=fs.readFileSync('src/app/warehouse/inventory/WarehouseInventoryClient.tsx','utf8');
const saveStart=client.indexOf('  async function saveUnitCost(');
const saveEnd=client.indexOf('  async function saveReviewActual(',saveStart);
async function clientSave(drafts,fail=false){
 const exports={},requests=[],updates=[],errors={current:new Set()},active={current:new Set()};
 vm.runInNewContext(transpile(client.slice(saveStart,saveEnd)+'\nexports.save=saveUnitCost;'),{
  exports,Error,current:{id:'s'},working:false,costSaveByLine:{current:new Map()},activeCostSaves:active,savedUnitCosts:{current:new Map()},unitCostErrors:errors,
  setSaveState(){},setMessage(){},setReconciliation(){},setCurrent(session){updates.push(session);},
  async requestJson(url,options){requests.push({url,body:JSON.parse(options.body)});if(fail)throw new Error('Offline');return {line:{id:'a'},session:{status:'REVIEW',approvedAt:null}};},
 });
 await Promise.all(drafts.map((draft)=>exports.save({id:'a',unitCostSnapshotCents:null},draft)));
 return {requests,updates,errors,active};
}
let saved=await clientSave(['1 234,56','1 234,56']);
assert.equal(saved.requests.length,1,'Blur must not send the same pending price twice');
assert.equal(saved.requests[0].body.unitCostCents,123456);
assert.equal(saved.updates[0].status,'REVIEW');assert.equal(saved.active.current.size,0);
saved=await clientSave(['0']);assert.equal(saved.requests.length,0);assert.equal(saved.errors.current.has('a'),true);
saved=await clientSave(['500'],true);assert.equal(saved.updates.length,0);assert.equal(saved.errors.current.has('a'),true);
console.log('Inventory price input: rouble/kopeck conversion, duplicate protection, approval refresh and error tracking passed.');
