import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';

const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const read=async path=>{const raw=await readFile(path,'utf8');return {raw,data:JSON.parse(raw)}};
const plan=await read(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'));
const rematch=await read(resolve(dir,'pajero-engine-market-date-rematch-v1.json'));
assert.equal(sha(plan.raw),rematch.data.planHash);
const preflight=await read(resolve(dir,'confirmed-date-fluid-preflight-v1.json'));
assert.equal(sha(preflight.raw),rematch.data.preflightHash);
const live=await read(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'));
assert.equal(sha(live.raw),preflight.data.liveHash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),plan.data.inputHashes.source);
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseConditionalFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-conditions.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const policy='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1';
const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}});
const drafts=[];
for(const f of rematch.data.findings){
 const s=sources.get(f.sourceRequirementId);assert.equal(sha(s),f.sourceHash);assert.equal(s.systemCode,'ENGINE_COOLANT');
 assert.equal(f.targetValidated,true);assert.deepEqual(f.remainingTechnicalReasons,['CAPACITY_OR_SERVICE_CONDITION']);
 assert.equal(plan.data.newRevisions.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===f.vehicleVariantKey),false);
 const target=f.decision.targets.find(t=>t.vehicleVariantKey===f.vehicleVariantKey&&t.independentlyValidated);assert.ok(target);assert.deepEqual(target.hardConflicts,[]);assert.deepEqual(target.reviewBlockers,[]);
 const parsed=parse(s.fillVolumeText,s.systemCode);assert.equal(parsed.status,'structured');assert.equal(parsed.branches.length,2);
 assert.ok(parsed.branches.every(b=>b.condition.kind==='rearAirConditioning'));
 assert.deepEqual(parsed.branches.map(b=>[b.condition.value,b.capacity.nominalLiters]),[['absent',9],['present',10.5]]);
 const technicalDataJson={fillVolumeText:s.fillVolumeText,capacityBranches:parsed.branches.map(b=>({condition:b.condition,sourceSegment:b.sourceSegment,applicabilityJson:f.scope,validation:target,originalAssociationFingerprint:f.originalAssociationFingerprint})),specificationText:s.specificationText,specifications:s.specificationsJson,viscosityGrades:s.viscosityGradesJson,recommendationText:s.recommendationText,replacementIntervalText:s.replacementIntervalText,replacementKmMin:s.replacementKmMin,replacementKmMax:s.replacementKmMax,replacementMonths:s.replacementMonths,controlIntervalText:s.controlIntervalText,analogText:s.analogText};
 const fingerprint=sha({policy,sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,applicabilityJson:f.scope,technicalDataJson});
 drafts.push({id:`mtar_${fingerprint.slice(0,24)}`,sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson:f.scope,technicalDataJson,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH','technical.viscosityGrades':'SECONDARY_SOURCE_PARSED_HIGH'},evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:s.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:f.originalAssociationFingerprint,sourceRequirementHash:sha(s),literalEngineBranch:f.branch,rematchHash:sha(rematch.raw),independentValidation:target},state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:f.decision.status,matchScore:target.score,semanticFingerprint:fingerprint,applyEligible:false,replacesRevisionIds:[]});
}
assert.equal(drafts.length,5);assert.equal(new Set(drafts.map(r=>r.id)).size,5);
let checks=0;
const month=x=>Number(x.slice(0,4))*12+Number(x.slice(5))-1;
for(const r of drafts){
 const scope=r.applicabilityJson,from=month(scope.window.intersection.from),to=month(scope.window.intersection.to);
 const existing=[...plan.data.newRevisions.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey).map(fixture),...live.data.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey&&['ACTIVE','STAGED','REVIEW'].includes(x.state)).map(x=>({...x,createdAt:new Date(x.createdAt)}))];
 const additions=drafts.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey).map(fixture);
 for(let m=from-1;m<=to+1;m++)for(const engineCode of [scope.matchedEngineScope[0],'WRONG',undefined])for(const confirmedMarket of ['RU','JP',undefined])for(const rearAirConditioning of [undefined,false,true]){
  const context={...scope.sourceVehicleScope,engineCode,confirmedMarket,rearAirConditioning,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
  const inScope=m>=from&&m<=to&&engineCode===scope.matchedEngineScope[0]&&confirmedMarket===scope.requiredMarket;
  const isolated=profile([fixture(r)],undefined,context),before=profile(existing,undefined,context),after=profile([...existing,...additions],undefined,context);
  assert.equal(isolated.items.length,inScope?1:0);
  assert.equal(after.items.some(i=>i.revisionId===r.id),inScope);
  if(inScope){
   assert.equal(after.rearAirConditioningRequired,true);
   const item=after.items.find(i=>i.revisionId===r.id),expected=typeof rearAirConditioning==='boolean'?[rearAirConditioning?10.5:9]:[];
   assert.deepEqual(item.capacities.map(c=>c.nominalLiters),expected);
   assert.deepEqual(item.specifications,isolated.items[0].specifications);
   for(const same of after.items.filter(i=>i.systemCode===r.systemCode))assert.deepEqual({capacities:same.capacities,specifications:same.specifications},{capacities:item.capacities,specifications:item.specifications});
  }
  for(const old of before.items){
   const original=existing.find(x=>x.id===old.revisionId);
   const scopedReplacement=after.items.some(i=>additions.some(a=>a.id===i.revisionId&&a.sourceRequirementId===original.sourceRequirementId));
   if(scopedReplacement&&!original.reviewConfirmed&&!original.applyEligible&&original.verificationStatus==='UNVERIFIED')continue;
   assert.ok(after.items.some(i=>sha(i)===sha(old)),'Unrelated or protected legacy item changed');
  }
  assert.ok(after.items.every(i=>!i.automaticSelectionEligible));checks++;
 }
 const base={...scope.sourceVehicleScope,engineCode:scope.matchedEngineScope[0],confirmedMarket:scope.requiredMarket,productionMonth:scope.window.intersection.from,rearAirConditioning:false};
 const tampered=structuredClone(r);tampered.technicalDataJson.capacityBranches[0].sourceSegment='999 л.';
 assert.equal(profile([fixture(tampered)],undefined,base).items.length,0);
 assert.equal(profile([{...fixture(r),run:{...fixture(r).run,status:'PLANNED'}}],undefined,base).items.length,0);
}
await writeFile(resolve(dir,'pajero-rear-air-capacity-drafts-v1.json'),JSON.stringify({kind:'PAJERO_REAR_AIR_CAPACITY_DRAFTS',planHash:sha(plan.raw),rematchHash:sha(rematch.raw),liveHash:sha(live.raw),summary:{drafts:drafts.length,sourceRecords:new Set(drafts.map(r=>r.sourceRequirementId)).size,branches:10,checks},newRevisions:drafts,productionApplyAllowed:false,limitations:['Standalone drafts, not merged or deployed; secondary source, not OEM approval.','Full scoped months plus boundaries, engines, RU/JP/unknown markets and explicit true/false/unknown rear AC tested against archived legacy and sibling scopes.','No real VIN proof; unknown equipment leaves capacity unselected.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({drafts:5,branches:10,checks}));
