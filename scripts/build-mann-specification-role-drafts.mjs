import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-market-month-scoped-preview-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),auditRaw=await readFile(resolve(dir,'specification-attribution-v2.json'),'utf8');
const plan=JSON.parse(planRaw),audit=JSON.parse(auditRaw);
assert.equal(audit.planHash,sha(planRaw));
for(const [file,hash]of Object.entries(audit.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(audit.sourceHash,sha(sql));
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseSpecifications}=await jiti.import('../src/lib/fluid-catalog.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts');
const drafts=[],held=[];let runtimeCases=0,visibleCases=0;
const grades=text=>[...new Set([...text.matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map(m=>m[0].toUpperCase()))];
const asRow=r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,transmissionModelListPolicy:r.provenanceJson.explicitTransmissionModelList?.policy,automaticProductSelection:false}}});
for(const f of audit.findings.filter(f=>f.analogOnly?.length&&f.candidateRevisionIds.length)){
 const source=sources.get(f.sourceRequirementId);assert.deepEqual(source,f.originalSource);assert.equal(sha(source),f.sourceHash);
 assert.equal(f.sections.status,'EXPLICIT_ANALOG_SEPARATED');
 const main=f.sections.main.text.trim();
 if(!main||f.mainCautions.length||f.unexplained.length){held.push({sourceRequirementId:source.id,candidateRevisionIds:f.candidateRevisionIds,reason:'MAIN_SOURCE_REQUIRES_SEMANTIC_REVIEW'});continue;}
 for(const id of f.candidateRevisionIds){
  const old=plan.newRevisions.find(r=>r.id===id);assert.ok(old);assert.equal(old.sourceRequirementId,source.id);
  assert.equal(old.applyEligible,false);assert.equal(old.verificationStatus,'UNVERIFIED');
  assert.equal(old.technicalDataJson.specificationText,source.specificationText);
  const r=structuredClone(old),mainGrades=grades(main);
  // Preserve unrecognized main product names; never label them OEM-approved.
  r.technicalDataJson.specificationText=main;
  r.technicalDataJson.specifications=[{type:'SOURCE_REQUIREMENT_TEXT',value:main},...parseSpecifications(main,mainGrades).filter(s=>s.type!=='RAW')];
  r.technicalDataJson.viscosityGrades=mainGrades;
  r.technicalDataJson.sourceSpecificationAttribution={policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:source.specificationText,
   mainSourceText:main,unverifiedAnalogText:f.sections.analog.text.trim(),metadataAndCautionText:f.sections.suffix.text.trim(),
   originalSourceHash:f.sourceHash,sourceRequirementId:source.id,oemVerified:false,automaticAnalogSelectionAllowed:false};
  r.provenanceJson.specificationRoleRepair={policy:'EXPLICIT_SOURCE_ROLES_V1',auditHash:sha(auditRaw),originalRevisionId:old.id,originalRevisionHash:sha(old),originalSourceHash:f.sourceHash,publicationAllowed:false};
  const policy=r.provenanceJson.catalogPreviewPolicy??r.provenanceJson.conditionalTransmissionPolicy??r.provenanceJson.conditionalEquipmentPolicy;
  assert.ok(['MANN_CONDITIONAL_CAPACITY_PREVIEW_V1','MANN_ENGINE_DATE_SCOPED_PREVIEW_V1','USER_CONFIRMED_TRANSMISSION_V1','USER_CONFIRMED_EQUIPMENT_V1'].includes(policy),policy);
  const hash=policy==='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1'?sha({key:`${r.sourceRequirementId}:${r.vehicleVariantKey}`,policy,applicabilityJson:r.applicabilityJson,technicalDataJson:r.technicalDataJson}):policy==='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1'?sha({policy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technicalData:r.technicalDataJson}):sha({policy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicabilityJson:r.applicabilityJson,technicalDataJson:r.technicalDataJson});
  r.semanticFingerprint=hash;r.id=`mtar_${hash.slice(0,24)}`;
  const restored=structuredClone(r.technicalDataJson);
  for(const k of ['specificationText','specifications','viscosityGrades'])restored[k]=old.technicalDataJson[k];
  delete restored.sourceSpecificationAttribution;assert.deepEqual(restored,old.technicalDataJson);
  assert.deepEqual(r.applicabilityJson,old.applicabilityJson);
  for(const k of Object.keys(old).filter(k=>!['id','semanticFingerprint','technicalDataJson','provenanceJson'].includes(k)))assert.deepEqual(r[k],old[k]);
  let seen=0;
  const scopes=r.technicalDataJson.capacityBranches?.map(b=>b.applicabilityJson)??[r.applicabilityJson];
  for(const s of scopes){
   const m=component(r.componentModel),{systemCode,...equipment}=r.applicabilityJson.requiredEquipment??{};
   const base={...s.sourceVehicleScope,engineCode:s.matchedEngineScope?.[0],productionMonth:s.window?.intersection?.from??s.window?.intersection?.to,confirmedMarket:s.requiredMarket,transmissionModel:m.kind==='model'?m.model:r.provenanceJson.explicitTransmissionModelList?.models?.[0],transmissionGearCount:s.transmissionGearCount,confirmedEquipment:systemCode?[equipment]:undefined};
   for(const type of [undefined,'manual','automatic','cvt','robot'])for(const market of [undefined,'RU','JP','US','KR','AE','EU','SOUTHEAST_ASIA','DE'])for(const wrongEngine of [false,true]){
    const context={...base,confirmedMarket:market,engineCode:wrongEngine?'WRONG_ENGINE':base.engineCode};
    const before=profile([asRow(old)],type,context),after=profile([asRow(r)],type,context);runtimeCases++;
    assert.equal(after.items.length,before.items.length,old.id);
    if(!before.items.length)continue;
    seen++;visibleCases++;
    assert.equal(after.items.length,1);
    assert.ok(after.items[0].specifications.includes(main),`${old.id}: main source lost`);
    assert.deepEqual(after.items[0].viscosityGrades,mainGrades);
    const strip=item=>{const {revisionId,specifications,viscosityGrades,...rest}=item;return rest;};
    assert.deepEqual(strip(after.items[0]),strip(before.items[0]));
   }
  }
  assert.ok(seen>0,`${old.id}: no positive runtime case`);
  drafts.push({originalRevisionId:old.id,originalRevisionHash:sha(old),originalSource:source,sourceHash:f.sourceHash,revision:r,runtimeVisibleCases:seen,publicationAllowed:false});
 }
}
assert.equal(drafts.length+held.reduce((n,h)=>n+h.candidateRevisionIds.length,0),142);
assert.equal(new Set(drafts.map(d=>d.revision.id)).size,drafts.length);
const summary={drafts:drafts.length,heldSources:held.length,runtimeCases,visibleCases,productionApplyAllowed:false};
const codeHashes=Object.fromEntries(await Promise.all(['src/lib/mann-unified-technical-profile.ts','src/lib/fluid-catalog.ts','scripts/build-mann-specification-role-drafts.mjs'].map(async file=>[file,sha(await readFile(resolve(root,file),'utf8'))])));
await writeFile(resolve(dir,'specification-role-drafts-v1.json'),JSON.stringify({planHash:sha(planRaw),auditHash:sha(auditRaw),sourceHash:sha(sql),codeHashes,summary,drafts,held,productionApplyAllowed:false,limitations:['Drafts only; canonical unchanged.','No OEM technical validation; original pending review obligations remain.','Runtime matrix checks scopes at a selected in-scope boundary, not every month or combined profiles.','Independent semantic/source audit and merge history/action remapping required before canonical replacement.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
