import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const mock=join(mkdtempSync(join(tmpdir(),'return-jobs-')),'mock.ts');
writeFileSync(mock,`
import {Prisma} from '${resolve('node_modules/@prisma/client/default.js')}';
export const test:any={branch:'a',rows:[],candidates:[],sent:[],prepared:[],gate:null,throwSend:false};
const match=(row:any,where:any)=>Object.entries(where).every(([k,v]:any)=>row[k]===v);
const key=(where:any)=>where.branchId_serviceDate_clientKey??where;
const table={
 findUnique:async({where}:any)=>test.rows.find((r:any)=>match(r,key(where)))??null,
 findUniqueOrThrow:async(args:any)=>{const r=await table.findUnique(args);if(!r)throw Error('Missing');return {...r};},
 create:async({data}:any)=>{if(test.rows.some((r:any)=>r.branchId===data.branchId&&r.serviceDate===data.serviceDate&&r.clientKey===data.clientKey))throw new Prisma.PrismaClientKnownRequestError('duplicate',{code:'P2002',clientVersion:'test'});const row={version:1,skipped:false,deliveryMessageId:null,deliveryConversationId:null,deliveryAt:null,...data};test.rows.push(row);return {...row};},
 updateMany:async({where,data}:any)=>{let count=0;for(const r of test.rows)if(match(r,where)){for(const [k,v] of Object.entries(data))r[k]=typeof v==='object'&&v&&'increment' in v?r[k]+(v as any).increment:v;count++;}return {count};},
 findMany:async({where,take}:any)=>test.rows.filter((r:any)=>match(r,where)).slice(0,take).map((r:any)=>({...r})),
};
export const prisma:any={customerReturnState:table,$transaction:async(fn:any)=>fn({customerReturnState:table})};
export const getScopedBranchId=()=>test.branch;
export const getPublicUsers=async()=>[{login:'anna',name:'Анна',role:'admin'}];
export const loadCustomerReturnQueue=async(date:any,key:any)=>{test.prepared.push({date,key});return test.candidates.filter((c:any)=>c.clientKey===key);};
export const assertMessengerOutboundTextSafe=()=>{};
export const getContactStatus=async()=>({canMessage:true,telegramConnected:true});
export const startContactConversation=async(contact:any)=>{test.contact=contact;return {conversationId:'conv'};};
export const getConversation=async()=>({channel:'telegram',messengerAccountId:'acct'});
export const getActiveTelegramUserAccount=async()=>({id:'acct',isActive:true,status:'connected'});
export const sendMessage=async(input:any)=>{test.sent.push(input);if(test.gate)await test.gate;if(test.throwSend)throw Error('network unknown');return {outbox:{status:'sent'},message:{id:'m'+test.sent.length,status:'sent'}};};
`);
const names=['db','request-tenant-store','auth','customer-analytics','messenger/messenger-contact-actions','messenger/messenger-gateway','messenger/channels/telegram-user-session','messenger/messenger-security'];
const jiti=createJiti(import.meta.url,{alias:{'@':resolve('src'),...Object.fromEntries(names.map(n=>['@/lib/'+n,mock]))}});
const {test}=await jiti.import(mock);
const {enqueueCustomerReturnDelivery:enqueue,processPendingCustomerReturnDeliveries:pump}=await jiti.import('../src/lib/customer-return-jobs.ts');
const {returnCandidateFingerprint:fp}=await jiti.import('../src/lib/customer-return-shared-types.ts');
const {customerReturnTab:tab}=await jiti.import('../src/lib/customer-return-workflow.ts');
const actor={login:'anna',name:'Анна',role:'admin'};
function input(id){const candidate={clientKey:id,reasons:[],offers:[],draft:'template',offerReady:true,phone:'server-phone',counterpartyId:'server-contact',displayName:id};test.candidates.push(candidate);return {serviceDate:'2026-10-21',clientKey:id,expectedVersion:0,fingerprint:fp(candidate),draftText:'Проверенное предложение за 8 000 ₽'};}
const one=input('c1');
assert.equal((await enqueue(one,actor)).deliveryStatus,'queued');
assert.equal(test.sent.length,0);assert.equal(test.prepared.length,0,'Acceptance does not recompute any quotes');
assert.equal((await enqueue(one,actor)).deliveryStatus,'queued','Duplicate acceptance returns persisted status');
assert.equal(test.rows.length,1);
let release;test.gate=new Promise(resolve=>release=resolve);
const first=pump();
for(let i=0;i<30&&test.sent.length===0;i++)await new Promise(resolve=>setTimeout(resolve,1));
assert.equal(test.sent.length,1);
await pump();assert.equal(test.sent.length,1,'Concurrent workers cannot send a claimed job twice');
assert.equal(tab({offerReady:true},test.rows[0]),'processing');
await enqueue(input('c2'),actor);assert.equal(test.rows.length,2,'Next client accepted while Telegram is slow');
release();await first;test.gate=null;await pump();
assert.equal(test.sent.length,2);assert.equal(tab({},test.rows[0]),'sent');assert.equal(test.sent[0].text,one.draftText);assert.equal(test.contact.phone,'server-phone');
assert.ok(test.prepared.every(call=>call.key),'Only individual client offers recomputed');
await enqueue(one,actor);await pump();assert.equal(test.sent.length,2,'Sent job never resubmitted');
const stale=input('stale');await enqueue(stale,actor);test.candidates.find(c=>c.clientKey==='stale').draft='new quote';await pump();
assert.equal(test.rows.find(r=>r.clientKey==='stale').deliveryStatus,'failed');assert.equal(test.sent.length,2,'Stale quote blocked before transport');
const lost=input('unknown');await enqueue(lost,actor);test.throwSend=true;await pump();assert.equal(test.rows.find(r=>r.clientKey==='unknown').deliveryStatus,'unknown');test.throwSend=false;await pump();assert.equal(test.sent.length,3,'Uncertain transport is not retried');
const other=input('other-branch');await enqueue(other,actor);test.branch='b';await pump();assert.equal(test.sent.length,3,'Worker cannot claim another branch');test.branch='a';await pump();assert.equal(test.sent.length,4,'Persisted queued work survives worker restart');
assert.equal(tab({offerReady:true},{deliveryStatus:'none',skipped:true}),'skipped');assert.equal(tab({offerReady:false}),'review');assert.equal(tab({offerReady:true}),'ready');assert.equal(tab({}, {deliveryStatus:'unknown'}),'errors');
console.log('PASS: durable atomic acceptance, duplicate clicks/workers, independent clients, targeted recompute, stale quote protection, uncertain outcome, branch isolation and recovery; no real messages.');
