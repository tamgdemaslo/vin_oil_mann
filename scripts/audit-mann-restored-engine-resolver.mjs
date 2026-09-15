import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),'33fcc0c9b7396f57fca01ae9e062eb5faecf1e7b37a56f15a6fa4d9ec0a68596');const plan=JSON.parse(raw);
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const rows=parseCopy(mannRaw,'mann_filter_applications');assert.equal(rows.length,37600);
const fixture=resolve(root,'scripts/fixtures/mann-resolver-archive-stubs.mjs'),j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src'),'@/lib/db':fixture}});
const {toVehicle}=await j.import('../src/lib/vehicle-identity.ts'),{resolveMannVehicle}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const state={rows,catalogCalls:0,aliasCalls:0,mappingCalls:0};globalThis[Symbol.for('mann-resolver-archive-test')]=state;
const allPlan=process.argv[2]==='--all-plan';assert.ok(process.argv.length===2||allPlan);
const cases=new Map(),findings=[],unconstructable=[];
for(const r of plan.newRevisions.filter(r=>allPlan||r.provenanceJson.engineScopeRestoration)){
 const a=r.applicabilityJson;
 const from=Number(a.window?.intersection?.from?.slice(0,4)??a.yearFrom),to=Number(a.window?.intersection?.to?.slice(0,4)??a.yearTo);
 if(!a.sourceVehicleScope?.make||!a.sourceVehicleScope?.model||!a.matchedEngineScope?.length||!Number.isInteger(from)||!Number.isInteger(to)){unconstructable.push({revisionId:r.id,reason:'MISSING_BASE_SCOPE_ENGINE_OR_DATES'});continue;}
 const years=allPlan?[...new Set([from,to])]:Array.from({length:to-from+1},(_,i)=>from+i);
 for(const engineCode of a.matchedEngineScope)for(const year of years){
  const input={Brand:a.sourceVehicleScope.make,Model:a.sourceVehicleScope.model,Generation:a.sourceVehicleScope.generation,EngineCode:engineCode,Year:year};
  cases.set(sha({input,expectedVariant:r.vehicleVariantKey}),{input,expectedVariant:r.vehicleVariantKey});
 }
}
try{
 for(const {input,expectedVariant} of cases.values()){
  const vehicle=toVehicle(input,'tronk_vindecode'),result=await resolveMannVehicle({organizationId:'LOCAL_ARCHIVE_DIAGNOSTIC',vehicle});
  assert.equal(result.selectedApplication,null,'No human mapping exists in fixture');assert.equal(result.usedManualMapping,false);
  const index=result.candidates.findIndex(c=>c.variantIds.includes(expectedVariant));
  findings.push({input,expectedVariant,status:result.status,expectedCandidatePosition:index<0?null:index+1,candidates:result.candidates,normalized:result.trace?.normalized,rejected:result.trace?.rejected});
 }
 const summary={cases:findings.length,targetInTopFive:findings.filter(f=>f.expectedCandidatePosition!==null).length,targetFirst:findings.filter(f=>f.expectedCandidatePosition===1).length,unresolved:findings.filter(f=>f.status==='unresolved').length,missingTarget:findings.filter(f=>f.expectedCandidatePosition===null).length,...{catalogCalls:state.catalogCalls}};
 assert.equal(state.catalogCalls,findings.length);assert.equal(state.aliasCalls,findings.length);assert.equal(state.mappingCalls,findings.length);
 const files=['src/lib/mann-vehicle-resolver.ts','src/lib/vehicle-identity.ts','scripts/fixtures/mann-resolver-archive-stubs.mjs'];
 const report={kind:'RESTORED_ENGINE_ARCHIVE_RESOLVER_DIAGNOSTIC',planHash:sha(raw),mannHash:sha(mannRaw),files:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary,findings,productionApplyAllowed:false,limitations:['Full archived MANN rows through actual resolver, synthetic provider make/model/generation/engine/year input.','Database query/projection stubbed; persisted model aliases and manual mappings intentionally absent, not proven absent in production.','No real VIN decoder, no user confirmation or filter lookup, no automatic selection enabled.','Target absence is diagnostic evidence requiring review, not permission to force ranking or merge variants.']};
 await writeFile(resolve(dir,allPlan?'current-plan-resolver-endpoints-v1.json':'restored-engine-resolver-v1.json'),JSON.stringify({...report,kind:allPlan?'CURRENT_PLAN_RESOLVER_ENDPOINT_DIAGNOSTIC':report.kind,unconstructable,scope:allPlan?'Each constructable variant/source-engine endpoint year; includes held drafts, does not confirm market, installed equipment or fluid correctness.':'Every restored-engine year'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...summary,unconstructable:unconstructable.length}));
}finally{delete globalThis[Symbol.for('mann-resolver-archive-test')];}
