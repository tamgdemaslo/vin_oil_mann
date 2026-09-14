import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {gearboxSourceQuality} from './lib/mann-gearbox-source-quality.mjs';
import {nissanXtrailEngineBranches} from './lib/mann-nissan-xtrail-engine-branches.mjs';
assert.equal(process.argv.length,2);
const lists=true,considered=2;
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-nissan-xtrail-manual-preview-2026-09-14');
const [auditRaw,sourceRaw,mannRaw,planRaw]=await Promise.all([readFile(resolve(dir,'nissan-cvt-model-list-recheck-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const audit=JSON.parse(auditRaw),plan=JSON.parse(planRaw);assert.equal(audit.planHash,sha(planRaw));assert.equal(audit.sourceHash,sha(sourceRaw));assert.equal(audit.mannHash,sha(mannRaw));
for(const [file,hash] of Object.entries(audit.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
assert.equal(audit.rawHash,sha(await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')));
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts');
const {explicitMannCvtModels:parseList}=await jiti.import('../src/lib/mann-transmission-model-list.ts');
const {extractFluidSourceSystemContext:extract}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const forms=new Set(mannMakeFormsForTest('NISSAN')),mannRows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
const sourceQuality=gearboxSourceQuality([...overlay.originalById.values()],component,extract);
const policy='USER_CONFIRMED_TRANSMISSION_V1',revisions=[],review=[],pending=[];let checks=0;
const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
const selected=audit.candidates;assert.equal(selected.length,2);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
for(const found of selected){
 const item=audit.results.find(r=>r.sourceRequirementId===found.sourceRequirementId);assert.equal(item.rawEngineAnchors.length,1);const anchor=item.rawEngineAnchors[0],src=sources.get(found.sourceRequirementId);
 let sourceEngineBranches=nissanXtrailEngineBranches(anchor.model);
 if(!sourceEngineBranches){assert.equal(anchor.model,'- QR25DE / 171 л.с.');const years=/^([0-9]{4}) *- *([0-9]{4})$/.exec(anchor.production_years);assert.ok(years);sourceEngineBranches=[{engineCode:'QR25DE',powerHp:171,hybrid:false,yearFrom:+years[1],yearTo:+years[2],sourcePhrase:anchor.model}];}
 const engine=sourceEngineBranches.find(e=>!e.hybrid);assert.equal(engine.yearFrom,src.yearFrom);assert.equal(engine.yearTo,src.yearTo);assert.equal(engine.powerHp,src.powerHp);
 const decision=match({...src,engineCodeNormalized:engine.engineCode,engineCodesJson:[engine.engineCode],powerHp:engine.powerHp,...found.window.narrowedYears},mannRows);
 const finding={...item,...found,decision,engine,sourceEngineBranches,sourceLabelContext:item.metadata,systemCode:src.systemCode};
 const candidate=finding.decision.topCandidates[0];assert.equal(candidate.variantIds.length,1);assert.equal(candidate.score,100);assert.deepEqual(candidate.hardConflicts,[]);assert.deepEqual(candidate.reviewBlockers,['MANN variant не подтверждает тип или модель коробки']);assert.ok(candidate.matchedFields.includes('точный код двигателя'));
 assert.ok(!finding.decision.topCandidates.slice(1).some(c=>!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=candidate.score-10));
 assert.deepEqual(candidate.variantIds,[found.vehicleVariantKey]);assert.equal(finding.engine.hybrid,false);
 assert.deepEqual(finding.sourceLabelContext.issues,[]);assert.equal(finding.sourceLabelContext.hasAdditionalLabelConditions,false);
 const entry={...finding,metadata:finding.sourceLabelContext,vehicleVariantKey:candidate.variantIds[0],matchedEngineScope:[finding.engine.engineCode],sourceEngineContext:finding.engine,sourceEngineBranches,component:component(src.componentModel),explicitModels:parseList(src.componentModel),sourceEvidence:{rowId:anchor.row_id,rowHash:sha(anchor),originalRow:anchor},candidate};
 entry.originalAssociationFingerprint=originalAssociationFingerprint(entry.vehicleVariantKey,overlay.originalById.get(entry.sourceRequirementId),parse(finding.originalSource.fillVolumeText,finding.systemCode));
 assert.ok(!denied.has(entry.originalAssociationFingerprint));
 assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===entry.sourceRequirementId&&r.vehicleVariantKey===entry.vehicleVariantKey));
 const original=overlay.originalById.get(entry.sourceRequirementId),source=sources.get(original.id);assert.equal(sha(original),entry.sourceHash);assert.notEqual(source.rawRequirementJson?.sourceIdentity?.reviewRequired,true);assert.equal(source.transmissionType,'cvt');assert.equal(entry.metadata.transmissionType,source.transmissionType);assert.equal(entry.metadata.transmissionGearCount,null);
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
 transmissionType:source.transmissionType,componentModel:source.componentModel};
 const technicalDataJson={fillVolumeText:original.fillVolumeText,capacities:capacity.capacities,specifications:original.specificationsJson,viscosityGrades:original.viscosityGradesJson};
 for(const key of ['specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])technicalDataJson[key]=original[key];
 const semanticFingerprint=sha({policy,sourceRequirementId:source.id,vehicleVariantKey:entry.vehicleVariantKey,applicabilityJson,technicalDataJson});
 const revision={id:`mtar_${semanticFingerprint.slice(0,24)}`,semanticFingerprint,sourceRequirementId:source.id,vehicleVariantKey:entry.vehicleVariantKey,systemCode:source.systemCode,componentModel:source.componentModel,
 applicabilityJson,technicalDataJson,state:'REVIEW',verificationStatus:'UNVERIFIED',matchClass:'CONDITIONAL_TRANSMISSION',matchScore:entry.candidate.score,applyEligible:false,verifiedFieldsJson:[],replacesRevisionIds:old.map(r=>r.id),
 fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),
 evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:source.sourceUrl}],
 provenanceJson:{conditionalTransmissionPolicy:policy,conditionalTransmissionEligible:true,conditionalTransmissionChoiceRequired:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:entry.originalAssociationFingerprint,
 sourceRecheckHash:sha(auditRaw),sourceEngineScope:entry.sourceEngineContext,sourceEngineBranches,sourceEngineEvidence:entry.sourceEvidence,sourceTransmissionContext:entry.metadata,
 ...(lists?{explicitTransmissionModelList:{policy:'EXPLICIT_CVT_SOURCE_MODEL_LIST_V1',sourceComponentModel:original.componentModel,models:entry.explicitModels}}:{}),
 independentValidation:{vehicleIdentityIndependentlyValidated:true,hardConflicts:[],reviewBlockers:entry.candidate.reviewBlockers,score:entry.candidate.score,matchedFields:entry.candidate.matchedFields}}};
 const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalTransmissionPolicy:policy,automaticProductSelection:false,...(lists?{transmissionModelListPolicy:'EXPLICIT_CVT_SOURCE_MODEL_LIST_V1'}:{})}}};
 const correctModels=lists?entry.explicitModels:[entry.component.model],count=entry.metadata.transmissionGearCount,type=source.transmissionType,w=entry.window.intersection;assert.ok(w.from&&w.to);
 for(let n=entry.sourceEngineContext.yearFrom*12-1;n<=(entry.sourceEngineContext.yearTo+1)*12;n++)for(const engineCode of [...entry.matchedEngineScope,'MR20-RM31','WRONG',undefined])for(const selectedType of [undefined,'automatic','manual','cvt','robot'])for(const transmissionModel of [...correctModels,'722.000','JF016E',undefined,...(lists?[source.componentModel]:[])])for(const transmissionGearCount of [undefined,6]){
   const ctx={...applicabilityJson.sourceVehicleScope,engineCode,productionMonth:`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`,transmissionModel,transmissionGearCount};
   const items=profile([runtime],selectedType,ctx).items,expected=selectedType===type&&correctModels.includes(transmissionModel)&&entry.matchedEngineScope.includes(engineCode)&&n>=index(w.from)&&n<=index(w.to);
   assert.equal(items.length,expected?1:0);if(expected){assert.equal(items[0].capacities.length,1);assert.equal(items[0].capacities[0].nominalLiters,7.5);assert.equal(items[0].automaticSelectionEligible,false);}checks++;
 }
 revisions.push(revision);
 const month=n=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;
 for(const e of sourceEngineBranches){
  let start=null;
  for(let n=e.yearFrom*12;n<=(e.yearTo+1)*12;n++){
   const end=n===(e.yearTo+1)*12,visible=!end&&!e.hybrid&&n>=index(w.from)&&n<=index(w.to);
   if(!end&&!visible&&start===null)start=n;
   if((end||visible)&&start!==null){pending.push({sourceRequirementId:source.id,sourceHash:sha(original),originalSource:original,sourceEngineBranch:e,window:{from:month(start),to:month(n-1)},requiredTransmission:{type,models:correctModels},reason:e.hybrid?'HYBRID_ENGINE_NOT_MATCHED':'UNCOVERED_ENGINE_TRANSMISSION_MONTHS',publicationAllowed:false});start=null;}
  }
 }

}
assert.equal(revisions.length+review.length,considered);assert.equal(new Set(revisions.map(r=>r.id)).size,revisions.length);
const files=['scripts/build-mann-nissan-xtrail-cvt-list-preview.mjs','scripts/lib/mann-nissan-xtrail-engine-branches.mjs','scripts/lib/mann-gearbox-source-quality.mjs','src/lib/mann-technical-applicability.ts','src/lib/mann-unified-technical-profile.ts','src/lib/fluid-capacity-parser.ts'];
const report={planHash:sha(planRaw),auditHash:sha(auditRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),liveHash:sha(liveRaw),rawHash:audit.rawHash,
 codeHashes:{...audit.codeHashes,...Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))])))},
 summary:{considered,revisions:revisions.length,review:review.length,checks},revisions,review,pending,productionApplyAllowed:false,
 limitation:'Unapplied gearbox drafts; exhaustive bounded month/type/model/count/engine test matrix, not OEM capacity/specification or VIN gearbox proof. Partition and joint merge still required.'};
await writeFile(resolve(dir,'nissan-xtrail-cvt-list-preview-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
