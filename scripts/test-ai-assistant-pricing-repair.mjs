#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
const root=process.cwd();
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src'),'@/lib/db':resolve(root,'scripts/fixtures/ai-assistant/db.mjs'),'@/lib/auth':resolve(root,'scripts/fixtures/ai-assistant/pricing-access.mjs'),'@/lib/branch-context':resolve(root,'scripts/fixtures/ai-assistant/pricing-access.mjs')},moduleCache:true});
globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN');};
const {GET,POST}=await jiti.import(resolve(root,'src/app/api/ai-assistant/pricing-rules/repair/route.ts'));
const {pricingRepairPlans}=await jiti.import(resolve(root,'src/lib/ai-assistant/pricing-repair-plan.ts'));
const branch=(id,group='group')=>({id,name:id,slug:`location-${id}`,status:'active',businessGroupId:group,legacyOrganizationId:`org-${id}`});
const rule=(id,overrides={})=>({id,branchId:'a',organizationId:'default',locationId:'legacy-location',serviceFamily:'transmission_fluid',procedureType:'partial',transmissionConfiguration:'no_pan',materialsOwner:'service',vehicleId:null,aggregateCode:null,name:id,laborPriceCents:11100,priceFromCents:null,priceToCents:null,requiresHumanConfirmation:false,active:true,effectiveFrom:new Date(0),effectiveTo:null,createdAt:new Date(0),updatedAt:new Date(0),createdById:'system',updatedById:'system',comment:null,...overrides});
function reset(){
 const branches=[branch('a'),branch('b'),branch('c','other-group')];
 globalThis.__tgmPricingSession={user:{role:'owner',login:'owner'}};
 globalThis.__tgmPricingContext={userId:'user',mode:'branch',branchId:'b',groupRole:'owner',branches};
 globalThis.__tgmReplay={ids:0,dbCalls:[],tables:{branch:branches,aIAssistantThread:[{id:'thread-a',branchId:'a'}],aIAssistantLaborPricingRule:[rule('base'),rule('pan',{transmissionConfiguration:'pan_and_filter',laborPriceCents:22200})]}};
 return globalThis.__tgmReplay;
}
const request=(query,body)=>new Request(`http://localhost/api/ai-assistant/pricing-rules/repair?${query}`,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:undefined);
const preview=async query=>{const response=await GET(request(query));assert.equal(response.status,200);return response.json();};
const choose=plan=>({planId:plan.id,token:plan.token,ruleIds:plan.rules.map(row=>row.id)});
let count=0;async function test(name,work){reset();await work();count++;console.log(`PASS ${name}`);}
await test('diagnoses invisible legacy organization; GET never mutates',async()=>{
 const p=await preview('branchId=a');assert.equal(p.visibleCount,0);assert.equal(p.legacyCount,2);assert.equal(p.plans[0].kind,'restore');assert.equal(p.plans[0].initialSettings,true);
 assert.equal(globalThis.__tgmReplay.dbCalls.some(call=>['create','update','updateMany'].includes(call.method)),false);
});
await test('stored thread branch wins over browser header and supplied branch',async()=>{
 const p=await preview('threadId=thread-a&branchId=b');assert.equal(p.branch.id,'a');
 const result=await POST(request('threadId=thread-a&branchId=b',choose(p.plans[0])));assert.equal(result.status,200);
 const state=globalThis.__tgmReplay;assert.ok(state.tables.aIAssistantLaborPricingRule.every(row=>row.branchId==='a'&&row.organizationId==='org-a'));
 assert.equal(state.tables.branchAuditLog[0].branchId,'a');
});
await test('copy uses server prices and target location; duplicate submit cannot add rules',async()=>{
 const p=await preview('branchId=b');const plan=p.plans.find(row=>row.sourceBranchName==='a');
 assert.ok(plan);const body=choose(plan);const first=await POST(request('branchId=b',body));assert.equal(first.status,200);
 const rows=globalThis.__tgmReplay.tables.aIAssistantLaborPricingRule.filter(row=>row.branchId==='b');
 assert.equal(rows.length,2);assert.ok(rows.every(row=>row.locationId==='location-b'&&row.organizationId==='org-b'));assert.deepEqual(rows.map(row=>row.laborPriceCents),[11100,22200]);
 assert.equal((await POST(request('branchId=b',body))).status,409);assert.equal(globalThis.__tgmReplay.tables.aIAssistantLaborPricingRule.filter(row=>row.branchId==='b').length,2);
});
await test('rejects stale source, invented row and client price',async()=>{
 let plan=(await preview('branchId=b')).plans[0];globalThis.__tgmReplay.tables.aIAssistantLaborPricingRule[0].laborPriceCents=99900;
 assert.equal((await POST(request('branchId=b',choose(plan)))).status,409);
 plan=(await preview('branchId=b')).plans[0];assert.equal((await POST(request('branchId=b',{...choose(plan),ruleIds:['foreign']}))).status,409);
 assert.equal((await POST(request('branchId=b',{...choose(plan),laborPriceCents:0}))).status,400);
 assert.equal(globalThis.__tgmReplay.tables.aIAssistantLaborPricingRule.length,2);
});
await test('owner/admin access and allowed branches are checked for GET and POST',async()=>{
 assert.equal((await GET(request('branchId=foreign'))).status,409);
 globalThis.__tgmPricingSession.user.role='employee';assert.equal((await GET(request('branchId=a'))).status,403);assert.equal((await POST(request('branchId=a',{}))).status,403);
 globalThis.__tgmPricingSession=null;assert.equal((await GET(request('branchId=a'))).status,401);
});
await test('different groups, narrowed tariffs and conflicts are not copy candidates',async()=>{
 const s=globalThis.__tgmReplay;s.tables.aIAssistantLaborPricingRule.push(rule('foreign',{branchId:'c',organizationId:'org-c'}),rule('vehicle-only',{vehicleId:'vehicle',procedureType:'machine'}),rule('conflict'));
 const p=await preview('branchId=b');assert.equal(p.plans.length,1);assert.deepEqual(p.plans[0].rules.map(row=>row.id),['pan']);
});
await test('existing wildcard and future tariffs are preserved',async()=>{
 const s=globalThis.__tgmReplay;s.tables.aIAssistantLaborPricingRule.push(rule('existing',{branchId:'b',organizationId:'org-b',transmissionConfiguration:null,effectiveFrom:new Date('2099-01-01')}));
 const p=await preview('branchId=b');assert.equal(p.plans.length,0);
});
await test('partial selection restores only checked rows without changing prices',async()=>{
 const plan=(await preview('branchId=a')).plans[0];const result=await POST(request('branchId=a',{...choose(plan),ruleIds:['base']}));assert.equal(result.status,200);
 assert.deepEqual(globalThis.__tgmReplay.tables.aIAssistantLaborPricingRule.map(row=>[row.organizationId,row.laborPriceCents]),[['org-a',11100],['default',22200]]);
});
await test('foreign organization rows in same branch never become recoverable',()=>{
 const target={id:'a',name:'A',organizationId:'org-a',businessGroupId:'group',slug:'location-a',rules:[rule('other',{organizationId:'unrelated-org'})]};
 assert.deepEqual(pricingRepairPlans(target,[]),[]);
});
console.log(`Pricing repair: ${count} local scenarios passed; no live writes.`);
