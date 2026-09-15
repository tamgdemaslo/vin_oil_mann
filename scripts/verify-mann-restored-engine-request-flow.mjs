import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),'33fcc0c9b7396f57fca01ae9e062eb5faecf1e7b37a56f15a6fa4d9ec0a68596');
const plan=JSON.parse(raw),draftRaw=await readFile(resolve(dir,'four-engine-restoration-drafts-v1.json'),'utf8'),drafts=JSON.parse(draftRaw).drafts;
assert.equal(sha(draftRaw),plan.fourEngineScopeRestoration.draftHash);
const fixture=resolve(root,'scripts/fixtures/mann-profile-db-route-stubs.mjs');
const j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':fixture,'@/lib/branch-api':fixture}});
const {toVehicle}=await j.import('../src/lib/vehicle-identity.ts'),{mannTechnicalContextFromVehicle:contextFromVehicle}=await j.import('../src/lib/mann-technical-request-context.ts'),{POST}=await j.import('../src/app/api/mann-catalog/technical-profile/route.ts');
const state={rows:[],calls:0};globalThis[Symbol.for('mann-profile-db-route-test')]=state;
const month=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
let checks=0,visible=0,missingEngineChecks=0;const examples=[];
try{
 for(const d of drafts){
  const r=plan.newRevisions.find(r=>r.id===d.after.id);assert.deepEqual(r,d.after);
  state.rows=[{...r,createdAt:new Date('2026-09-14'),reviewDecisions:[],reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}}];
  const a=r.applicabilityJson,w=a.window.intersection;
  for(let m=month(w.from)-1;m<=month(w.to)+1;m++)for(const engineCode of [...d.originalSource.engineCodesJson,undefined,'UNRELATED_TEST_ENGINE']){
   const productionMonth=`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
   const input={Brand:a.sourceVehicleScope.make,Model:a.sourceVehicleScope.model,Generation:a.sourceVehicleScope.generation,EngineCode:engineCode,Year:Math.floor(m/12)};
   const vehicle=toVehicle(input,'tronk_vindecode');
   const vehicleContext=JSON.parse(JSON.stringify(contextFromVehicle(vehicle,{productionMonth})));
   const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:[r.vehicleVariantKey],vehicleContext})}));
   assert.equal(response.status,200);const result=await response.json();
   const allowed=m>=month(w.from)&&m<=month(w.to)&&a.matchedEngineScope.includes(engineCode);
   assert.equal(result.items.length,allowed?1:0,JSON.stringify({id:r.id,input,vehicleContext}));
   if(allowed){assert.equal(result.items[0].revisionId,r.id);assert.equal(result.items[0].automaticSelectionEligible,false);visible++;}
   if(!engineCode)missingEngineChecks++;
   if(m===month(w.from)&&d.after.provenanceJson.engineScopeRestoration.restoredCodes.includes(engineCode))examples.push({revisionId:r.id,input,vehicleContext,items:result.items});
   checks++;
  }
 }
 assert.equal(state.calls,checks);assert.equal(examples.length,4);assert.ok(visible>0&&missingEngineChecks>0);
 const files=['src/lib/vehicle-identity.ts','src/lib/mann-technical-request-context.ts','src/lib/mann-unified-technical-profile.ts','src/app/api/mann-catalog/technical-profile/route.ts','scripts/fixtures/mann-profile-db-route-stubs.mjs'];
 const report={kind:'RESTORED_ENGINE_NORMALIZATION_REQUEST_ROUTE_TEST',planHash:sha(raw),draftHash:sha(draftRaw),files:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary:{checks,visible,missingEngineChecks,restoredExamples:examples.length},examples,productionApplyAllowed:false,limitations:['Synthetic provider payloads, selected variant keys supplied from evidence; no real VIN decoder or MANN resolver test.','Production normalizer/request serializer/route/profile code, but database and authentication stubbed.','Exact production month supplied as user detail; no assumption that model year proves build month.','No database write, activation, deployed HTTP, browser interaction or OEM fluid approval.']};
 await writeFile(resolve(dir,'restored-engine-request-flow-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
}finally{delete globalThis[Symbol.for('mann-profile-db-route-test')];}
