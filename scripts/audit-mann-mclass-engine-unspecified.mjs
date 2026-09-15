import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),'33fcc0c9b7396f57fca01ae9e062eb5faecf1e7b37a56f15a6fa4d9ec0a68596');const plan=JSON.parse(raw);
const audit=JSON.parse(await readFile(resolve(dir,'plan-engine-intersections-v1.json'),'utf8'));assert.equal(audit.planHash,sha(raw));
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements');
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');const mann=parseCopy(mannRaw,'mann_filter_applications');
const rowsRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(rowsRaw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');const rows=rowsRaw.trim().split('\n').map(JSON.parse);
const fixture=resolve(root,'scripts/fixtures/mann-resolver-archive-stubs.mjs'),j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src'),'@/lib/db':fixture}});
const {toVehicle}=await j.import('../src/lib/vehicle-identity.ts'),{resolveMannVehicle}=await j.import('../src/lib/mann-vehicle-resolver.ts'),{mannTechnicalContextFromVehicle:requestContext}=await j.import('../src/lib/mann-technical-request-context.ts'),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const state={rows:mann,catalogCalls:0,aliasCalls:0,mappingCalls:0};globalThis[Symbol.for('mann-resolver-archive-test')]=state;
const findings=[];let profileChecks=0;
try{
 for(const f of audit.noEngine.filter(f=>!f.held)){
  const r=plan.newRevisions.find(r=>r.id===f.revisionId),s=sources.find(s=>s.id===r.sourceRequirementId),row=rows.find(row=>row.row_id===s.sourceRowId);
  assert.equal(r.systemCode,'BRAKE_FLUID');assert.equal(s.model,'m class');assert.deepEqual(s.engineCodesJson,[]);assert.equal(s.contextConfidence,'table_engine');
  assert.equal(row.fill_volume,r.technicalDataJson.fillVolumeText);assert.ok(row.specification.includes('DOT-4+'));assert.ok(r.technicalDataJson.specifications.some(v=>v.type==='DOT'&&v.value==='DOT-4+'));
  const anchors=rows.filter(a=>a.source_url===row.source_url&&a.table_index===row.table_index&&a.system_name==='МАСЛО в ДВИГАТЕЛЬ');assert.ok(anchors.length);
  const targets=mann.filter(m=>m.vehicleVariantKey===r.vehicleVariantKey);assert.ok(targets.length);
  const resolutionChecks=[],a=r.applicabilityJson,w=a.window.intersection;
  for(const productionMonth of [w.from,w.to])for(const detailed of [false,true]){
   const input={Brand:s.make,Model:s.model,Generation:s.generation,Year:Number(productionMonth.slice(0,4)),...(detailed?{BodyCode:s.bodyCodesJson.join(' '),EngineVolumeCc:s.engineVolumeCc,PowerHp:s.powerHp,FuelType:s.fuelType}:{})};
   const vehicle=toVehicle(input,'tronk_vindecode');assert.equal(vehicle.engineCode,undefined);
   const resolved=await resolveMannVehicle({organizationId:'LOCAL_ARCHIVE_DIAGNOSTIC',vehicle}),index=resolved.candidates.findIndex(c=>c.variantIds.includes(r.vehicleVariantKey));
   resolutionChecks.push({detailed,input,position:index<0?null:index+1,candidates:resolved.candidates.map(c=>({ids:c.variantIds,score:c.score,model:c.model,vehicleText:c.vehicleText}))});
   const context=requestContext(vehicle,{productionMonth}),runtime={...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}};
   const items=profile([runtime],undefined,context).items;assert.equal(items.length,1);assert.equal(items[0].revisionId,r.id);assert.equal(items[0].automaticSelectionEligible,false);profileChecks++;
   assert.equal(profile([runtime],undefined,{...context,make:'TOYOTA'}).items.length,0);profileChecks++;
  }
  findings.push({revisionId:r.id,source:s,sourceRow:row,engineAnchors:anchors,mannEvidence:targets,resolutionChecks,status:'ENGINE_CODE_UNSPECIFIED_SOURCE; SELECTED_VARIANT_AND_DATE_REQUIRED; SOURCE_FACTS_NOT_OEM_VERIFIED'});
 }
 assert.equal(findings.length,7);
 const detailed=findings.flatMap(f=>f.resolutionChecks.filter(c=>c.detailed)),minimal=findings.flatMap(f=>f.resolutionChecks.filter(c=>!c.detailed));
 const summary={revisions:findings.length,profileChecks,resolverCases:state.catalogCalls,detailedTargetInTopFive:detailed.filter(c=>c.position!==null).length,detailedTargetFirst:detailed.filter(c=>c.position===1).length,minimalTargetInTopFive:minimal.filter(c=>c.position!==null).length,heldExcluded:audit.noEngine.filter(f=>f.held).map(f=>f.revisionId)};
 const report={kind:'MCLASS_ENGINE_UNSPECIFIED_SOURCE_AND_RESOLVER_DIAGNOSTIC',planHash:sha(raw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),rawHash:sha(rowsRaw),summary,findings,productionApplyAllowed:false,limitations:['Synthetic source-derived vehicle attributes, no engine inferred from MANN.','Candidate ranking diagnostic with no persisted aliases/mappings; selected-variant profile tested independently, not proof of automatic VIN matching.','Raw table anchors retained for review; does not independently verify technical fluid values or all source-to-anchor attribute parsing.','One held GLK explicitly excluded; no change to canonical plan or production.']};
 await writeFile(resolve(dir,'mclass-engine-unspecified-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
}finally{delete globalThis[Symbol.for('mann-resolver-archive-test')];}
