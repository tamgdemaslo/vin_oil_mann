import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createJiti} from 'jiti';
const dir=mkdtempSync(join(tmpdir(),'crm-routes-'));
function stub(name,code){const file=join(dir,name+'.cjs');writeFileSync(file,code);return file;}
const alias={
 '@/lib/auth':stub('auth','exports.getSession=async()=>({user:{login:"vadim",role:"owner"}});'),
 '@/lib/crm-access':stub('access','exports.canAccessCrm=()=>true;'),
 '@/lib/branch-api':stub('branch','exports.requireBranchApi=async()=>({ok:true,context:{branchId:"a"}});exports.runWithBranchApiContext=(_,fn)=>fn();'),
 '@/lib/branch-sql-context':stub('sql','exports.requireSingleBranchSqlContext=()=>({branchId:"a"});'),
 '@/lib/crm':stub('stages','exports.ensureDefaultCrmStages=async()=>{};exports.getFirstCrmStage=async()=>({id:"first",name:"Нужно рассчитать"});exports.getCrmStageBySortOrder=async n=>({id:"stage-"+n});'),
 '@/lib/crm-deadline-notifications':stub('notify','exports.notifyClientCaseTaskAssigned=async()=>{throw Error("Unexpected assigned notification");};'),
 '@/lib/client-case-workflow':stub('workflow','exports.writeClientCaseEvent=async()=>{};exports.processClientCaseWorkflowTransitions=async()=>({});exports.applyClientCaseAction=async(id,action)=>({id,caseStatus:action});'),
 '@/lib/db':stub('db',`exports.state={existing:null,created:null};exports.prisma={crmDeal:{findUnique:async()=>exports.state.existing,findFirst:async()=>null,create:async({data})=>{exports.state.created=data;return {id:'new',...data}}},crmStage:{findUnique:async()=>({id:'first',name:'Нужно рассчитать'})}};`),
 '@':resolve('src'),
};
try{
 const jiti=createJiti(import.meta.url,{alias});
 const db=await jiti.import(alias['@/lib/db']);
 const {POST}=await jiti.import('../src/app/api/crm/deals/route.ts');
 let res=await POST(new Request('http://example.test/api/crm/deals',{method:'POST',body:JSON.stringify({quickRequest:true,title:'ТО',phone:'12'})}));
 assert.equal(res.status,400);assert.equal(db.state.created,null);
 res=await POST(new Request('http://example.test/api/crm/deals',{method:'POST',body:JSON.stringify({quickRequest:true,title:'ТО',phone:'8 900 000-00-01',responsibleLogin:'other',caseStatus:'calculation_sent',stageId:'wrong'})}));
 assert.equal(res.status,201);
 const created=await res.json();
 assert.equal(created.caseStatus,'calculation_needed');assert.equal(created.stageId,'first');assert.equal(created.phoneNormalized,'79000000001');assert.equal(created.createdByLogin,'vadim');assert.equal(created.responsibleLogin,null);assert.ok(created.nextActionAt);assert.equal(created.nextActionAt,created.nextContactAt);
 const route=await jiti.import('../src/app/api/client-cases/[id]/action/route.ts');
 const actionRequest=action=>new Request('http://example.test/action',{method:'POST',body:JSON.stringify({action})});
 db.state.existing=null;
 res=await route.POST(actionRequest('mark_calculation_sent'),{params:Promise.resolve({id:'missing'})});assert.equal(res.status,404);
 db.state.existing={id:'case-a',appointmentId:null,yclientsRecordId:null};
 res=await route.POST(actionRequest('close'),{params:Promise.resolve({id:'case-a'})});assert.equal(res.status,400,'Cannot complete an unbooked request');
 db.state.existing={id:'case-a',appointmentId:'booking-a',yclientsRecordId:null};
 res=await route.POST(actionRequest('close'),{params:Promise.resolve({id:'case-a'})});assert.equal(res.status,200);
 console.log('Simple CRM routes: required phone/request, forced initial status, author without assignment, deadline, missing cases and booking-before-close passed');
}finally{rmSync(dir,{recursive:true,force:true});}
