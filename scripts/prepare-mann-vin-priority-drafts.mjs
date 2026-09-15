import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const tepee=process.argv.includes('--tepee');
const matchRaw=await readFile(resolve(dir,tepee?'vin-priority-scoped-rematch-v6.json':'vin-priority-scoped-rematch-v3.json'),'utf8'),rematch=JSON.parse(matchRaw),planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);
assert.equal(sha(planRaw),rematch.planHash);
for(const [file,hash] of Object.entries(rematch.codeHashes))assert.equal(sha(await readFile(resolve(root,file),'utf8')),hash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),plan.inputHashes.source);
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const pre=JSON.parse(await readFile(resolve(dir,tepee?'vin-priority-fluid-preflight-v4.json':'vin-priority-fluid-preflight-v1.json'),'utf8'));
const modelEvidence=tepee?JSON.parse(await readFile(resolve(root,'data/mann-partner-tepee-model-evidence-v1.json'),'utf8')):null;
const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8');assert.equal(sha(liveRaw),pre.liveHash);const live=JSON.parse(liveRaw);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1';
const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,transmissionTypeCountPolicy:r.provenanceJson.explicitTransmissionTypeCount?.policy,equipmentComponentDrivePolicy:r.provenanceJson.explicitComponentDriveCondition?.policy,equipmentModelPolicy:r.provenanceJson.explicitEquipmentModel?.policy,transmissionModelListPolicy:r.provenanceJson.explicitTransmissionModelList?.policy,automaticProductSelection:false}}});
const drafts=[];let checks=0;
for(const f of rematch.findings.filter(f=>f.targetValidated)){
  const s=sources.get(f.sourceRequirementId);assert.equal(sha(s),f.originalSourceHash);assert.deepEqual(f.reasons,[]);assert.deepEqual(f.predecessors,[]);
  assert.equal(f.sections.status,'NO_EXPLICIT_MARKER');
  assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===f.vehicleVariantKey));
  const technical={fillVolumeText:s.fillVolumeText,capacities:f.parsedCapacity.capacities,specificationText:s.specificationText,specifications:s.specificationsJson,viscosityGrades:s.viscosityGradesJson,
    recommendationText:s.recommendationText,replacementIntervalText:s.replacementIntervalText,replacementKmMin:s.replacementKmMin,replacementKmMax:s.replacementKmMax,replacementMonths:s.replacementMonths,controlIntervalText:s.controlIntervalText,analogText:s.analogText};
  const fingerprint=sha({policy,sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,applicability:f.scope,technical});
  const r={id:`mtar_${fingerprint.slice(0,24)}`,sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson:f.scope,technicalDataJson:technical,
    verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':technical.capacities.length?'SECONDARY_SOURCE_PARSED_HIGH':'NONE','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH','technical.viscosityGrades':'SECONDARY_SOURCE_PARSED_HIGH'},
    evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:s.sourceUrl}],
    provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:f.originalAssociationFingerprint,sourceRequirementHash:sha(s),literalEngineBranch:f.branch,preflightHash:rematch.preflightHash,rematchHash:sha(matchRaw),independentValidation:f.target},
    state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:f.decision.status,matchScore:f.target.score,semanticFingerprint:fingerprint,applyEligible:false,replacesRevisionIds:[]};
  if(tepee){r.evidenceJson.push(...modelEvidence.observations.map(o=>({publisher:o.publisher,title:`${o.product}: configuration evidence only`,url:o.url})));r.provenanceJson.reviewedModelScopeEvidence=sha(modelEvidence);}
  drafts.push(r);
}
assert.equal(drafts.length,tepee?1:5);
for(const r of drafts){
  const a=r.applicabilityJson,existing=[...plan.newRevisions.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey).map(fixture),...live.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey&&['ACTIVE','STAGED','REVIEW'].includes(x.state)).map(x=>({...x,createdAt:new Date(x.createdAt)}))];
  const month=x=>Number(x.slice(0,4))*12+Number(x.slice(5))-1,lo=month(a.window.intersection.from),hi=month(a.window.intersection.to);
  const combined=[...existing,...drafts.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey).map(fixture)];
  for(let m=lo-1;m<=hi+1;m++)for(const engineCode of [a.matchedEngineScope[0],'WRONG',undefined])for(const confirmedMarket of [a.requiredMarket,'JP',undefined])for(const model of tepee?[a.sourceVehicleScope.model,'PARTNER','PARTNER VAN','BIPPER TEPEE']: [a.sourceVehicleScope.model]){
    const context={...a.sourceVehicleScope,model,engineCode,confirmedMarket,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
    const expected=m>=lo&&m<=hi&&engineCode===a.matchedEngineScope[0]&&(!a.requiredMarket||confirmedMarket===a.requiredMarket)&&model===a.sourceVehicleScope.model;
    const isolated=profile([fixture(r)],undefined,context),before=profile(existing,undefined,context),after=profile(combined,undefined,context);
    assert.equal(isolated.items.length,expected?1:0);assert.equal(after.items.some(i=>i.revisionId===r.id),expected);
    if(expected){const item=after.items.find(i=>i.revisionId===r.id);assert.deepEqual(item.capacities,isolated.items[0].capacities);assert.deepEqual(item.specifications,isolated.items[0].specifications);}
    for(const old of before.items)assert.ok(after.items.some(i=>sha(i)===sha(old)),'Unrelated legacy item changed');
    assert.ok(after.items.every(i=>!i.automaticSelectionEligible));checks++;
  }
  const valid={...a.sourceVehicleScope,engineCode:a.matchedEngineScope[0],confirmedMarket:a.requiredMarket,productionMonth:a.window.intersection.from};
  assert.equal(profile([{...fixture(r),run:{...fixture(r).run,status:'PLANNED'}}],undefined,valid).items.length,0);
  assert.equal(profile([fixture(r)],undefined,{...valid,generation:'WRONG'}).items.length,0);
}
await writeFile(resolve(dir,tepee?'vin-priority-tepee-fluid-draft-v2.json':'vin-priority-fluid-drafts-v1.json'),JSON.stringify({kind:tepee?'VIN_PRIORITY_TEPEE_SCOPED_FLUID_DRAFT':'VIN_PRIORITY_FIVE_SCOPED_FLUID_DRAFTS',planHash:sha(planRaw),rematchHash:sha(matchRaw),liveHash:sha(liveRaw),summary:{drafts:drafts.length,checks,variantKeys:new Set(drafts.map(r=>r.vehicleVariantKey)).size},newRevisions:drafts,
  productionApplyAllowed:false,limitations:['Standalone draft candidates, not merged or published/OEM verified.','Joint source engine/month/market profile proof with saved legacy and sibling drafts, not real VIN proof.','Original specification and interval wording retained as unverified secondary source.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({drafts:drafts.length,checks}));
