import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
const mock=resolve('scripts/fixtures/mann-fluid-research-mocks.mjs');
const j=createJiti(import.meta.url,{alias:{'@':resolve('src'),'@/lib/db':mock,'@/lib/openai-client':mock}});
const {prisma}=await j.import('./fixtures/mann-fluid-research-mocks.mjs');
const standardFind=prisma.aIAgentTechnicalEvidence.findFirst;
prisma.aIAgentTechnicalEvidence.findFirst=async args=>args.where.facts
  ? [...globalThis.fluidResearchTest.rows].reverse().find(row=>row.organizationId===args.where.organizationId&&row.vehicleKey===args.where.vehicleKey&&row.factType===args.where.factType&&row.facts.group===args.where.facts.equals)
  : standardFind(args);
const {researchMissingMannFluids:run}=await j.import('../src/lib/mann-fluid-research.ts');
const originalKey=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='isolated-test-key';
const profile={items:[],status:'none',transmissionOptions:[],containsCatalogPreview:false};
const input={organizationId:'org1',variantKeys:['key'],vehicleContext:{make:'FORD',model:'Mondeo V'},profile};
const batch={skipHourlyLimit:true,reuseAnyGroupResult:true};
const application={vehicleVariantKey:'key',make:'FORD',model:'Mondeo V',effectiveVehicleText:'2.5',vehicleText:'2.5',engineCode:'ABC',vehicleYears:'05/15 ->',modelYears:null,kw:'110',hp:'150'};
const item={systemCode:'ENGINE_OIL',specification:'TEST',volumeText:'5 л. с фильтром',sourceUrl:'https://example.com/manual',sourceTitle:'Manual',excerpt:'Test excerpt'};
try{
 const s=globalThis.fluidResearchTest={applications:[application],rows:[],calls:0,limit:true,payload:{items:[item],unresolved:[]}};
 assert.equal((await run(input)).status,'unavailable');assert.equal(s.calls,0,'ordinary API path retains twenty-per-hour limit');
 const first=await run({...input,batch});assert.equal(first.status,'saved');assert.equal(first.fromCache,false);assert.equal(first.evidenceId,'1');assert.equal(s.calls,1,'explicit internal batch bypasses hourly cap');
 const batchFind=prisma.aIAgentTechnicalEvidence.findFirst;
 prisma.aIAgentTechnicalEvidence.findFirst=standardFind;
 const confirmed=await run({...input,batch,transmissionType:'automatic',vehicleContext:{...input.vehicleContext,confirmedTransmissionType:'automatic'}});
 assert.equal(confirmed.status,'needs_context');assert.equal(s.calls,1,'restored gearbox scope must not trigger another paid research');
 prisma.aIAgentTechnicalEvidence.findFirst=batchFind;
 const previous=s.rows[0];previous.status='not_found';previous.validUntil=new Date('2000-01-01');previous.facts.items=[];previous.aggregate='different-gap-hash';
 let result=await run({...input,batch,profile:{...profile,items:[{systemCode:'ENGINE_OIL',specifications:['Existing'],viscosityGrades:['5W-30'],capacities:[{nominalLiters:5,service:true}]}]}});
 assert.equal(result.fromCache,true);assert.equal(result.evidenceId,'1');assert.equal(s.calls,1,'expired not_found reused even when gaps changed');
 previous.status='failed';previous.facts.failure={code:'provider',message:'Prior failure'};
 result=await run({...input,batch,retryFailed:true});assert.equal(result.status,'unavailable');assert.equal(result.fromCache,true);assert.equal(s.calls,1,'batch never retries expired failed groups, including retryFailed');
 previous.status='approved';previous.invalidatedAt=new Date();previous.facts.items=[item];
 result=await run({...input,batch});assert.equal(result.errorCode,'previous_invalidated');assert.deepEqual(result.items,[]);assert.equal(s.calls,1,'invalidated evidence blocks new payment without reapplying invalid values');
 previous.invalidatedAt=null;previous.status='failed';
 await run({...input,batch,group:'transmission'});assert.equal(s.calls,2,'another group gets its own first search');
 await run({...input,batch,organizationId:'org2'});assert.equal(s.calls,3,'no reuse across organizations');
 console.log('PASS internal batch hourly bypass, ordinary cap preserved, group/tenant scope, no repeat after gap change or expired failed/not_found, invalidation safety and evidence IDs');
}finally{prisma.aIAgentTechnicalEvidence.findFirst=standardFind;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;}
