import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {conditionalVehicleIdentityReasons} from './lib/mann-conditional-vehicle-identity.mjs';
import {subtractMonths,intersectMonths} from './lib/mann-month-intervals.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&['equipment','drive','years','years-exact-power'].includes(process.argv[2])));
const yearPowerMode=process.argv[2]==='years-exact-power',yearMode=yearPowerMode||process.argv[2]==='years',driveMode=process.argv[2]==='drive',equipmentMode=driveMode||process.argv[2]==='equipment';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14'),parentPath=resolve(root,yearMode?'outputs/mann-equipment-drive-added-preview-2026-09-14/plan.json':driveMode?'outputs/mann-equipment-model-added-preview-2026-09-14/plan.json':equipmentMode?'outputs/mann-alphanumeric-box-added-preview-2026-09-14/plan.json':'outputs/mann-strong-source-added-preview-2026-09-14/plan.json');
const [parentRaw,reviewRaw,preRaw,summaryRaw,sql,mannRaw]=await Promise.all([readFile(parentPath,'utf8'),readFile(resolve(dir,'strong-source-drafts-v1.json'),'utf8'),readFile(resolve(dir,'strong-source-conditions-v1.json'),'utf8'),readFile(resolve(dir,'summary.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8')]);
assert.equal(sha(parentRaw),yearMode?'495618bdc0fd222732fe13c6d972c3d713e1cab35e4952702c8b93b5b42ece34':driveMode?'7137c3736b374ebbfc5b4102b79f8b6860228f6e30f3750151f68b5b9219b6ec':equipmentMode?'f48e40cc92a6913c71c8d8513c5afcbe8507d49c6960c3453816c66888f19364':'165a5dd9ace548dbeb064939d48e8731a3bb3d4ae23b8da4eb6a65644daf5463');
const parent=JSON.parse(parentRaw),reviews=JSON.parse(reviewRaw),pre=JSON.parse(preRaw),summary=JSON.parse(summaryRaw);assert.equal(reviews.preflightHash,sha(preRaw));assert.equal(sha(sql),summary.sourceHash);assert.equal(sha(mannRaw),summary.mannHash);
const powerRaw=yearPowerMode?await readFile(resolve(dir,'gearbox-year-exact-power-scope-v1.json'),'utf8'):null,powerProof=powerRaw?JSON.parse(powerRaw):null;
if(powerProof){assert.equal(powerProof.planHash,sha(parentRaw));assert.equal(powerProof.sourceHash,sha(sql));assert.equal(powerProof.mannHash,sha(mannRaw));assert.equal(powerProof.archiveHash,sha(await readFile(powerProof.archivePath,'utf8')));}
for(const [file,hash]of Object.entries(summary.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const overlay=await loadIdentityOverlay(root,sql,summary.identityOverlay.path,summary.identityOverlay.sha256),sources=new Map(overlay.requirements.map(s=>[s.id,s]));
const liveRaw=await readFile(resolve(root,parent.inputFiles.live),'utf8');assert.equal(sha(liveRaw),parent.inputHashes.live);const live=JSON.parse(liveRaw);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseSpecifications}=await jiti.import('../src/lib/fluid-catalog.ts');
const {mannExactEquipmentModel,mannEquipmentComponentDrives,readMannEquipmentScope}=await jiti.import('../src/lib/mann-equipment-scope.ts');
const {extractFluidAggregateSourceContext:aggregate}=await jiti.import('../src/lib/fluid-aggregate-source-context.ts');
const {explicitMannTransmissionModelYears:yearsOf}=await jiti.import('../src/lib/mann-transmission-model-list.ts');
const {explicitMannAlphanumericModels:modelsOf}=await jiti.import('../src/lib/mann-transmission-model-list.ts'),{matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts'),{normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts'),{splitMannEngineCodeList:enginesOf}=await jiti.import('../src/lib/mann-engine-code-list.ts'),{parseFluidCapacities:capacity}=await jiti.import('../src/lib/fluid-capacity-parser.ts'),{extractFluidSourceSystemContext:label}=await jiti.import('../src/lib/fluid-source-system-context.ts'),{buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const rows=parseCopy(mannRaw,'mann_filter_applications'),variants=Map.groupBy(rows,r=>r.vehicleVariantKey),byMake=new Map();
const deniedRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8'),denied=new Set(JSON.parse(deniedRaw).rejectedAssociationFingerprints);
const reason=equipmentMode?'EQUIPMENT_MODEL_OR_LABEL_UNSUPPORTED':'TRANSMISSION_QUALIFIED_MODEL_NOT_SUPPORTED';
const selected=reviews.reviewEntries.filter(e=>e.reasons.includes(reason)&&(yearMode?yearsOf(e.originalSource.componentModel):driveMode?mannEquipmentComponentDrives(e.originalSource.componentModel):equipmentMode?mannExactEquipmentModel(e.originalSource.componentModel):modelsOf(e.originalSource.componentModel)));assert.equal(selected.length,yearMode?2:driveMode?9:equipmentMode?12:11);
const policy=equipmentMode?'USER_CONFIRMED_EQUIPMENT_V1':'USER_CONFIRMED_TRANSMISSION_V1',listPolicy=yearMode?'EXPLICIT_SOURCE_MODEL_YEAR_RANGE_V1':driveMode?'EXPLICIT_COMPONENT_DRIVE_CONDITION_V1':equipmentMode?'EXACT_SOURCE_EQUIPMENT_MODEL_V1':'EXPLICIT_ALPHANUMERIC_SOURCE_MODEL_LIST_V1',blocker=equipmentMode?'MANN variant не подтверждает привод или модель агрегата':'MANN variant не подтверждает тип или модель коробки',drafts=[];
const idx=m=>Number(m.slice(0,4))*12+Number(m.slice(5))-1,month=i=>`${Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`;
let cases=0,positive=0,partitionChecks=0;
const heldEntries=[];
for(const e of driveMode?selected.flatMap(e=>mannEquipmentComponentDrives(e.originalSource.componentModel).map(driveBranch=>({...e,driveBranch}))):selected){
 assert.deepEqual(e.reasons,[reason]);
 const s=sources.get(e.sourceRequirementId),original=overlay.originalById.get(s.id),f=structuredClone(pre.findings.find(f=>f.sourceRequirementId===s.id)),target=variants.get(e.targetId),models=yearMode?[yearsOf(s.componentModel).model]:modelsOf(s.componentModel),system=label(s.systemNameRaw,s.componentModel);
 assert.deepEqual(f.reasons,[]);assert.deepEqual(original,e.originalSource);assert.equal(sha(original),f.sourceHash);assert.ok(target?.length);assert.ok(driveMode?mannEquipmentComponentDrives(s.componentModel):equipmentMode?mannExactEquipmentModel(s.componentModel):models);
 const metadata=equipmentMode?aggregate(s.systemNameRaw,s.componentModel):null;
 const equipment=equipmentMode?{systemCode:s.systemCode,circuit:metadata.circuit,...(driveMode?{drive:e.driveBranch}:{componentModel:mannExactEquipmentModel(s.componentModel),...(metadata.requiredDrive?{drive:metadata.requiredDrive}:{})}),...(metadata.attachedTransmissionType?{attachedTransmissionType:metadata.attachedTransmissionType}:{})}:null;
 if(driveMode)assert.ok(!metadata.requiredDrive||metadata.requiredDrive===e.driveBranch);
 if(equipmentMode){
  assert.ok(readMannEquipmentScope(equipment));assert.equal(metadata.systemCode,s.systemCode);assert.equal(metadata.fluidRequired,true);assert.deepEqual(metadata.issues,['COMPONENT_OR_CONDITIONS_REQUIRE_REVIEW']);assert.equal(metadata.remainingLabel,'');
  assert.equal(s.driveType,null);assert.ok(!s.transmissionType||s.transmissionType===metadata.attachedTransmissionType);
 }else{
  assert.equal(s.driveType,null);assert.equal(s.transmissionType,system.transmissionType);assert.equal(system.destinationSystemCode,s.systemCode);assert.deepEqual(system.issues,[]);assert.equal(system.hasAdditionalLabelConditions,false);
  if(s.transmissionType==='cvt')assert.equal(system.transmissionGearCount,null);else assert.ok(Number.isInteger(system.transmissionGearCount));
 }
 for(const t of target){assert.deepEqual(applicabilityWindow(s,t),f.window);assert.ok(f.engineCodes.every(c=>enginesOf(t.engineCode).map(norm).includes(c)));assert.equal(Number(t.hp),s.powerHp);}
 let yearScope;
 if(yearMode){
  const range=yearsOf(s.componentModel),originalSourceWindow=f.window.source,componentWindow={from:`${range.yearFrom}-01`,to:`${range.yearTo}-12`};
  const source=intersectMonths(originalSourceWindow,componentWindow);assert.ok(source);
  const intersection=intersectMonths(source,f.window.mann);assert.ok(intersection);
  yearScope={originalSourceWindow,componentWindow,qualifiedSourceWindow:source,excludedBySourceCondition:subtractMonths(originalSourceWindow,[source])};
  f.window={...f.window,source,intersection,narrowedYears:{yearFrom:Number(intersection.from.slice(0,4)),yearTo:Number(intersection.to.slice(0,4))},restricted:true};
 }
 const parsed=capacity(s.fillVolumeText,s.systemCode);assert.equal(parsed.needsReview,false);assert.deepEqual(parsed,f.parsedCapacity);
 const sourceFingerprint=originalAssociationFingerprint(e.targetId,original,capacity(original.fillVolumeText,original.systemCode));assert.ok(!denied.has(sourceFingerprint));
 const prior=live.filter(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===e.targetId);assert.ok(prior.every(r=>!r.reviewConfirmed&&r.verificationStatus!=='PRIMARY_SOURCE_VERIFIED_FIELDS'));
 assert.ok(!parent.newRevisions.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===e.targetId));
 if(!byMake.has(s.make)){const forms=new Set(mannMakeFormsForTest(s.make));byMake.set(s.make,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
 const effective={...s,...f.window.narrowedYears,engineCodesJson:f.engineCodes,engineCodeNormalized:f.engineCodes[0]},decision=match(effective,byMake.get(s.make)),top=decision.topCandidates[0];
 assert.deepEqual(top.variantIds,[e.targetId]);assert.ok(top.score>=80);assert.deepEqual(top.hardConflicts,[]);assert.deepEqual(top.reviewBlockers,[blocker]);assert.deepEqual(conditionalVehicleIdentityReasons(effective,top),[]);
 const nearby=decision.topCandidates.slice(1).filter(c=>!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=top.score-10);
 let exactPowerResolution;
 if(yearPowerMode&&nearby.length&&s.id===powerProof.sourceRequirementId){
  assert.deepEqual(original,powerProof.originalSource);assert.equal(s.powerHp,powerProof.requiredSourcePowerHp);assert.deepEqual(top.variantIds,[powerProof.selectedVariantId]);
  assert.equal(powerProof.decisions.length,1+nearby.length);
  for(const c of [top,...nearby]){assert.equal(c.variantIds.length,1);const proof=powerProof.decisions.find(d=>d.variantId===c.variantIds[0]);assert.ok(proof);assert.deepEqual(variants.get(proof.variantId),proof.targetRows);assert.equal(proof.score,c.score);assert.equal(proof.status,c===top?'EXACT_SOURCE_POWER_SCOPE':'NOT_COVERED_BY_THIS_SOURCE_POWER');assert.ok(proof.targetRows.every(t=>c===top?Number(t.hp)===s.powerHp:Number(t.hp)!==s.powerHp));}
  exactPowerResolution={proofHash:sha(powerRaw),proof:powerProof};
 }
 if(yearMode&&nearby.length&&!exactPowerResolution){heldEntries.push({sourceRequirementId:s.id,originalSource:original,sourceHash:sha(original),yearScope,reason:'QUALIFIED_YEAR_RERANK_HAS_NEAR_EXACT_ENGINE_ALTERNATIVE',freshDecision:decision,candidateRows:[top,...nearby].map(c=>({score:c.score,variantIds:c.variantIds,rows:c.variantIds.flatMap(id=>variants.get(id)??[])})),publicationAllowed:false});continue;}
 assert.ok(nearby.length===0||exactPowerResolution);
 assert.ok(['NO_EXPLICIT_MARKER','EXPLICIT_ANALOG_SEPARATED'].includes(f.specificationSections.status));assert.deepEqual(f.cautions,[]);
 const applicabilityJson={sourceVehicleScope:{make:s.make,model:s.model,...(s.generation?{generation:s.generation}:{})},matchedEngineScope:f.engineCodes,window:f.window,componentModel:s.componentModel,...(equipmentMode?{requiredEquipment:equipment}:{transmissionType:s.transmissionType,...(s.transmissionType!=='cvt'?{transmissionGearCount:system.transmissionGearCount}:{})})};
 const technicalDataJson={fillVolumeText:s.fillVolumeText,capacities:parsed.capacities,specificationText:s.specificationText,specifications:s.specificationsJson,viscosityGrades:s.viscosityGradesJson,...Object.fromEntries(['recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'].map(k=>[k,s[k]]))};
 if(f.specificationSections.status==='EXPLICIT_ANALOG_SEPARATED'){
  const sections=f.specificationSections,main=sections.main.text.trim();assert.ok(main);
  const grades=[...new Set([...main.matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map(m=>m[0].toUpperCase()))];
  technicalDataJson.specificationText=main;technicalDataJson.specifications=[{type:'SOURCE_REQUIREMENT_TEXT',value:main},...parseSpecifications(main,grades).filter(s=>s.type!=='RAW')];technicalDataJson.viscosityGrades=grades;
  technicalDataJson.sourceSpecificationAttribution={policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:s.specificationText,mainSourceText:main,unverifiedAnalogText:sections.analog.text.trim(),metadataAndCautionText:sections.suffix.text.trim(),originalSourceHash:f.sourceHash,sourceRequirementId:s.id,oemVerified:false,automaticAnalogSelectionAllowed:false};
 }
 const fp=sha({policy,sourceRequirementId:s.id,vehicleVariantKey:e.targetId,applicabilityJson,technicalDataJson});
 const r={id:`mtar_${fp.slice(0,24)}`,semanticFingerprint:fp,sourceRequirementId:s.id,vehicleVariantKey:e.targetId,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson,technicalDataJson,state:'REVIEW',verificationStatus:'UNVERIFIED',matchClass:'CONDITIONAL_TRANSMISSION',matchScore:top.score,applyEligible:false,verifiedFieldsJson:[],replacesRevisionIds:prior.map(r=>r.id),fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:s.sourceUrl}],provenanceJson:{conditionalTransmissionPolicy:policy,conditionalTransmissionEligible:true,conditionalTransmissionChoiceRequired:true,sourceTechnicalReviewRequired:true,sourceTransmissionContext:system,sourceAssociationFingerprint:sourceFingerprint,sourceRecheckHash:sha(preRaw),identityCorrectionHash:overlay.metadata.sha256,explicitTransmissionModelList:{policy:listPolicy,sourceComponentModel:s.componentModel,models},independentValidation:{vehicleIdentityIndependentlyValidated:true,hardConflicts:[],reviewBlockers:[blocker],score:top.score,matchedFields:top.matchedFields}}};
 if(equipmentMode){r.matchClass='CONDITIONAL_EQUIPMENT';r.provenanceJson={conditionalEquipmentPolicy:policy,conditionalEquipmentEligible:true,sourceTechnicalReviewRequired:true,sourceAggregateContext:metadata,sourceAssociationFingerprint:sourceFingerprint,sourceRecheckHash:sha(preRaw),identityCorrectionHash:overlay.metadata.sha256,explicitEquipmentModel:{policy:listPolicy,sourceComponentModel:s.componentModel,model:equipment.componentModel},independentValidation:{vehicleIdentityIndependentlyValidated:true,hardConflicts:[],reviewBlockers:[blocker],score:top.score,matchedFields:top.matchedFields}};}
 if(driveMode){delete r.provenanceJson.explicitEquipmentModel;r.provenanceJson.explicitComponentDriveCondition={policy:listPolicy,sourceComponentModel:s.componentModel,drives:mannEquipmentComponentDrives(s.componentModel)};}
 if(yearMode){r.provenanceJson.explicitTransmissionModelList.modelYearRange=yearsOf(s.componentModel);r.provenanceJson.sourceComponentYearScope=yearScope;}
 if(exactPowerResolution)r.provenanceJson.exactSourcePowerResolution=exactPowerResolution;
 const pendingWindows=subtractMonths(f.window.source,[f.window.intersection]),row={...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{...(driveMode?{conditionalEquipmentPolicy:policy,equipmentComponentDrivePolicy:listPolicy}:equipmentMode?{conditionalEquipmentPolicy:policy,equipmentModelPolicy:listPolicy}:{conditionalTransmissionPolicy:policy,transmissionModelListPolicy:listPolicy}),automaticProductSelection:false}}};
 assert.ok(f.window.source.from&&f.window.source.to);const seenModels=new Set();
 for(let i=idx(f.window.source.from)-1;i<=idx(f.window.source.to)+1;i++){
  const m=month(i),inside=m>=f.window.intersection.from&&m<=f.window.intersection.to,sourceInside=m>=f.window.source.from&&m<=f.window.source.to;
  assert.equal(Number(inside)+pendingWindows.filter(w=>m>=w.from&&m<=w.to).length,Number(sourceInside));partitionChecks++;
  if(equipmentMode){
   const {systemCode,...confirmation}=equipment;
   const choices=[undefined,[],[confirmation],...(!driveMode?[[{...confirmation,componentModel:undefined}],[{...confirmation,componentModel:'WRONG1'}]]:[]),[confirmation,confirmation],[{...confirmation,circuit:'WRONG'}]];
   if(confirmation.drive)choices.push([{...confirmation,drive:undefined}],[{...confirmation,drive:confirmation.drive==='4WD'?'2WD':'4WD'}]);
   if(confirmation.attachedTransmissionType)choices.push([{...confirmation,attachedTransmissionType:undefined}],[{...confirmation,attachedTransmissionType:'WRONG'}]);
   for(const type of [undefined,'manual','automatic','cvt','robot'])for(const engine of [...f.engineCodes,undefined,'WRONG_ENGINE'])for(const confirmedEquipment of choices){
    const context={...applicabilityJson.sourceVehicleScope,productionMonth:m,engineCode:engine,confirmedEquipment};
    const expected=inside&&f.engineCodes.includes(engine)&&confirmedEquipment?.length===1&&confirmedEquipment[0]===confirmation&&(!confirmation.attachedTransmissionType||!type||type===confirmation.attachedTransmissionType);
    const items=profile([row],type,context).items;assert.equal(items.length,expected?1:0,`${s.id} ${m} ${type} ${JSON.stringify(confirmedEquipment)}`);cases++;
    if(expected){positive++;seenModels.add(equipment.componentModel);assert.equal(items[0].componentModel,equipment.componentModel);assert.equal(items[0].automaticSelectionEligible,false);}
   }
   continue;
  }
  for(const type of [undefined,'manual','automatic','cvt','robot'])for(const model of [...models,undefined,'WRONG_MODEL'])for(const count of s.transmissionType==='cvt'?[undefined]:[system.transmissionGearCount,undefined,99])for(const engine of [...f.engineCodes,undefined,'WRONG_ENGINE']){
   const context={...applicabilityJson.sourceVehicleScope,productionMonth:m,engineCode:engine,transmissionModel:model,transmissionGearCount:count};
   const expected=inside&&type===s.transmissionType&&models.includes(model)&&f.engineCodes.includes(engine)&&(s.transmissionType==='cvt'||count===system.transmissionGearCount);
   const items=profile([row],type,context).items;assert.equal(items.length,expected?1:0,`${s.id} ${m} ${type} ${model} ${count}`);cases++;
   if(expected){positive++;seenModels.add(model);assert.equal(items[0].componentModel,s.componentModel);assert.equal(items[0].automaticSelectionEligible,false);}
  }
 }
 assert.equal(seenModels.size,equipmentMode?1:models.length);drafts.push({revision:r,originalSource:original,sourceHash:sha(original),...(yearMode?{yearScope}:{}),...(driveMode?{driveBranch:e.driveBranch}:{}),pendingWindows,freshDecision:decision,publicationAllowed:false});
}
const files=['scripts/build-mann-alphanumeric-box-drafts.mjs','src/lib/mann-unified-technical-profile.ts','src/lib/mann-transmission-model-list.ts','src/lib/mann-technical-applicability.ts','src/lib/mann-transmission-component.ts'];
if(equipmentMode)files.push('src/lib/mann-equipment-scope.ts','src/lib/fluid-aggregate-source-context.ts');
const report={parentPath,planHash:sha(parentRaw),reviewHash:sha(reviewRaw),preflightHash:sha(preRaw),sourceHash:sha(sql),mannHash:sha(mannRaw),liveHash:sha(liveRaw),denylistHash:sha(deniedRaw),codeHashes:Object.fromEntries(await Promise.all(files.map(async file=>[file,sha(await readFile(resolve(root,file),'utf8'))]))),summary:{drafts:drafts.length,runtimeCases:cases,positiveCases:positive,partitionChecks,pendingIntervals:drafts.reduce((n,d)=>n+d.pendingWindows.length,0)},drafts,productionApplyAllowed:false,limitation:'Drafts only. Exact source list alternatives not equivalence/OEM approval. Independent verification and joint profile merge still required.'};
if(yearMode){report.heldEntries=heldEntries;report.summary.held=heldEntries.length;assert.equal(drafts.length+heldEntries.length,2);}
if(yearPowerMode){assert.equal(drafts.length,2);assert.equal(heldEntries.length,0);report.powerProofHash=sha(powerRaw);}
if(driveMode){assert.equal(drafts.length,10);assert.equal(new Set(drafts.map(d=>d.revision.sourceRequirementId)).size,9);}
await writeFile(resolve(dir,yearPowerMode?'gearbox-year-drafts-v2.json':yearMode?'gearbox-year-drafts-v1.json':driveMode?'equipment-drive-drafts-v1.json':equipmentMode?'equipment-model-drafts-v1.json':'alphanumeric-box-drafts-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
