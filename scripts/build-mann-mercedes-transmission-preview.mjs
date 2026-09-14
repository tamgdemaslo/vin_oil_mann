import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {gearboxSourceQuality} from './lib/mann-gearbox-source-quality.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--lists'));
const lists=process.argv[2]==='--lists',considered=lists?3:19;
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,lists?'outputs/mann-mercedes-transmission-preview-2026-09-14':'outputs/mann-mercedes-equipment-preview-2026-09-14');
const [auditRaw,sourceRaw,mannRaw,planRaw]=await Promise.all([readFile(resolve(dir,lists?'mercedes-transmission-list-recheck-v1.json':'mercedes-bulk-transmission-recheck-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const audit=JSON.parse(auditRaw),plan=JSON.parse(planRaw);assert.equal(audit.planHash,sha(planRaw));assert.equal(audit.sourceHash,sha(sourceRaw));assert.equal(audit.mannHash,sha(mannRaw));
if(lists)for(const [file,hash] of Object.entries(audit.supportingCodeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
for(const [field,file] of [['matcherHash','mann-fluid-matcher-v2.ts'],['resolverHash','mann-vehicle-resolver.ts'],['targetParserHash','mann-engine-code-list.ts'],['componentParserHash','mann-transmission-component.ts'],['labelParserHash','fluid-source-system-context.ts']])assert.equal(audit[field],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts');
const {explicitMannTransmissionModels:parseList}=await jiti.import('../src/lib/mann-transmission-model-list.ts');
const {extractFluidSourceSystemContext:extract}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const sourceQuality=gearboxSourceQuality([...overlay.originalById.values()],component,extract);
const policy='USER_CONFIRMED_TRANSMISSION_V1',revisions=[],review=[],pending=[];let checks=0;
const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
for(const entry of audit.results.filter(r=>r.status==='TRANSMISSION_SCOPED_CANDIDATE')){
 const original=overlay.originalById.get(entry.sourceRequirementId),source=sources.get(original.id);assert.equal(sha(original),entry.sourceHash);
 assert.deepEqual(extract(source.systemNameRaw,source.componentModel),entry.metadata);assert.deepEqual(component(source.componentModel),entry.component);assert.equal(entry.component.kind,lists?'conditions':'model');
 if(lists){assert.deepEqual(parseList(original.componentModel),entry.explicitModels);assert.ok(entry.explicitModels?.length>1);assert.equal(source.componentModel,original.componentModel);}
 const reasons=[],target=variants.get(entry.vehicleVariantKey);assert.ok(target?.length);
 if(sourceQuality.heldBySource.has(original.id))reasons.push('SOURCE_MODEL_GEAR_COUNT_CONFLICT');
 if(target.some(r=>String(r.hp??'').trim()!==String(entry.sourceEngineContext.powerHp)))reasons.push('TARGET_POWER_NOT_EXACT_SINGLE_VALUE');
 if(source.driveType)reasons.push('SOURCE_DRIVE_REQUIRES_RECONCILIATION');
 const capacity=parse(original.fillVolumeText,original.systemCode);assert.equal(capacity.needsReview,false);assert.ok(capacity.capacities.length);
 assert.equal(originalAssociationFingerprint(entry.vehicleVariantKey,original,capacity),entry.originalAssociationFingerprint);
 const old=live.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===entry.vehicleVariantKey);
 if(old.some(r=>r.reviewConfirmed||r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'))reasons.push('PROTECTED_PREDECESSOR');
 if(reasons.length){review.push({...entry,reasons});continue;}
 const applicabilityJson={sourceVehicleScope:{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})},matchedEngineScope:entry.matchedEngineScope,window:entry.window,
 transmissionType:source.transmissionType,componentModel:source.componentModel,transmissionGearCount:entry.metadata.transmissionGearCount};
 assert.ok(Number.isInteger(applicabilityJson.transmissionGearCount));
 const technicalDataJson={fillVolumeText:original.fillVolumeText,capacities:capacity.capacities,specifications:original.specificationsJson,viscosityGrades:original.viscosityGradesJson};
 for(const key of ['specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])technicalDataJson[key]=original[key];
 const semanticFingerprint=sha({policy,sourceRequirementId:source.id,vehicleVariantKey:entry.vehicleVariantKey,applicabilityJson,technicalDataJson});
 const revision={id:`mtar_${semanticFingerprint.slice(0,24)}`,semanticFingerprint,sourceRequirementId:source.id,vehicleVariantKey:entry.vehicleVariantKey,systemCode:source.systemCode,componentModel:source.componentModel,
 applicabilityJson,technicalDataJson,state:'REVIEW',verificationStatus:'UNVERIFIED',matchClass:'CONDITIONAL_TRANSMISSION',matchScore:entry.candidate.score,applyEligible:false,verifiedFieldsJson:[],replacesRevisionIds:old.map(r=>r.id),
 fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),
 evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:source.sourceUrl}],
 provenanceJson:{conditionalTransmissionPolicy:policy,conditionalTransmissionEligible:true,conditionalTransmissionChoiceRequired:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:entry.originalAssociationFingerprint,
 sourceRecheckHash:sha(auditRaw),sourceEngineScope:entry.sourceEngineContext,sourceEngineEvidence:entry.sourceEvidence,sourceTransmissionContext:entry.metadata,
 ...(lists?{explicitTransmissionModelList:{policy:'EXPLICIT_DECIMAL_MODEL_LIST_V1',sourceComponentModel:original.componentModel,models:entry.explicitModels}}:{}),
 independentValidation:{vehicleIdentityIndependentlyValidated:true,hardConflicts:[],reviewBlockers:entry.candidate.reviewBlockers,score:entry.candidate.score,matchedFields:entry.candidate.matchedFields}}};
 const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalTransmissionPolicy:policy,automaticProductSelection:false,...(lists?{transmissionModelListPolicy:'EXPLICIT_DECIMAL_MODEL_LIST_V1'}:{})}}};
 const correctModels=lists?entry.explicitModels:[entry.component.model],count=entry.metadata.transmissionGearCount,type=source.transmissionType,w=entry.window.intersection;assert.ok(w.from&&w.to);
 for(let n=index(w.from)-1;n<=index(w.to)+1;n++)for(const engineCode of [...entry.matchedEngineScope,'WRONG',undefined])for(const selectedType of [undefined,'automatic','manual','cvt','robot'])for(const transmissionModel of [...correctModels,'722.000',undefined,...(lists?[source.componentModel]:[])])for(const transmissionGearCount of [count,count+1,undefined]){
   const ctx={...applicabilityJson.sourceVehicleScope,engineCode,productionMonth:`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`,transmissionModel,transmissionGearCount};
   const items=profile([runtime],selectedType,ctx).items,expected=selectedType===type&&correctModels.includes(transmissionModel)&&transmissionGearCount===count&&entry.matchedEngineScope.includes(engineCode)&&n>=index(w.from)&&n<=index(w.to);
   assert.equal(items.length,expected?1:0);if(expected){assert.ok(items[0].capacities.length);assert.equal(items[0].automaticSelectionEligible,false);}checks++;
 }
 revisions.push(revision);pending.push({sourceRequirementId:source.id,sourceHash:sha(original),originalSource:original,sourceEngineContext:entry.sourceEngineContext,acceptedEngineScope:entry.matchedEngineScope,acceptedWindow:w,
 requiredTransmission:{type,...(lists?{models:correctModels}:{model:correctModels[0]}),gearCount:count},reason:'SOURCE_ENGINE_MONTH_PARTITION_PENDING',publicationAllowed:false});
}
assert.equal(revisions.length+review.length,considered);assert.equal(new Set(revisions.map(r=>r.id)).size,revisions.length);
const report={planHash:sha(planRaw),auditHash:sha(auditRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),liveHash:sha(liveRaw),matcherHash:audit.matcherHash,resolverHash:audit.resolverHash,targetParserHash:audit.targetParserHash,componentParserHash:audit.componentParserHash,labelParserHash:audit.labelParserHash,
 supportingCodeHashes:audit.supportingCodeHashes,
 applicabilityHash:sha(await readFile(resolve(root,'src/lib/mann-technical-applicability.ts'),'utf8')),profileHash:sha(await readFile(resolve(root,'src/lib/mann-unified-technical-profile.ts'),'utf8')),
 summary:{considered,revisions:revisions.length,review:review.length,checks},revisions,review,pending,productionApplyAllowed:false,
 limitation:'Unapplied gearbox drafts; exhaustive bounded month/type/model/count/engine test matrix, not OEM capacity/specification or VIN gearbox proof. Partition and joint merge still required.'};
await writeFile(resolve(dir,lists?'mercedes-transmission-list-preview-supplement-v1.json':'mercedes-transmission-preview-supplement-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
