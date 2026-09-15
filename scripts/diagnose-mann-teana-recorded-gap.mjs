// Offline route diagnosis against the persisted snapshot; no provider calls/writes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-live-audit-1789469257907');
const read=f=>JSON.parse(readFileSync(resolve(dir,f),'utf8'));
const rows=read('revisions.json'),decisions=read('reviewDecisions.json');
const target=rows.find(r=>r.id==='mtar_569ab9c0c0032104c723c5aa');assert.ok(target);
const sample=read('recorded-vin-fluid-transmission-replay.json').findings.find(f=>f.sampleRef==='00a4fbe1e2009760');
const candidate=sample.evaluations.flatMap(e=>e.candidates).find(c=>c.variantIds.includes(target.vehicleVariantKey));assert.ok(candidate);assert.equal(candidate.vehicleContext.year,undefined);
globalThis[Symbol.for('mann-profile-db-route-test')]={calls:0,rows:rows.map(r=>({...r,createdAt:new Date(r.createdAt),reviewDecisions:decisions.filter(d=>d.revisionId===r.id)}))};
const fixture=resolve(root,'scripts/fixtures/mann-vin-replay-stubs.mjs');
const j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':fixture,'@/lib/branch-api':fixture}});
const saved=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Network forbidden');};
try{
 const {POST}=await j.import('../src/app/api/mann-catalog/technical-profile/route.ts');
 const {mannTransmissionComponent}=await j.import('../src/lib/mann-transmission-component.ts');
 const {explicitMannAlphanumericModels,explicitMannTransmissionModels,explicitMannCvtModels}=await j.import('../src/lib/mann-transmission-model-list.ts');
 const legacyListInventory=rows.filter(r=>['REVIEW','STAGED','ACTIVE'].includes(r.state)&&r.provenanceJson?.conditionalTransmissionEligible===true&&mannTransmissionComponent(r.componentModel).kind==='conditions'&&!r.run?.gatesJson?.transmissionModelListPolicy).map(r=>({revisionId:r.id,sourceRequirementId:r.sourceRequirementId,variantKey:r.vehicleVariantKey,systemCode:r.systemCode,componentModel:r.componentModel,literalModels:explicitMannAlphanumericModels(r.componentModel)??explicitMannTransmissionModels(r.componentModel)??explicitMannCvtModels(r.componentModel),hasScopedIdentity:!!r.applicabilityJson?.sourceVehicleScope,hasScopedWindow:!!r.applicabilityJson?.window,hasScopedEngine:!!r.applicabilityJson?.matchedEngineScope}));
 assert.ok(legacyListInventory.some(r=>r.revisionId===target.id));
 const cases=[['recorded',undefined,{}],['automatic_no_year','automatic',{}],['year_only',undefined,{year:2006}],['automatic_year','automatic',{year:2006}],['four_gears','automatic',{year:2006,transmissionGearCount:4}],['model_a','automatic',{year:2006,transmissionGearCount:4,transmissionModel:'RE4F04A'}],['model_b','automatic',{year:2006,transmissionGearCount:4,transmissionModel:'RE4F04B'}],['wrong_model','automatic',{year:2006,transmissionGearCount:4,transmissionModel:'JF011E'}],['wrong_generation','automatic',{year:2006,generation:'II',transmissionGearCount:4,transmissionModel:'RE4F04A'}],['wrong_engine','automatic',{year:2006,engineCode:'QR25DE',transmissionGearCount:4,transmissionModel:'RE4F04A'}],['outside_year','automatic',{year:2010,transmissionGearCount:4,transmissionModel:'RE4F04A'}]];
 const results=[];
 for(const [name,transmissionType,patch]of cases){const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:candidate.variantIds,transmissionType,vehicleContext:{...candidate.vehicleContext,...patch}})}));assert.equal(response.status,200);const p=await response.json();results.push({name,patch,transmissionType,targetVisible:p.items.some(i=>i.revisionId===target.id),visibleSystems:[...new Set(p.items.map(i=>i.systemCode))],transmissionOptions:p.transmissionOptions,targetItem:p.items.find(i=>i.revisionId===target.id)});}
 const inventoryCounts={legacyConditionalTextRows:legacyListInventory.length,literalModelListRows:legacyListInventory.filter(r=>r.literalModels).length,distinctSourceRows:new Set(legacyListInventory.map(r=>r.sourceRequirementId)).size};
 const report={kind:'TEANA_RECORDED_PERSISTED_SNAPSHOT_ROUTE_DIAGNOSIS',generatedAt:new Date().toISOString(),revisionSnapshotHash:sha(readFileSync(resolve(dir,'revisions.json'),'utf8')),sampleRef:sample.sampleRef,context:candidate.vehicleContext,targetRevision:target.id,sourceRequirementId:target.sourceRequirementId,results,inventoryCounts,legacyListInventory,limitations:['Offline actual POST handler with database/auth stubs, not authenticated production HTTP.','Year 2006 and gearbox choices are hypothetical diagnostic inputs, not decoded facts.','No source, draft, or production rows changed.','Inventory counts records, not VIN coverage or safe-to-publish matches. Every source/vehicle association still needs current identity/date validation.']};
 const output=resolve(dir,`teana-recorded-gap-${Date.now()}.json`);writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,inventoryCounts,results:results.map(({name,targetVisible,visibleSystems})=>({name,targetVisible,visibleSystems}))}));
}finally{globalThis.fetch=saved;delete globalThis[Symbol.for('mann-profile-db-route-test')];}
