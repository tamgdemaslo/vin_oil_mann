import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { AsyncLocalStorage } from 'node:async_hooks';
function load(path, globals={}, start) {
  let source=fs.readFileSync(path,'utf8');
  if(start) source=source.slice(source.indexOf(start));
  source=source.replace(/^import[\s\S]*?;\n/gm,'');
  const context={exports:{},URLSearchParams,AbortSignal,Intl,Date,Map,Set,Promise,...globals};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return context.exports;
}
const domain=load('src/lib/dashboard-money-domain.ts');
assert.equal(domain.moneyCents('123.45'),12345);assert.equal(domain.moneyCents(0),0);assert.equal(domain.moneyCents('-0.01'),-1);
for(const bad of [null,'',NaN,'1.234',true]) assert.throws(()=>domain.moneyCents(bad));
assert.equal(domain.sumKnown([120,30]),150);assert.equal(domain.sumKnown([120,null]),null);
const val=cents=>({cents,message:'test',at:null});
const total=domain.summarizeMoney('all',[{id:'a',name:'A',cash:val(10001),bank:val(20002)},{id:'b',name:'B',cash:val(30003),bank:val(40004)}],'now');
assert.equal(total.totalCents,100010);assert.equal(total.cashCents,40004);assert.equal(total.bankCents,60006);
assert.equal(domain.summarizeMoney('all',[{id:'a',name:'A',cash:val(1),bank:val(null)}],'now').totalCents,null);
let shiftMode='open',receiptMode='valid',queries=[];
const cash=load('src/lib/dashboard-cash.ts',{
  ...domain,getScopedBranchId:()=> 'a',
  resolveAqsiCashRegister:async()=>({deviceId:'42'}),
  aqsiFetchJson:async(_config,path)=>{queries.push(path);if(receiptMode==='bad')return {};const page=Number(new URLSearchParams(path.split('?')[1]).get('page'));return {pages:2,rows:[receipt(`r${page}`,page?2:1,page?2:10)]};},
  prisma:{bankCashTransfer:{aggregate:async()=>({_sum:{amountCents:300}})},cashShift:{findMany:async()=>shiftMode==='open'?[{id:'s',openingCashCents:1000,openedAt:new Date('2026-11-03T08:00:00Z'),timezone:'Europe/Kaliningrad',aqsiRegisterId:'register'}]:[],findFirst:async()=>shiftMode==='closed'?{actualCashCents:3456,closedAt:new Date('2026-11-02T18:00Z')}:null},cashWithdrawal:{aggregate:async()=>({_sum:{amountCents:100}})},cashExpenseOrder:{aggregate:async({where})=>{assert.equal(where.status,'posted');assert.equal(where.paymentType,'cash');assert.equal(where.branchId,'a');return {_sum:{amountCents:200}};}}},
});
function receipt(id,type,amount){return {id,amount:amount+999+111,processedAt:'2026-11-03T11:00:00',content:{type,checkClose:{payments:[{type:0,amount},{type:1,amount:999},{type:13,amount:111}]}}};}
const from='2026-11-03T10:00:00',till='2026-11-03T12:00:00';
for(const [type,expected] of [[1,1000],[2,-1000],[3,-1000],[4,1000]]) assert.equal(cash.receiptCashCents(receipt('r',type,10),'42',from,till),expected);
assert.equal(cash.receiptCashCents({...receipt('r',1,10),deviceId:'other'},'42',from,till),0);
assert.equal(cash.receiptCashCents({...receipt('r',1,10),processedAt:'2026-11-03T09:59:59'},'42',from,till),0);
assert.throws(()=>cash.receiptCashCents({processedAt:from,content:{type:1}},'42',from,till));
const withChange={...receipt('change',1,20),amount:1120,change:10};
assert.equal(cash.receiptCashCents(withChange,'42',from,till),1000,'cash change is deducted exactly once');
assert.throws(()=>cash.receiptCashCents({...withChange,amount:1119},'42',from,till),'unreconciled cash is not shown');
const open=await cash.getDashboardCash(new Date('2026-11-03T10:00:00Z'));assert.equal(open.cents,1800,'opening + receipts + bank cash deposit - refund - posted cash expenses - withdrawals');
assert.equal(queries.length,2);assert.match(queries[0],/filtered.devices=42/);assert.match(queries[0],/2026-11-03T10/,'branch timezone is applied');
receiptMode='bad';assert.equal((await cash.getDashboardCash()).cents,null,'invalid provider data is unknown, not zero');
shiftMode='closed';assert.equal((await cash.getDashboardCash()).cents,3456,'closed shift uses counted cash');
shiftMode='empty';assert.equal((await cash.getDashboardCash()).cents,null,'no history is not a zero balance');
const bankNumber='1'.repeat(20),otherNumber='2'.repeat(20);let bankMode='valid';
const bank=load('src/lib/tbank.ts',{
  prisma:{tBankIntegration:{findMany:async({where})=>{assert.equal(where.branchId,'a');return [{debitAccountNumberEncrypted:'configured',tokenEncrypted:'secret',accounts:[{isDefault:true,accountNumberEncrypted:'discovered'}]}];}}},
  getScopedBranchId:()=> 'a',getMessengerOrganizationId:()=> 'org',decryptText:v=>v==='configured'?bankNumber:otherNumber,hashSecret:()=> 'hash',
  callTBankJson:async(_integration,path)=>{assert.equal(path,'/api/v4/bank-accounts');if(bankMode==='error')throw Error();return {body:[{accountNumber:bankNumber,currency:'643',balance:{balance:bankMode==='missing'?undefined:123.45,otb:20123.45}},{accountNumber:otherNumber,currency:'643',balance:{otb:9999}}]};},recordsFromUnknown:v=>v,accountNumberFromBankRecord:r=>r.accountNumber,asRecord:v=>v??{},maskAccount:()=> '****1111',
},'/** Read only the explicitly configured branch account;');
assert.equal((await bank.getTBankDashboardBalances())[0].cents,12345,'only configured account, no discovered funds');
for(const mode of ['missing','error']) {bankMode=mode;assert.equal((await bank.getTBankDashboardBalances())[0].cents,null);}
const tenant=new AsyncLocalStorage();let duplicate=false;
const service=load('src/lib/dashboard-money.ts',{...domain,runWithRequestTenant:(scope,fn)=>tenant.run(scope,fn),getDashboardCash:async()=>val(tenant.getStore().branchId==='a'?100:200),getTBankDashboardBalances:async()=>[{accountHash:duplicate?'same':tenant.getStore().branchId,cents:tenant.getStore().branchId==='a'?1000:2000,message:'bank',at:'now'}]});
const branches=[{id:'a',displayName:'A',legacyOrganizationId:'orgA'},{id:'b',displayName:'B',legacyOrganizationId:null}];
const context={mode:'all',branches,businessGroupId:'g',userId:'u'};
assert.equal((await service.getDashboardMoney(context)).totalCents,3300);
assert.equal((await service.getDashboardMoney({...context,mode:'branch',branchId:'a'})).totalCents,1100,'single branch excludes other branches');
duplicate=true;const conflict=await service.getDashboardMoney(context);assert.equal(conflict.bankCents,null);assert.equal(conflict.totalCents,null);assert.equal(conflict.cashCents,300,'shared bank account never doubles the group total');
console.log('Dashboard money: exact cents, branch scopes, cash receipts/refunds/pagination/timezones, counted cash, bank account selection, missing data and duplicate accounts passed');
let authorizedRole='admin',serviceCalls=0;
const route=load('src/app/api/dashboard/money/route.ts',{NextResponse:{json:(value,options)=>({value,status:options?.status??200,headers:options?.headers})},requireBranchApi:async options=>{assert.equal(options.allowAll,true);return {ok:true,context:{user:{role:authorizedRole}}};},getDashboardMoney:async()=>{serviceCalls++;return total;}});
assert.equal((await route.GET()).status,403);assert.equal(serviceCalls,0,'unauthorized requests never reach providers');
authorizedRole='owner';const response=await route.GET();assert.equal(response.status,200);assert.equal(response.headers['Cache-Control'],'private, no-store');
console.log('Dashboard money API: owner permission and private no-store passed');
