import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJiti} from 'jiti';
process.env.APP_TIMEZONE='Europe/Kaliningrad';
const dir=mkdtempSync(join(tmpdir(),'crm-routes-'));
function stub(name,code){const file=join(dir,name+'.cjs');writeFileSync(file,code);return file;}
const alias={
 '@/lib/auth':stub('auth','exports.getSession=async()=>({user:{login:"vadim",role:"owner"}});'),
 '@/lib/crm-access':stub('access','exports.canAccessCrm=()=>true;'),
 '@/lib/branch-api':stub('branch','exports.requireBranchApi=async()=>({ok:true,context:{branchId:"a"}});exports.runWithBranchApiContext=(_,fn)=>fn();'),
 '@/lib/branch-sql-context':stub('sql','exports.requireSingleBranchSqlContext=()=>({branchId:"a"});'),
 '@/lib/crm':stub('stages','exports.ensureDefaultCrmStages=async()=>{};exports.getFirstCrmStage=async()=>({id:"first",name:"Нужно рассчитать"});exports.getCrmStageBySortOrder=async n=>({id:"stage-"+n});'),
 '@/lib/crm-deadline-notifications':stub('notify','exports.notifyClientCaseTaskAssigned=async()=>{throw Error("Unexpected assigned notification");};'),
 '@/lib/client-case-workflow':stub('workflow','exports.writeClientCaseEvent=async()=>{};exports.processClientCaseWorkflowTransitions=async()=>({});exports.state={last:null};exports.applyClientCaseAction=async(id,action,body)=>{exports.state.last={id,action,body};return {id,caseStatus:action}};'),
 '@/lib/db':stub('db',`exports.state={existing:null,created:null,updated:null,stages:[],clients:[],clientQuery:null};exports.prisma={crmDeal:{findUnique:async()=>exports.state.existing,findFirst:async()=>null,update:async({data})=>{exports.state.updated=data;return {...exports.state.existing,...data}},create:async({data})=>{exports.state.created=data;return {id:'new',...data}}},localCounterparty:{findMany:async args=>{exports.state.clientQuery=args;return exports.state.clients.filter(c=>c.branchId===args.where.branchId&&!c.archived&&args.where.normalizedPhone.in.includes(c.normalizedPhone))}},crmStage:{findMany:async()=>exports.state.stages,findUnique:async()=>({id:'first',name:'Нужно рассчитать'})}};`),
 '@':resolve('src'),
};
try{
 const jiti=createJiti(import.meta.url,{alias});
 const db=await jiti.import(alias['@/lib/db']);
 const {POST,GET}=await jiti.import('../src/app/api/crm/deals/route.ts');
 const clientLinks=await jiti.import('../src/lib/client-case-counterparty.ts');
 db.state.stages=[{id:'first',deals:[{id:'one',customerName:'Сергей',phoneNormalized:'79000000001'},{id:'shared',phoneNormalized:'79000000002'},{id:'no-phone',phoneNormalized:null,customerName:'Сергей'}]}];
 db.state.clients=[{id:'local-client',normalizedPhone:'9000000001',branchId:'a',archived:false},{id:'other-branch',normalizedPhone:'79000000001',branchId:'b',archived:false},{id:'archived',normalizedPhone:'79000000001',branchId:'a',archived:true},{id:'shared-1',normalizedPhone:'79000000002',branchId:'a',archived:false},{id:'shared-2',normalizedPhone:'89000000002',branchId:'a',archived:false}];
 let res=await GET();assert.equal(res.status,200);
 const linked=(await res.json()).stages[0].deals;
 assert.equal(linked[0].clientCounterpartyId,'local-client','Direct link uses exact phone match within the current branch');
 assert.equal(linked[1].clientCounterpartyId,null,'Shared number must not open an arbitrary client');assert.equal(linked[2].clientCounterpartyId,null,'Names alone do not identify a client');
 assert.equal(db.state.clientQuery.where.branchId,'a');assert.equal(db.state.clientQuery.where.archived,false);assert.ok(db.state.clientQuery.where.normalizedPhone.in.includes('89000000001'));
 assert.equal(clientLinks.caseCounterpartyHref(linked[0]),'/clients/counterparties?counterparty=local-client');
 assert.equal(clientLinks.caseCounterpartyHref(linked[1]),'/clients/counterparties?search=9000000002');
 assert.equal(clientLinks.caseCounterpartyHref(linked[2]),'/clients/counterparties?search='+encodeURIComponent('Сергей'));
 assert.equal(clientLinks.caseCounterpartyHref({}),null);
 res=await POST(new Request('http://example.test/api/crm/deals',{method:'POST',body:JSON.stringify({quickRequest:true,title:'ТО',phone:'12'})}));
 assert.equal(res.status,400);assert.equal(db.state.created,null);
 res=await POST(new Request('http://example.test/api/crm/deals',{method:'POST',body:JSON.stringify({quickRequest:true,title:'ТО',phone:'8 900 000-00-01',responsibleLogin:'other',caseStatus:'calculation_sent',stageId:'wrong'})}));
 assert.equal(res.status,201);
 const created=await res.json();
 assert.equal(created.caseStatus,'calculation_needed');assert.equal(created.stageId,'first');assert.equal(created.phoneNormalized,'79000000001');assert.equal(created.createdByLogin,'vadim');assert.equal(created.responsibleLogin,null);assert.ok(created.nextActionAt);assert.equal(created.nextActionAt,created.nextContactAt);
 res=await POST(new Request('http://example.test/api/crm/deals',{method:'POST',body:JSON.stringify({quickRequest:true,title:'ТО',phone:'8 900 000-00-01',source:'client-site',notes:'Масло клиента',correspondenceChannel:'Telegram'})}));
 assert.equal(res.status,201);assert.equal(db.state.created.notes,'Переписка: Telegram\nМасло клиента');assert.equal(db.state.created.source,'client-site');
 res=await POST(new Request('http://example.test/api/crm/deals',{method:'POST',body:JSON.stringify({quickRequest:true,title:'ТО',phone:'8 900 000-00-01',correspondenceChannel:'invalid'})}));assert.equal(res.status,400);
 const {PATCH}=await jiti.import('../src/app/api/crm/deals/[id]/route.ts');
 const patchRequest=body=>new Request('http://example.test/api/crm/deals/case-a',{method:'PATCH',body:JSON.stringify(body)});
 const params={params:Promise.resolve({id:'case-a'})};
 db.state.existing={id:'case-a',stageId:'parts',notes:'Масло клиента',caseStatus:'waiting_parts',source:'client-site',suppliesNote:'Заказ РОССКО № 123'};
 res=await PATCH(patchRequest({correspondenceChannel:'WhatsApp'}),params);assert.equal(res.status,200);assert.deepEqual(db.state.updated,{notes:'Переписка: WhatsApp\nМасло клиента'},'Messenger update must not modify origin, status, ETA or order');
 db.state.existing.notes='Переписка: WhatsApp\nМасло клиента';
 res=await PATCH(patchRequest({notes:'Новый комментарий'}),params);assert.equal(res.status,200);assert.equal(db.state.updated.notes,'Переписка: WhatsApp\nНовый комментарий','Editing notes preserves messenger');
 res=await PATCH(patchRequest({correspondenceChannel:''}),params);assert.equal(res.status,200);assert.deepEqual(db.state.updated,{notes:'Масло клиента'},'Clearing optional messenger preserves notes');
 res=await PATCH(patchRequest({suppliesExpectedAt:'2026-10-25T13:45:00.000Z'}),params);assert.equal(res.status,200);assert.deepEqual(Object.keys(db.state.updated),['suppliesExpectedAt']);assert.equal(db.state.updated.suppliesExpectedAt.toISOString(),'2026-10-25T13:45:00.000Z');
 res=await PATCH(patchRequest({nextActionAt:'2026-10-25T13:45:00.000Z'}),params);assert.equal(res.status,200);assert.equal(+db.state.updated.nextActionAt,+db.state.updated.nextContactAt);
 res=await PATCH(patchRequest({suppliesExpectedAt:'bad-date'}),params);assert.equal(res.status,400);
 res=await PATCH(patchRequest({correspondenceChannel:'invalid'}),params);assert.equal(res.status,400);
 db.state.existing=null;res=await PATCH(patchRequest({correspondenceChannel:'Telegram'}),params);assert.equal(res.status,404);
 const channel=await jiti.import('../src/lib/client-case-correspondence.ts');
 assert.equal(channel.caseCorrespondence('Переписка: Telegram\nКомментарии'),'Telegram');
 assert.equal(channel.withCaseCorrespondence('Переписка: Telegram\nКомментарии','MAX'),'Переписка: MAX\nКомментарии');
 assert.equal(channel.withCaseCorrespondence('Переписка: Telegram',''),null);
 assert.equal(channel.withoutCaseCorrespondence('Переписка: обсудили масло\nКомментарии'),'Переписка: обсудили масло\nКомментарии','Unrelated prose remains intact');
 db.state.existing={id:'case-a',notes:'Переписка: Telegram\nКомментарий'};
 res=await PATCH(patchRequest({correspondenceUrl:'https://t.me/client'}),params);assert.equal(res.status,200);assert.equal(db.state.updated.notes,'Переписка: Telegram\nСсылка на переписку: https://t.me/client\nКомментарий');
 db.state.existing.notes=db.state.updated.notes;
 res=await PATCH(patchRequest({notes:'Новое примечание'}),params);assert.equal(res.status,200);assert.equal(db.state.updated.notes,'Переписка: Telegram\nСсылка на переписку: https://t.me/client\nНовое примечание');
 res=await PATCH(patchRequest({correspondenceUrl:'javascript:alert(1)'}),params);assert.equal(res.status,400);
 res=await PATCH(patchRequest({correspondenceChannel:'MAX'}),params);assert.equal(res.status,200);assert.equal(db.state.updated.notes,'Переписка: MAX\nКомментарий');
 const route=await jiti.import('../src/app/api/client-cases/[id]/action/route.ts');
 const actionRequest=action=>new Request('http://example.test/action',{method:'POST',body:JSON.stringify({action})});
 db.state.existing=null;
 res=await route.POST(actionRequest('mark_calculation_sent'),{params:Promise.resolve({id:'missing'})});assert.equal(res.status,404);
 db.state.existing={id:'case-a',appointmentId:null,yclientsRecordId:null};
 res=await route.POST(actionRequest('close'),{params:Promise.resolve({id:'case-a'})});assert.equal(res.status,400,'Cannot complete an unbooked request');
 db.state.existing={id:'case-a',appointmentId:'booking-a',yclientsRecordId:null};
 res=await route.POST(actionRequest('close'),{params:Promise.resolve({id:'case-a'})});assert.equal(res.status,200);
 const wf=await jiti.import(alias['@/lib/client-case-workflow']);
 const requestBody=body=>new Request('http://example.test/action',{method:'POST',body:JSON.stringify(body)});
 db.state.existing={id:'case-a',appointmentId:null,yclientsRecordId:null,suppliesNote:'Фильтр и прокладка\nЗаказ РОССКО № 999'};
 res=await route.POST(requestBody({action:'waiting_parts',rosskoOrderNumber:'123456789',suppliesExpectedAt:'2026-10-24T15:30'}),{params:Promise.resolve({id:'case-a'})});
 assert.equal(res.status,200);assert.equal(wf.state.last.body.suppliesNote,'Заказ РОССКО № 123456789\nФильтр и прокладка');assert.equal(wf.state.last.body.suppliesSupplier,'РОССКО');assert.equal(wf.state.last.body.suppliesExpectedAt,'2026-10-24T13:30:00.000Z');
 res=await route.POST(requestBody({action:'waiting_parts',rosskoOrderNumber:'not-an-order'}),{params:Promise.resolve({id:'case-a'})});assert.equal(res.status,400);
 res=await route.POST(requestBody({action:'waiting_parts',suppliesExpectedAt:'bad-date'}),{params:Promise.resolve({id:'case-a'})});assert.equal(res.status,400);
 res=await route.POST(requestBody({action:'waiting_parts'}),{params:Promise.resolve({id:'case-a'})});assert.equal(res.status,200);assert.equal(wf.state.last.body.suppliesNote,undefined,'Skipping preserves existing supplier notes');
 console.log('Simple CRM routes: required phone/request, forced initial status, author without assignment, deadline, missing cases and booking-before-close passed');
}finally{rmSync(dir,{recursive:true,force:true});}
