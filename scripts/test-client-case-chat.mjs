import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJiti} from 'jiti';
const dir=mkdtempSync(join(tmpdir(),'crm-chat-'));
function stub(name,code){const file=join(dir,name+'.cjs');writeFileSync(file,code);return file;}
const auth=stub('auth','exports.state={session:{user:{login:"vadim",role:"owner"}}};exports.getSession=async()=>exports.state.session;');
const branch=stub('branch','exports.state={allowed:true};exports.requireBranchApi=async options=>{if(options.allowAll!==false)throw Error("Branch must be concrete");return exports.state.allowed?{ok:true,context:{branchId:"a"}}:{ok:false,response:new Response(null,{status:409})}};exports.runWithBranchApiContext=(_,fn)=>fn();');
const db=stub('db',`exports.state={row:null,matches:[],clients:[],query:null,caseQuery:null,error:null};exports.prisma={crmDeal:{findFirst:async args=>{exports.state.caseQuery=args;return exports.state.row?.branchId===args.where.branchId?exports.state.row:null}},localCounterparty:{findMany:async args=>{if(args.where.branchId!=='a')throw Error('Invalid scope');return exports.state.clients}},$queryRaw:async query=>{exports.state.query=query;if(exports.state.error)throw exports.state.error;return exports.state.matches},$executeRaw:()=>{throw Error('Opening a chat must not write or send')}};`);
try{
 const jiti=createJiti(import.meta.url,{alias:{'@/lib/auth':auth,'@/lib/branch-api':branch,'@/lib/db':db,'@/lib/messenger/messenger-tenant':stub('tenant','exports.getMessengerOrganizationId=()=>"org-a";'),'@':resolve('src')}});
 const d=await jiti.import(db),a=await jiti.import(auth),b=await jiti.import(branch);
 const link=await jiti.import('../src/lib/client-case-chat-link.ts');
 const meta=await jiti.import('../src/lib/client-case-correspondence.ts');
 const {GET}=await jiti.import('../src/app/api/client-cases/[id]/conversation/route.ts');
 const req=()=>GET(new Request('http://example.test/api/client-cases/case-a/conversation'),{params:Promise.resolve({id:'case-a'})});
 a.state.session=null;assert.equal((await req()).status,401);a.state.session={user:{role:'mechanic'}};assert.equal((await req()).status,403);a.state.session={user:{role:'master'}};
 b.state.allowed=false;assert.equal((await req()).status,409);b.state.allowed=true;
 assert.equal((await req()).status,404);
 d.state.row={id:'case-a',branchId:'b',notes:'Переписка: Telegram',phoneNormalized:'79000000001',conversationId:null};assert.equal((await req()).status,404);
 d.state.row.branchId='a';
 let res=await req();assert.equal(res.status,200);assert.equal((await res.json()).url,'https://t.me/+79000000001');
 assert.deepEqual(d.state.caseQuery.where,{id:'case-a',branchId:'a'});
 assert.match(d.state.query.sql,/c\.branch_id = \?/);assert.match(d.state.query.sql,/c\.organization_id = \?/);assert.match(d.state.query.sql,/c\.channel = \?/);assert.ok(d.state.query.values.includes('org-a'));assert.ok(d.state.query.values.includes('telegram'));
 d.state.matches=[{id:'conv-a',priority:0,peerId:'user-a',clientId:null}];res=await req();assert.equal((await res.json()).url,'/messages?conversationId=conv-a');
 d.state.matches=[{id:'one',priority:3,peerId:'user-a',clientId:null},{id:'two',priority:3,peerId:'user-b',clientId:null}];res=await req();assert.equal(res.status,409);assert.equal((await res.json()).needsLink,true);
 d.state.matches=[{id:'new',priority:3,peerId:'user-a',clientId:null},{id:'old',priority:3,peerId:'user-a',clientId:null}];assert.equal((await (await req()).json()).url,'/messages?conversationId=new');
 d.state.matches=[];d.state.row.notes='Переписка: WhatsApp';res=await req();assert.equal((await res.json()).url,'https://wa.me/79000000001');assert.ok(d.state.query.values.includes('whatsapp'));
 d.state.row.notes='Переписка: MAX';res=await req();assert.equal(res.status,404);assert.equal((await res.json()).needsLink,true);
 d.state.row.notes='Переписка: MAX\nСсылка на переписку: https://max.ru/u/test';d.state.query=null;res=await req();assert.equal((await res.json()).url,'https://max.ru/u/test');assert.equal(d.state.query,null,'Saved links bypass lookup');
 d.state.row.notes='Переписка: Telegram';d.state.row.phoneNormalized=null;assert.equal((await req()).status,404);
 d.state.row.phoneNormalized='79000000001';d.state.error={code:'P2021'};assert.equal((await (await req()).json()).url,'https://t.me/+79000000001');d.state.error=null;
 assert.equal(link.caseChatPhoneLink('WhatsApp','8 (900) 000-00-01'),'https://wa.me/79000000001');assert.equal(link.caseChatPhoneLink('Telegram','9000000001'),'https://t.me/+79000000001');assert.equal(link.caseChatPhoneLink('SMS','9000000001'),'sms:+79000000001');assert.equal(link.caseChatPhoneLink('MAX','9000000001'),null);
 assert.equal(link.validCaseChatLink('javascript:alert(1)','Telegram'),false);assert.equal(link.validCaseChatLink('https://t.me.evil.test/name','Telegram'),false);assert.equal(link.validCaseChatLink('https://user:pass@t.me/name','Telegram'),false);assert.equal(link.validCaseChatLink('https://wa.me/79000000001','Telegram'),false);assert.equal(link.validCaseChatLink('https://t.me/client','Telegram'),true);assert.equal(link.validCaseChatLink('/messages?conversationId=conv-a','Telegram'),true);
 assert.equal(link.validCaseChatLink('https://crm.test/messages?conversationId=conv-a','Telegram','https://crm.test'),true);assert.equal(link.validCaseChatLink('https://other.test/messages?conversationId=conv-a','Telegram','https://crm.test'),false);
 const notes='Переписка: Telegram\nСсылка на переписку: https://t.me/client\nФильтр клиента';assert.equal(meta.caseCorrespondenceLink(notes),'https://t.me/client');assert.equal(meta.withoutCaseCorrespondence(notes),'Фильтр клиента');assert.equal(meta.withCaseCorrespondence(notes,'Telegram'),notes);assert.equal(meta.withCaseCorrespondence(notes,'MAX'),'Переписка: MAX\nФильтр клиента');assert.equal(meta.withCaseCorrespondence(notes,''),'Фильтр клиента');
 console.log('CRM chat: scoped read-only resolution, correct channels, ambiguity, phone links, safe URLs and metadata preservation passed');
}finally{rmSync(dir,{recursive:true,force:true});}
