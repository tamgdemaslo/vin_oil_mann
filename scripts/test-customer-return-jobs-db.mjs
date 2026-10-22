import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const url=new URL(process.env.DATABASE_URL||'postgresql://invalid/invalid');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&url.pathname.startsWith('/eco_return_test_'),'Isolated local test DB only');
const mock=join(mkdtempSync(join(tmpdir(),'return-jobs-db-')),'mock.ts');
writeFileSync(mock,`export const test:any={calls:[],candidates:[],unknown:false,prepared:[]};
export const getPublicUsers=async()=>[{login:'anna',name:'Анна',role:'admin'}];
export const loadCustomerReturnQueue=async(date:any,key:any)=>{test.prepared.push(key);return test.candidates.filter((c:any)=>c.clientKey===key);};
export const getContactStatus=async()=>({canMessage:true,telegramConnected:true});
export const startContactConversation=async()=>({conversationId:'test-conversation'});
export const getConversation=async()=>({channel:'telegram',messengerAccountId:'test-account'});
export const getActiveTelegramUserAccount=async()=>({id:'test-account',isActive:true,status:'connected'});
export const sendMessage=async(input:any)=>{test.calls.push(input);await new Promise(r=>setTimeout(r,40));if(test.unknown)throw Error('uncertain');return {outbox:{status:'sent'},message:{id:'mock-'+test.calls.length,status:'sent'}};};`);
const names=['auth','customer-analytics','messenger/messenger-contact-actions','messenger/messenger-gateway','messenger/channels/telegram-user-session'];
const jiti=createJiti(import.meta.url,{alias:{'@':resolve('src'),...Object.fromEntries(names.map(n=>['@/lib/'+n,mock]))}});
const {prisma}=await jiti.import('../src/lib/db.ts');const {runWithRequestTenant}=await jiti.import('../src/lib/request-tenant-store.ts');
const {enqueueCustomerReturnDelivery:enqueue,processPendingCustomerReturnDeliveries:pump}=await jiti.import('../src/lib/customer-return-jobs.ts');
const {test}=await jiti.import(mock);const {returnCandidateFingerprint:fp}=await jiti.import('../src/lib/customer-return-shared-types.ts');
const run=(branchId,fn)=>runWithRequestTenant({mode:'branch',branchId,organizationId:branchId,allowedBranchIds:[branchId]},fn);
const actor={login:'anna',name:'Анна',role:'admin'};
const candidate={id:'job-client',clientKey:'job-client',displayName:'Тест',phone:'+79000000000',reasons:[],offers:[],offerReady:true,draft:'Предложение: масло и фильтр, 1000 ₽.'};test.candidates=[candidate];
const input={clientKey:candidate.id,serviceDate:'2026-10-21',expectedVersion:0,fingerprint:fp(candidate),draftText:candidate.draft};
try{
 await prisma.$executeRawUnsafe("DELETE FROM customer_return_states WHERE branch_id IN ('job-a','job-b')");
 await prisma.$executeRawUnsafe("INSERT INTO branches(id) VALUES ('job-a'),('job-b') ON CONFLICT DO NOTHING");
 const results=await Promise.all(Array.from({length:12},()=>run('job-a',()=>enqueue(input,actor))));
 assert.ok(results.every(state=>state.deliveryStatus==='queued'));assert.equal(test.calls.length,0,'Acceptance never contacts Telegram');
 assert.equal(await run('job-a',()=>prisma.customerReturnState.count({where:{branchId:"job-a"}})),1,'PostgreSQL insert race creates one job');
 await run('job-b',()=>pump());assert.equal(test.calls.length,0,'Branch B cannot process branch A');
 await Promise.all(Array.from({length:12},()=>run('job-a',()=>pump())));
 assert.equal(test.calls.length,1,'Competing PostgreSQL workers submit exactly once');
 const sent=await run('job-a',()=>prisma.customerReturnState.findFirstOrThrow({where:{branchId:"job-a"}}));assert.equal(sent.deliveryStatus,'sent');assert.equal(sent.version,3);
 await run('job-a',()=>enqueue(input,actor));await run('job-a',()=>pump());assert.equal(test.calls.length,1,'Acknowledged job stays idempotent');
 const second={...candidate,id:'second',clientKey:'second'};test.candidates.push(second);
 await run('job-a',()=>enqueue({...input,clientKey:'second',fingerprint:fp(second)},actor));test.unknown=true;
 await run('job-a',()=>pump());assert.equal((await run('job-a',()=>prisma.customerReturnState.findFirstOrThrow({where:{branchId:"job-a",clientKey:'second'}}))).deliveryStatus,'unknown');
 test.unknown=false;await run('job-a',()=>pump());assert.equal(test.calls.length,2,'Unknown transport never requeued');
 // Yesterday's actual send stays protected on following days, including after a process restart.
 await run('job-a',()=>prisma.customerReturnState.updateMany({where:{branchId:'job-a',clientKey:candidate.clientKey},data:{deliveryAt:new Date('2026-10-21T12:00:00Z')}}));
 await assert.rejects(()=>run('job-a',()=>enqueue({...input,serviceDate:'2026-10-22'},actor)),/Повторное сообщение заблокировано/);
 const {listCustomerReturnStates:list}=await jiti.import('../src/lib/customer-return-state.ts');
 const {effectiveCustomerReturnState:effective}=await jiti.import('../src/lib/customer-return-contact-policy.ts');
 const carried=(await run('job-a',()=>list('2026-10-22'))).find(r=>r.clientKey===candidate.clientKey);
 assert.equal(effective(candidate,carried).deliveryStatus,'sent');assert.equal(carried.version,0);assert.equal(carried.previousDelivery.draftText,input.draftText);
 assert.equal((await run('job-b',()=>list('2026-10-22'))).length,0,'Historical dispatches remain branch-scoped');
 await assert.rejects(()=>run('job-a',()=>enqueue({...input,serviceDate:'2026-10-22',clientKey:'second'},actor)),/Повторное сообщение заблокировано/,'Unknown previous delivery is not retried tomorrow');
 // A browser can forge dates, but the worker recomputes and checks the real candidate before Telegram.
 const fresh={...candidate,offers:[{sourceDate:'2026-10-22',lines:[]}]};
 await run('job-a',()=>enqueue({...input,serviceDate:'2026-10-23',fingerprint:fp(fresh)},actor));
 await run('job-a',()=>pump());assert.equal(test.calls.length,2,'Forged new-service dates cannot reach transport');
 // A real new service opens a new campaign; the old sent report is never changed.
 const next={...candidate,clientKey:'new-cycle',id:'new-cycle',offers:[{sourceDate:'2026-10-22',lines:[]}]};test.candidates.push(next);
 await run('job-a',()=>prisma.customerReturnState.create({data:{branchId:'job-a',clientKey:next.clientKey,serviceDate:'2026-10-21',deliveryStatus:'sent',deliveryAt:new Date('2026-10-21T12:00:00Z'),updatedByLogin:'anna',updatedByName:'Анна'}}));
 await run('job-a',()=>enqueue({...input,clientKey:next.clientKey,serviceDate:'2026-10-23',fingerprint:fp(next)},actor));await run('job-a',()=>pump());assert.equal(test.calls.length,3);
 // The lock spans dates: racing requests around midnight accept at most one job.
 const midnight={...input,clientKey:'midnight'};
 const races=await Promise.allSettled(['2026-10-24','2026-10-25'].map(serviceDate=>run('job-a',()=>enqueue({...midnight,serviceDate},actor))));
 assert.equal(races.filter(r=>r.status==='fulfilled').length,1,'Only one cross-day claim can win');
 // A late Telegram acknowledgement is reconciled across days, rather than remaining queued forever.
 await run('job-a',()=>prisma.customerReturnState.create({data:{branchId:'job-a',clientKey:'late-ack',serviceDate:'2026-10-21',deliveryStatus:'queued',deliveryMessageId:'late-ack-message',updatedByLogin:'anna',updatedByName:'Анна'}}));
 await run('job-a',()=>prisma.$executeRawUnsafe("INSERT INTO messenger_outbox(id,branch_id,message_id,status,updated_at) VALUES ('late-ack-outbox','job-a','late-ack-message','sent','2026-10-21T12:00:00Z') ON CONFLICT (id) DO UPDATE SET status='sent',updated_at='2026-10-21T12:00:00Z'"));
 const {previousCustomerReturnDelivery:previous}=await jiti.import('../src/lib/customer-return-state.ts');
 assert.equal((await run('job-a',()=>previous('2026-10-22','late-ack'))).deliveryStatus,'sent');
 console.log('PASS: real PostgreSQL durable claims, yesterday report recovery, cross-day suppression, real new-service unlock, forged-service rejection, midnight races and late outbox acknowledgements; Telegram mocked.');
}finally{await prisma.$disconnect();}
