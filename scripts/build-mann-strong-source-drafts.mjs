import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {subtractMonths} from './lib/mann-month-intervals.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14');
const [raw,proofRaw,summaryRaw,sql]=await Promise.all(['strong-source-conditions-v1.json','strong-source-preflight-verification-v1.json','summary.json'].map(f=>readFile(resolve(dir,f),'utf8')).concat(readFile('/tmp/vehicle_fluid_requirements.sql','utf8')));
const preflight=JSON.parse(raw),proof=JSON.parse(proofRaw),summary=JSON.parse(summaryRaw);assert.equal(proof.reportHash,sha(raw));assert.equal(preflight.sourceHash,sha(sql));
for(const [file,hash]of Object.entries({...summary.codeHashes,...proof.codeHashes}))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const planRaw=await readFile(summary.planPath,'utf8');assert.equal(sha(planRaw),preflight.planHash);const plan=JSON.parse(planRaw);
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
const overlay=await loadIdentityOverlay(root,sql,summary.identityOverlay.path,summary.identityOverlay.sha256),sources=new Map(overlay.requirements.map(s=>[s.id,s]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{extractFluidAggregateSourceContext:aggregate}=await jiti.import('../src/lib/fluid-aggregate-source-context.ts'),{readMannEquipmentScope}=await jiti.import('../src/lib/mann-equipment-scope.ts'),{buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts'),{parseSpecifications}=await jiti.import('../src/lib/fluid-catalog.ts');
const transmission={AUTOMATIC_TRANSMISSION:'automatic',MANUAL_TRANSMISSION:'manual',CVT_TRANSMISSION:'cvt',ROBOT_TRANSMISSION:'robot'},core=new Set(['ENGINE_OIL','ENGINE_COOLANT','BRAKE_FLUID','INVERTER_COOLANT','INTERCOOLER_COOLANT']);
const drafts=[],reviews=[];let cases=0;
for(const f of preflight.findings.filter(f=>!f.reasons.length)){
 const s=sources.get(f.sourceRequirementId),candidate=f.clippedDecision.topCandidates[0],reasons=[],metadata=aggregate(s.systemNameRaw,s.componentModel),system=f.sourceSystemContext;
 assert.equal(sha(overlay.originalById.get(s.id)),f.sourceHash);
 const prior=live.filter(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===f.targetId);
 if(prior.some(r=>r.reviewConfirmed||r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'))reasons.push('PROTECTED_LIVE_REVISION');
 if(plan.newRevisions.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===f.targetId))reasons.push('ALREADY_HAS_CANONICAL_CANDIDATE');
 let policy,matchClass,provenance,extra={};
 const validation={score:candidate.score,matchedFields:candidate.matchedFields,hardConflicts:[],reviewBlockers:candidate.reviewBlockers};
 if(core.has(s.systemCode)){
  policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1';matchClass='CONFIRMED_SINGLE';
  if(candidate.reviewBlockers.length||!candidate.eligible)reasons.push('CORE_NOT_INDEPENDENTLY_ELIGIBLE');
  if(s.driveType||s.transmissionType||! /^(?:-|—)?$/.test(s.componentModel??''))reasons.push('CORE_EXTRA_SOURCE_CONDITIONS');
  provenance={catalogPreviewPolicy:policy,catalogPreviewEligible:true,independentValidation:{...validation,independentlyValidated:true}};
 }else if(transmission[s.systemCode]){
  policy='USER_CONFIRMED_TRANSMISSION_V1';matchClass='CONDITIONAL_TRANSMISSION';
  if(!['type','model'].includes(f.component.kind))reasons.push('TRANSMISSION_QUALIFIED_MODEL_NOT_SUPPORTED');
  if(system.issues.length||system.hasAdditionalLabelConditions||system.destinationSystemCode!==s.systemCode||system.transmissionType!==transmission[s.systemCode])reasons.push('TRANSMISSION_LABEL_UNRESOLVED');
  if(s.driveType||(s.transmissionType&&s.transmissionType!==system.transmissionType))reasons.push('TRANSMISSION_SOURCE_FIELDS_UNRESOLVED');
  if(JSON.stringify(candidate.reviewBlockers)!==JSON.stringify(['MANN variant не подтверждает тип или модель коробки']))reasons.push('TRANSMISSION_REVIEW_BLOCKERS');
  extra={transmissionType:system.transmissionType,componentModel:s.componentModel,...(system.transmissionGearCount?{transmissionGearCount:system.transmissionGearCount}:{})};
  provenance={conditionalTransmissionPolicy:policy,conditionalTransmissionEligible:true,conditionalTransmissionChoiceRequired:true,sourceTransmissionContext:system,independentValidation:{...validation,vehicleIdentityIndependentlyValidated:true}};
 }else{
  policy='USER_CONFIRMED_EQUIPMENT_V1';matchClass='CONDITIONAL_EQUIPMENT';
  if(metadata.issues.length||metadata.fluidRequired!==true||metadata.systemCode!==s.systemCode)reasons.push('EQUIPMENT_MODEL_OR_LABEL_UNSUPPORTED');
  if(s.driveType||(s.transmissionType&&s.transmissionType!==metadata.attachedTransmissionType))reasons.push('EQUIPMENT_SOURCE_FIELDS_UNRESOLVED');
  const requiredEquipment={systemCode:s.systemCode,circuit:metadata.circuit,...(metadata.requiredDrive?{drive:metadata.requiredDrive}:{}),...(metadata.attachedTransmissionType?{attachedTransmissionType:metadata.attachedTransmissionType}:{})};
  if(!readMannEquipmentScope(requiredEquipment))reasons.push('EQUIPMENT_SCOPE_NOT_SUPPORTED');
  const blocker=s.systemCode==='POWER_STEERING'?'MANN variant не подтверждает наличие этой гидравлической системы':'MANN variant не подтверждает привод или модель агрегата';
  if(candidate.reviewBlockers.some(b=>b!==blocker))reasons.push('EQUIPMENT_REVIEW_BLOCKERS');
  extra={requiredEquipment};provenance={conditionalEquipmentPolicy:policy,conditionalEquipmentEligible:true,sourceAggregateContext:metadata,independentValidation:{...validation,vehicleIdentityIndependentlyValidated:true}};
 }
 if(reasons.length){reviews.push({sourceRequirementId:s.id,originalSource:f.originalSource,targetId:f.targetId,reasons,component:f.component,metadata,publicationAllowed:false});continue;}
 const applicabilityJson={sourceVehicleScope:{make:s.make,model:s.model,...(s.generation?{generation:s.generation}:{})},matchedEngineScope:f.engineCodes,window:f.window,...extra};
 const technicalDataJson={fillVolumeText:s.fillVolumeText,capacities:f.parsedCapacity.capacities,specificationText:s.specificationText,specifications:s.specificationsJson,viscosityGrades:s.viscosityGradesJson,...Object.fromEntries(['recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'].map(k=>[k,s[k]]))};
 if(f.specificationSections.status==='EXPLICIT_ANALOG_SEPARATED'){
  const sections=f.specificationSections,main=sections.main.text.trim();if(!main){reviews.push({sourceRequirementId:s.id,originalSource:f.originalSource,targetId:f.targetId,reasons:['EMPTY_MAIN_SPECIFICATION'],publicationAllowed:false});continue;}
  const grades=[...new Set([...main.matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map(m=>m[0].toUpperCase()))];
  technicalDataJson.specificationText=main;technicalDataJson.specifications=[{type:'SOURCE_REQUIREMENT_TEXT',value:main},...parseSpecifications(main,grades).filter(s=>s.type!=='RAW')];technicalDataJson.viscosityGrades=grades;
  technicalDataJson.sourceSpecificationAttribution={policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:s.specificationText,mainSourceText:main,unverifiedAnalogText:sections.analog.text.trim(),metadataAndCautionText:sections.suffix.text.trim(),originalSourceHash:f.sourceHash,sourceRequirementId:s.id,oemVerified:false,automaticAnalogSelectionAllowed:false};
 }
 const fingerprint=policy==='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1'?sha({policy,sourceRequirementId:s.id,vehicleVariantKey:f.targetId,applicability:applicabilityJson,technicalData:technicalDataJson}):sha({policy,sourceRequirementId:s.id,vehicleVariantKey:f.targetId,applicabilityJson,technicalDataJson});
 const r={id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,sourceRequirementId:s.id,vehicleVariantKey:f.targetId,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson,technicalDataJson,state:core.has(s.systemCode)?'STAGED':'REVIEW',verificationStatus:'UNVERIFIED',matchClass,matchScore:candidate.score,applyEligible:false,verifiedFieldsJson:[],replacesRevisionIds:prior.map(r=>r.id),fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:s.sourceUrl}],provenanceJson:{...provenance,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:f.originalAssociationFingerprint,sourceRecheckHash:sha(raw),identityCorrectionHash:overlay.metadata.sha256}};
 const row={...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:provenance.catalogPreviewPolicy,conditionalTransmissionPolicy:provenance.conditionalTransmissionPolicy,conditionalEquipmentPolicy:provenance.conditionalEquipmentPolicy,automaticProductSelection:false}}};
 const {systemCode,...equipment}=extra.requiredEquipment??{},context={...applicabilityJson.sourceVehicleScope,engineCode:f.engineCodes[0],productionMonth:f.window.intersection.from??f.window.intersection.to,transmissionModel:f.component.kind==='model'?f.component.model:undefined,transmissionGearCount:system.transmissionGearCount??undefined,confirmedEquipment:systemCode?[equipment]:undefined};
 let positive=0;for(const type of [undefined,'automatic','manual','cvt','robot']){
  positive+=profile([row],type,context).items.length;cases++;
  for(const engineCode of [undefined,'WRONG_ENGINE']){assert.equal(profile([row],type,{...context,engineCode}).items.length,0);cases++;}
 }
 assert.ok(positive,`No positive runtime case ${s.id}`);
 drafts.push({revision:r,originalSource:f.originalSource,sourceHash:f.sourceHash,preflightSourceId:s.id,pendingWindows:subtractMonths(f.window.source,[f.window.intersection]),publicationAllowed:false});
}
assert.equal(drafts.length+reviews.length,75);
const report={planHash:sha(planRaw),preflightHash:sha(raw),proofHash:sha(proofRaw),liveHash:sha(liveRaw),checked:75,drafts: drafts.length,reviews:reviews.length,runtimeChecks:cases,revisionDrafts:drafts,reviewEntries:reviews,productionApplyAllowed:false,limitation:'Unverified drafts only. Independent full source preservation, negative aggregate/gearbox/date tests and residual verification required before merge. No production or OEM verification.'};
await writeFile(resolve(dir,'strong-source-drafts-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,revisionDrafts:undefined,reviewEntries:undefined}));
