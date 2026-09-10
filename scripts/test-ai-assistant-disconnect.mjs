#!/usr/bin/env node
import assert from 'node:assert/strict';
import {reset, final, actor, tenant, runWithRequestTenant, runAssistantThread, withAssistantExecution, jiti} from './fixtures/ai-assistant/harness.mjs';

const {POST}=await jiti.import(process.cwd()+'/src/app/api/ai-assistant/threads/[id]/messages/route.ts');
const {cancelAssistantRun, getAssistantThread}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/runner.ts');
const {assistantDeliveryError,assistantMessageWasAccepted}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/message-delivery.ts');
let count=0;
async function test(name,work){await work();count++;console.log(`PASS ${name}`);}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const request=signal=>new Request('https://example.test/api/ai-assistant/threads/thread/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Привет'}),signal});
const post=signal=>POST(request(signal),{params:Promise.resolve({id:'thread'})});
async function modelStarted(f){const end=Date.now()+2000;while(!f.modelCalls.length){assert.ok(Date.now()<end,'model did not start');await new Promise(r=>setTimeout(r,1));}}
const run=signal=>runWithRequestTenant(tenant,()=>runAssistantThread({threadId:'thread',organizationId:'org-a',actor,message:'Привет',signal}));

await test('real message route survives HTTP disconnect and saves its result once',async()=>{
  const f=reset(), entered=deferred(), release=deferred(), connection=new AbortController();
  f.responses=[async()=>{entered.resolve();await release.promise;return final('Проверка завершена.');}];
  const pending=post(connection.signal);
  await entered.promise;
  connection.abort(new DOMException('Connection closed','AbortError'));
  release.resolve();
  const response=await pending;
  assert.equal(response.status,200);
  assert.equal((await response.json()).cancelled,false);
  assert.equal(f.tables.aIAssistantRun.length,1);
  assert.equal(f.tables.aIAssistantRun[0].status,'completed');
  assert.equal(f.tables.aIAssistantRun[0].cancelledAt,null);
  assert.equal(f.tables.aIAssistantMessage.filter(m=>m.role==='assistant').length,1);
  assert.equal(f.modelCalls.length,1);
  const snapshot=await runWithRequestTenant(tenant,()=>getAssistantThread('thread','org-a'));
  assert.equal(assistantMessageWasAccepted(snapshot,{threadId:'thread',message:'Привет',previousMessageIds:new Set()}),true);
});

await test('explicit Stop still cancels after HTTP disconnect',async()=>{
  const f=reset(), connection=new AbortController();f.delayModel=true;
  const pending=post(connection.signal);await modelStarted(f);
  connection.abort();
  await runWithRequestTenant(tenant,()=>cancelAssistantRun({threadId:'thread',organizationId:'org-a'}));
  assert.equal((await (await pending).json()).cancelled,true);
  assert.equal(f.tables.aIAssistantRun[0].errorCode,'RUN_CANCELLED');
  assert.ok(f.tables.aIAssistantRun[0].cancelledAt);
  assert.match(f.tables.aIAssistantMessage.at(-1).content,/по команде сотрудника/);
});

await test('generic external abort is interrupted, never attributed to employee',async()=>{
  const f=reset(), controller=new AbortController();f.delayModel=true;
  const pending=run(controller.signal);await modelStarted(f);controller.abort();
  assert.equal((await pending).cancelled,false);
  assert.equal(f.tables.aIAssistantRun[0].status,'failed');
  assert.equal(f.tables.aIAssistantRun[0].errorCode,'RUN_INTERRUPTED');
  assert.equal(f.tables.aIAssistantRun[0].cancelledAt,null);
});

await test('deadline persists timeout rather than employee cancellation',async()=>{
  const f=reset();f.delayModel=true;
  await runWithRequestTenant(tenant,()=>withAssistantExecution(30,undefined,()=>runAssistantThread({threadId:'thread',organizationId:'org-a',actor,message:'Привет'})));
  assert.equal(f.tables.aIAssistantRun[0].status,'failed_run_timeout');
  assert.equal(f.tables.aIAssistantRun[0].errorCode,'RUN_TIMEOUT');
  assert.equal(f.tables.aIAssistantRun[0].cancelledAt,null);
  assert.match(f.tables.aIAssistantMessage.at(-1).content,/Истекло время/);
});

await test('stale-run cleanup keeps its timeout cause during polling',async()=>{
  const f=reset();f.delayModel=true;
  const pending=run();await modelStarted(f);
  f.tables.aIAssistantRun[0].startedAt=new Date(0);
  await runWithRequestTenant(tenant,()=>getAssistantThread('thread','org-a'));
  assert.equal((await pending).cancelled,false);
  assert.equal(f.tables.aIAssistantRun[0].errorCode,'RUN_TIMEOUT');
  assert.equal(f.tables.aIAssistantRun[0].cancelledAt,null);
});

await test('network failure copy and recovery never claim an old or other-thread message was accepted',async()=>{
  assert.doesNotMatch(assistantDeliveryError(new TypeError('Load failed')),/Load failed|отменён сотрудником/);
  assert.match(assistantDeliveryError(new TypeError('Load failed')),/мог продолжить/);
  assert.equal(assistantDeliveryError(new Error('Необходима авторизация')),'Необходима авторизация');
  const snapshot={thread:{id:'thread'},messages:[{id:'m1',role:'user',content:'Привет'}],latestRun:{inputMessageId:'m1'}};
  const pending={threadId:'thread',message:'Привет',previousMessageIds:new Set()};
  assert.equal(assistantMessageWasAccepted(snapshot,pending),true);
  assert.equal(assistantMessageWasAccepted(snapshot,{...pending,previousMessageIds:new Set(['m1'])}),false);
  assert.equal(assistantMessageWasAccepted(snapshot,{...pending,threadId:'other'}),false);
  assert.equal(assistantMessageWasAccepted({...snapshot,latestRun:{inputMessageId:'other'}},pending),false);
  assert.equal(assistantMessageWasAccepted(null,pending),false);
});

await test('denied route access never starts a model or run',async()=>{
  const f=reset();f.deniedAccess=true;
  assert.equal((await post()).status,403);
  assert.equal(f.modelCalls.length,0);
  assert.equal(f.tables.aIAssistantRun?.length??0,0);
});
console.log(`Assistant disconnect regression: ${count} scenarios passed; no live requests.`);
