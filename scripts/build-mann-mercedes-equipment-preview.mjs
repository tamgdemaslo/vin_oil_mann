import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-bulk-preview-2026-09-14');
const [auditRaw,sourceRaw,mannRaw,planRaw]=await Promise.all([readFile(resolve(dir,'mercedes-bulk-equipment-recheck-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const audit=JSON.parse(auditRaw),plan=JSON.parse(planRaw);assert.equal(audit.planHash,sha(planRaw));assert.equal(audit.sourceHash,sha(sourceRaw));assert.equal(audit.mannHash,sha(mannRaw));
for(const [field,file] of [['matcherHash','mann-fluid-matcher-v2.ts'],['resolverHash','mann-vehicle-resolver.ts'],['targetParserHash','mann-engine-code-list.ts'],['aggregateParserHash','fluid-aggregate-source-context.ts'],['equipmentScopeHash','mann-equipment-scope.ts']])assert.equal(audit[field],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {readMannEquipmentScope:readScope}=await jiti.import('../src/lib/mann-equipment-scope.ts');
const {extractFluidAggregateSourceContext:extract}=await jiti.import('../src/lib/fluid-aggregate-source-context.ts');
const policy='USER_CONFIRMED_EQUIPMENT_V1',revisions=[],review=[],pending=[];let checks=0;
const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
for(const entry of audit.results.filter(r=>r.status==='EQUIPMENT_SCOPED_CANDIDATE')){
 const original=overlay.originalById.get(entry.sourceRequirementId),source=sources.get(original.id);assert.equal(sha(original),entry.sourceHash);
 assert.deepEqual(extract(source.systemNameRaw,source.componentModel),entry.metadata);assert.ok(readScope(entry.requiredEquipment));
 const reasons=[];
 if(source.driveType)reasons.push('SOURCE_DRIVE_FIELD_NEEDS_RECONCILIATION');
 if(source.transmissionType&&source.transmissionType!==entry.requiredEquipment.attachedTransmissionType)reasons.push('SOURCE_TRANSMISSION_FIELD_NEEDS_RECONCILIATION');
 const target=variants.get(entry.vehicleVariantKey);assert.ok(target?.length);
 if(target.some(r=>String(r.hp??'').trim()!==String(entry.sourceEngineContext.powerHp)))reasons.push('TARGET_POWER_NOT_EXACT_SINGLE_VALUE');
 const capacity=parse(original.fillVolumeText,original.systemCode);assert.equal(capacity.needsReview,false);assert.ok(capacity.capacities.length);
 assert.equal(originalAssociationFingerprint(entry.vehicleVariantKey,original,capacity),entry.originalAssociationFingerprint);
 const old=live.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===entry.vehicleVariantKey);
 if(old.some(r=>r.reviewConfirmed||r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'))reasons.push('PROTECTED_PREDECESSOR');
 if(reasons.length){review.push({...entry,reasons});continue;}
 const applicabilityJson={sourceVehicleScope:{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})},matchedEngineScope:entry.matchedEngineScope,window:entry.window,requiredEquipment:entry.requiredEquipment};
 const technicalDataJson={fillVolumeText:original.fillVolumeText,capacities:capacity.capacities,specifications:original.specificationsJson,viscosityGrades:original.viscosityGradesJson};
 for(const key of ['specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])technicalDataJson[key]=original[key];
 const semanticFingerprint=sha({policy,sourceRequirementId:source.id,vehicleVariantKey:entry.vehicleVariantKey,applicabilityJson,technicalDataJson});
 const revision={id:`mtar_${semanticFingerprint.slice(0,24)}`,semanticFingerprint,sourceRequirementId:source.id,vehicleVariantKey:entry.vehicleVariantKey,systemCode:source.systemCode,componentModel:source.componentModel,
 applicabilityJson,technicalDataJson,state:'REVIEW',verificationStatus:'UNVERIFIED',matchClass:'CONDITIONAL_EQUIPMENT',matchScore:entry.candidate.score,applyEligible:false,verifiedFieldsJson:[],replacesRevisionIds:old.map(r=>r.id),
 fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),
 evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:source.sourceUrl}],
 provenanceJson:{conditionalEquipmentPolicy:policy,conditionalEquipmentEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:entry.originalAssociationFingerprint,
 sourceRecheckHash:sha(auditRaw),sourceEngineScope:entry.sourceEngineContext,sourceEngineEvidence:entry.sourceEvidence,sourceAggregateContext:entry.metadata,
 independentValidation:{vehicleIdentityIndependentlyValidated:true,hardConflicts:[],reviewBlockers:entry.candidate.reviewBlockers,score:entry.candidate.score,matchedFields:entry.candidate.matchedFields}}};
 const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalEquipmentPolicy:policy,automaticProductSelection:false}}};
 const {systemCode,...correct}=entry.requiredEquipment;
 const confirmations=[{value:undefined,pass:false},{value:[],pass:false},{value:[correct],pass:true},{value:[correct,correct],pass:false},{value:[{circuit:correct.circuit==='HYDRAULIC_STEERING'?'REAR_DIFFERENTIAL':'HYDRAULIC_STEERING'}],pass:false}];
 if(correct.drive){const {drive,...withoutDrive}=correct;confirmations.push({value:[withoutDrive],pass:false},{value:[{...correct,drive:drive==='2WD'?'4WD':'2WD'}],pass:false});}
 if(correct.attachedTransmissionType){const {attachedTransmissionType,...withoutTransmission}=correct;confirmations.push({value:[withoutTransmission],pass:false});}
 const w=entry.window.intersection;assert.ok(w.from&&w.to);
 for(let n=index(w.from)-1;n<=index(w.to)+1;n++)for(const engineCode of [...entry.matchedEngineScope,'WRONG',undefined])for(const confirmation of confirmations){
   const ctx={...applicabilityJson.sourceVehicleScope,engineCode,productionMonth:`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`,confirmedEquipment:confirmation.value};
   const items=profile([runtime],undefined,ctx).items,expected=confirmation.pass&&entry.matchedEngineScope.includes(engineCode)&&n>=index(w.from)&&n<=index(w.to);
   assert.equal(items.length,expected?1:0);if(expected){assert.ok(items[0].capacities.length);assert.equal(items[0].automaticSelectionEligible,false);}checks++;
 }
 revisions.push(revision);pending.push({sourceRequirementId:source.id,sourceHash:sha(original),originalSource:original,sourceEngineContext:entry.sourceEngineContext,acceptedEngineScope:entry.matchedEngineScope,acceptedWindow:w,requiredEquipment:entry.requiredEquipment,reason:'SOURCE_ENGINE_MONTH_PARTITION_PENDING',publicationAllowed:false});
}
assert.equal(revisions.length+review.length,33);assert.equal(new Set(revisions.map(r=>r.id)).size,revisions.length);
const report={planHash:sha(planRaw),auditHash:sha(auditRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),liveHash:sha(liveRaw),
 matcherHash:audit.matcherHash,resolverHash:audit.resolverHash,targetParserHash:audit.targetParserHash,equipmentScopeHash:audit.equipmentScopeHash,
 applicabilityHash:sha(await readFile(resolve(root,'src/lib/mann-technical-applicability.ts'),'utf8')),profileHash:sha(await readFile(resolve(root,'src/lib/mann-unified-technical-profile.ts'),'utf8')),
 summary:{considered:33,revisions:revisions.length,review:review.length,checks},revisions,review,pending,productionApplyAllowed:false,
 limitation:'Unapplied conditional equipment revisions. Actual profile month/engine/equipment matrix, not OEM fluid truth or VIN equipment proof. Source partitions, joint composition and predecessor reconciliation required.'};
await writeFile(resolve(dir,'mercedes-equipment-preview-supplement-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
