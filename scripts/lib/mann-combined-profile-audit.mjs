import {createJiti} from 'jiti';
import {resolve} from 'node:path';
import {sha} from './mann-offline-scope.mjs';
import assert from 'node:assert/strict';

// Investigates actual post-replacement DB rows. Differences are review findings,
// not permission to remove either source or substitute a preferred value.
export async function auditCombinedProfiles(root,persisted,payload,runtimeRead=false,routeRead=false,capacityProbes=false){
 const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
 const {buildMannUnifiedTechnicalProfile:profile,getMannUnifiedTechnicalProfile:getProfile}=await j.import('../../src/lib/mann-unified-technical-profile.ts');
 const {parseConditionalFluidCapacities:parseCapacity}=await j.import('../../src/lib/fluid-capacity-conditions.ts');
 if(runtimeRead){
  const {prisma}=await j.import('../../src/lib/db.ts');
  const [connection]=await prisma.$queryRawUnsafe('SELECT current_database() AS database, inet_server_addr()::text AS address');
  assert.deepEqual(connection,{database:'mann_fixture',address:null});
 }
 let route;
 if(routeRead){
  assert.ok(runtimeRead,'Route proof requires a checked local database connection');
  const routeJiti=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/branch-api':resolve(root,'scripts/fixtures/mann-local-route-auth.mjs')}});
  route=(await routeJiti.import('../../src/app/api/mann-catalog/technical-profile/route.ts')).POST;
 }
 const currentIds=new Set(payload.revisions.map(r=>r.originalRevision.id));
 const byVariant=Map.groupBy(persisted,r=>r.vehicleVariantKey);
 const findings=[],seen=new Set(),visibleLegacyIds=new Set();let cases=0;
 const payloadValue=i=>sha({capacities:i.capacities,specifications:[...i.specifications].sort(),viscosityGrades:[...i.viscosityGrades].sort()});
 const probes=[...payload.revisions];
 if(capacityProbes)for(const {originalRevision:r} of payload.revisions)for(const branch of r.technicalDataJson.capacityBranches??[]){
  const condition=branch.condition;
  const transmissionType=condition.kind==='transmission'?condition.value:condition.kind==='engineTransmission'?condition.transmissionType:undefined;
  const engine=condition.kind==='engine'?condition.value:condition.kind==='engineTransmission'?condition.engineCode:undefined;
  const rearAirConditioning=condition.kind==='rearAirConditioning'?condition.value==='present':undefined;
  probes.push({originalRevision:{...r,applicabilityJson:{...r.applicabilityJson,...branch.applicabilityJson,...(engine?{matchedEngineScope:[engine]}:{}),...(transmissionType?{transmissionType}:{}),...(rearAirConditioning!==undefined?{rearAirConditioning}:{})}}});
 }
 for(const {originalRevision:r} of payload.revisions)if(r.applicabilityJson.requiredVehicleDrive){
  probes.push({originalRevision:r,driveProbe:undefined},{originalRevision:r,driveProbe:r.applicabilityJson.requiredVehicleDrive==='2WD'?'4WD':'2WD'});
 }
 for(const probe of probes){
  const r=probe.originalRevision;
  const a=r.applicabilityJson;
  const context={...a.sourceVehicleScope,engineCode:a.matchedEngineScope?.[0],productionMonth:a.window?.intersection?.from,confirmedMarket:a.requiredMarket,transmissionGearCount:a.transmissionGearCount??a.requiredTransmission?.gearCount,transmissionModel:a.componentModel,rearAirConditioning:a.rearAirConditioning};
  context.confirmedDrive=Object.hasOwn(probe,'driveProbe')?probe.driveProbe:a.requiredVehicleDrive;
  const type=a.requiredTransmission?.type??a.transmissionType,key=sha({variant:r.vehicleVariantKey,context,type});
  if(seen.has(key))continue;seen.add(key);cases++;
  const rows=byVariant.get(r.vehicleVariantKey)??[];
  const all=profile(rows,type,context),newOnly=profile(rows.filter(x=>currentIds.has(x.id)),type,context);
  if(r.provenanceJson.sourcePowerReviewHold)assert.equal(all.items.some(i=>i.revisionId===r.id),false,'Power-held revision must remain hidden after persistence');
  if(a.requiredVehicleDrive)assert.equal(all.items.some(i=>i.revisionId===r.id),context.confirmedDrive===a.requiredVehicleDrive,'Persisted drive scope must reject missing/wrong confirmation');
  if(r.technicalDataJson.capacityBranches?.some(b=>b.condition.kind==='rearAirConditioning')){
   const item=all.items.find(i=>i.revisionId===r.id);assert.ok(item,'Persisted rear-AC scoped record missing');
   assert.equal(all.rearAirConditioningRequired,true);
   const parsed=parseCapacity(r.technicalDataJson.fillVolumeText,r.systemCode);assert.equal(parsed.status,'structured');
   const selected=typeof context.rearAirConditioning==='boolean'?parsed.branches.find(b=>b.condition.kind==='rearAirConditioning'&&b.condition.value===(context.rearAirConditioning?'present':'absent')):undefined;
   assert.deepEqual(item.capacities.map(c=>c.nominalLiters),selected?[selected.capacity.nominalLiters]:[],'Persisted capacity must follow explicit equipment, not row order');
  }
  if(runtimeRead){
   const actual=await getProfile([r.vehicleVariantKey],type,context);
   const comparable=value=>{
    const copy=JSON.parse(JSON.stringify(value));
    // Option membership/fields matter here; SQL does not promise input row
    // order for equal timestamps. Never normalize away fluid item differences.
    if(copy.equipmentOptions)copy.equipmentOptions.sort((a,b)=>JSON.stringify([a.circuit,a.drive,a.componentModel,a.attachedTransmissionType,a.systemCode]).localeCompare(JSON.stringify([b.circuit,b.drive,b.componentModel,b.attachedTransmissionType,b.systemCode])));
    return copy;
   };
   assert.deepEqual(comparable(actual),comparable(all),`Actual DB profile differs for ${key}`);
   if(route){
    // JSON transport drops undefined, but null is not an optional schema field.
    const vehicleContext=Object.fromEntries(Object.entries(context).filter(([,v])=>v!==null&&v!==undefined));
    const response=await route(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:[r.vehicleVariantKey],transmissionType:type??undefined,vehicleContext})}));
    assert.equal(response.status,200,`Route rejected context ${key}: ${JSON.stringify(vehicleContext)}`);
    const transportedExpected=await getProfile([r.vehicleVariantKey],type??undefined,vehicleContext);
    assert.deepEqual(comparable(await response.json()),comparable(transportedExpected),`Route changed profile ${key}`);
    assert.deepEqual(transportedExpected.items,actual.items,`Transport changed fluid items ${key}`);
   }
   if(cases%100===0)console.log(JSON.stringify({actualDatabaseProfilesChecked:cases}));
  }
  const oldItems=all.items.filter(i=>!currentIds.has(i.revisionId));for(const item of oldItems)visibleLegacyIds.add(item.revisionId);
  const different=[];
  for(const old of oldItems)for(const next of newOnly.items){
   if(old.systemCode!==next.systemCode||(old.componentModel??'')!==(next.componentModel??''))continue;
   if(payloadValue(old)===payloadValue(next))continue;
   different.push({legacy:old,current:next,reason:'SAME_SYSTEM_COMPONENT_DIFFERENT_DISPLAYED_VALUES'});
  }
  if(different.length)findings.push({vehicleVariantKey:r.vehicleVariantKey,context,transmissionType:type??null,differences:different});
 }
 return {kind:'PERSISTED_COMBINED_PROFILE_DIFFERENCE_AUDIT',payloadHash:sha(payload),persistedRows:persisted.length,uniqueContexts:cases,actualDatabaseProfilesChecked:runtimeRead?cases:0,actualRouteProfilesChecked:routeRead?cases:0,visibleLegacyRevisions:visibleLegacyIds.size,contextsWithDifferences:findings.length,findings,productionApplyAllowed:false,limitations:['Synthetic source-scoped contexts, not real decoded VINs or HTTP authorization tests.','Route mode invokes actual POST with local DB; authentication alone is stubbed, no HTTP server or browser.','Differences can represent distinct service contexts or evidence priority; not all are technical contradictions.','Equipment choices and every month/engine branch are not exhaustive.']};
}
