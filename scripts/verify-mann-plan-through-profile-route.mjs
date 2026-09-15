import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const version=process.argv[2]??'v1',hashes={v1:'df04fc11f498bb6e4c48d0b2976e2f01ecc9442ae6fcbc7c3973c7329224c3e5',v2:'33fcc0c9b7396f57fca01ae9e062eb5faecf1e7b37a56f15a6fa4d9ec0a68596'};
assert.ok(hashes[version]);
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),hashes[version]);
const plan=JSON.parse(raw),fixture=resolve(root,'scripts/fixtures/mann-profile-db-route-stubs.mjs');
const j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':fixture,'@/lib/branch-api':fixture}});
const {POST}=await j.import('../src/app/api/mann-catalog/technical-profile/route.ts');
const {buildMannUnifiedTechnicalProfile:build}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const state={rows:[],calls:0};globalThis[Symbol.for('mann-profile-db-route-test')]=state;
const results=[],restoredScopeChecks=[];let plannedRunChecks=0;
try{
for(const r of plan.newRevisions){
 const p=r.provenanceJson;
 const row={...r,createdAt:new Date('2026-09-14'),reviewDecisions:[],reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:p.catalogPreviewPolicy,transmissionTypeCountPolicy:p.explicitTransmissionTypeCount?.policy,conditionalTransmissionPolicy:p.conditionalTransmissionPolicy,conditionalEquipmentPolicy:p.conditionalEquipmentPolicy,equipmentComponentDrivePolicy:p.explicitComponentDriveCondition?.policy,equipmentModelPolicy:p.explicitEquipmentModel?.policy,transmissionModelListPolicy:p.explicitTransmissionModelList?.policy,automaticProductSelection:false}}};
 state.rows=[row];
 const a=r.applicabilityJson;
 const vehicleContext=JSON.parse(JSON.stringify({...a.sourceVehicleScope,engineCode:a.matchedEngineScope?.[0],productionMonth:a.window?.intersection?.from??a.window?.intersection?.to,confirmedMarket:a.requiredMarket}));
 const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:[r.vehicleVariantKey],vehicleContext})}));
 assert.equal(response.status,200,r.id+' '+JSON.stringify(vehicleContext));
 const actual=await response.json(),expected=JSON.parse(JSON.stringify(build([row],undefined,vehicleContext)));
 assert.deepEqual(actual,expected,r.id);
 assert.ok(actual.items.every(i=>!i.automaticSelectionEligible));
 results.push({revisionId:r.id,itemCount:actual.items.length,transmissionOptions:actual.transmissionOptions.length});
 if(version==='v2'){
  row.run.status='PLANNED';
  const pendingResponse=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:[r.vehicleVariantKey],vehicleContext})}));
  assert.equal(pendingResponse.status,200);const pending=await pendingResponse.json();assert.equal(pending.items.length,0,'PLANNED run leaked into profile: '+r.id);plannedRunChecks++;
  row.run.status='COMPLETED';
  for(const engineCode of p.engineScopeRestoration?.restoredCodes??[]){
   const win=a.window.intersection,month=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
   for(const [m,allowed] of [[month(win.from)-1,false],[month(win.from),true],[month(win.to),true],[month(win.to)+1,false]]){
    const selected={...vehicleContext,engineCode,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
    const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:[r.vehicleVariantKey],vehicleContext:selected})}));
    assert.equal(response.status,200);const result=await response.json();assert.equal(result.items.length,allowed?1:0);assert.ok(result.items.every(i=>i.revisionId===r.id&&!i.automaticSelectionEligible));
    restoredScopeChecks.push({revisionId:r.id,engineCode,productionMonth:selected.productionMonth,visible:allowed});
   }
  }
 }
}
assert.equal(state.calls,plan.newRevisions.length+plannedRunChecks+restoredScopeChecks.length);
if(version==='v2'){assert.equal(plannedRunChecks,1932);assert.equal(restoredScopeChecks.length,16);}
assert.ok(results.some(r=>r.itemCount>0),'Require non-vacuous visible results');
const summary={checked:results.length,visibleInBaseContext:results.filter(r=>r.itemCount>0).length,withoutItemInBaseContext:results.filter(r=>!r.itemCount).length,databaseCalls:state.calls,plannedRunChecks,restoredScopeChecks:restoredScopeChecks.length};
const files=['src/lib/mann-unified-technical-profile.ts','src/app/api/mann-catalog/technical-profile/route.ts','scripts/fixtures/mann-profile-db-route-stubs.mjs'];
const report={kind:'CANONICAL_PLAN_ACTUAL_ROUTE_AND_QUERY_PROJECTION_TEST',planHash:sha(raw),files:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary,results,limitations:['Real route schema, query projection and profile builder; auth and database stubbed.','Synthetic completed staging runs, not persisted or approved run metadata.','One base context per isolated revision; conditional options and holds can yield no item.','Does not prove actual VIN decoding, deployed HTTP, joint profile completeness, publication readiness or primary-source accuracy.'],productionApplyAllowed:false};
await writeFile(resolve(dir,`plan-profile-route-projection-${version}.json`),JSON.stringify({...report,restoredScopeChecks},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
}finally{delete globalThis[Symbol.for('mann-profile-db-route-test')];}
