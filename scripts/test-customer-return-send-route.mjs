import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const mock=join(mkdtempSync(join(tmpdir(),'return-send-route-')),'mock.ts');
writeFileSync(mock,`export const test:any={access:{ok:true,context:{branchId:'a',user:{login:'anna',name:'Анна',role:'admin'}}},today:'2026-10-20',calls:[],after:[],workers:0};
export const requireBranchApi=async()=>test.access;export const runWithBranchApiContext=(_c:any,fn:any)=>fn();
export const getAnalyticsTodayYmd=()=>test.today;export const loadCustomerReturnQueue=async()=>{throw Error('Full queue must not load during acceptance');};
export const after=(fn:any)=>test.after.push(fn);export const runForBranch=(_id:any,fn:any)=>fn();export const processPendingCustomerReturnDeliveries=async()=>{test.workers++;};
export class CustomerReturnDeliveryError extends Error {status=409;}
export const enqueueCustomerReturnDelivery=async(input:any,actor:any)=>{test.calls.push({input,actor});if(input.clientKey==='conflict')throw new CustomerReturnDeliveryError('Черновик изменён');return {deliveryStatus:'queued',clientKey:input.clientKey};};`);
const nextMock=mock.replace('mock.ts','next.ts');writeFileSync(nextMock,`export {NextResponse,NextRequest} from '${resolve('node_modules/next/server.js')}';export {after} from '${mock}';`);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve('src'),'next/server':nextMock,...Object.fromEntries(['branch-api','customer-analytics','customer-return-delivery','customer-return-jobs','branch-workers'].map(n=>['@/lib/'+n,mock]))}});
const {POST}=await jiti.import('../src/app/api/analytics/customer-return/send/route.ts');const {test}=await jiti.import(mock);const {NextRequest}=await import('next/server.js');
const base={branchId:'a',serviceDate:'2026-10-20',clientKey:'server-client',expectedVersion:1,fingerprint:'current',draftText:'Готовое предложение'};
const send=body=>POST(new NextRequest('http://localhost/api/analytics/customer-return/send',{method:'POST',body:JSON.stringify(body)}));
assert.equal((await send({...base,branchId:'b'})).status,409);assert.equal((await send({...base,serviceDate:'2026-10-19'})).status,409);assert.equal((await send({...base,phone:'spoofed'})).status,400);assert.equal((await send({...base,conversationId:'foreign'})).status,400);assert.equal((await send({...base,expectedVersion:-1})).status,400);assert.equal((await send({...base,draftText:''})).status,400);assert.equal(test.calls.length,0);
assert.equal((await send({...base,expectedVersion:0})).status,202);assert.equal(test.calls[0].actor.login,'anna');assert.equal(test.calls[0].input.draftText,base.draftText);assert.equal(test.workers,0,'Response does not wait for catalog or Telegram');await test.after[0]();assert.equal(test.workers,1);
const {branchId,serviceDate,...first}=base;
const batch={branchId,serviceDate,deliveries:[first,{...first,clientKey:'conflict'},{...first,clientKey:'third'}]};
assert.equal((await send({...batch,deliveries:[first,first]})).status,400,'Duplicate recipients are rejected before any enqueue');
assert.equal((await send({...batch,branchId:'b'})).status,409);
assert.equal((await send({...batch,serviceDate:'2026-10-19'})).status,409);
assert.equal(test.calls.length,1);
const batchResponse=await send(batch);
assert.equal(batchResponse.status,202);
assert.deepEqual((await batchResponse.json()).results,[
  {clientKey:first.clientKey,state:{deliveryStatus:'queued',clientKey:first.clientKey}},
  {clientKey:'conflict',error:'Черновик изменён'},
  {clientKey:'third',state:{deliveryStatus:'queued',clientKey:'third'}},
]);
assert.equal(test.after.length,2,'One background kick for the whole batch');
assert.equal(test.workers,1);
await test.after[1]();
assert.equal(test.workers,2);
test.access.context.user.role='invalid';assert.equal((await send(base)).status,403);
test.access={ok:false,response:new Response('Forbidden',{status:403})};assert.equal((await send(base)).status,403);
console.log('PASS: explicit send route enforces session, role, active branch/day/version and background-only processing; all adapters mocked, no real messages.');
