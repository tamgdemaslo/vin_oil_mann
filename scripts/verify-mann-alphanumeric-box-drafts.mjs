import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {unionMonths,intersectMonths,subtractMonths} from './lib/mann-month-intervals.mjs';
import {splitSpecificationSections} from './lib/mann-specification-sections-v2.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&['equipment','drive','years','years-exact-power','type-count'].includes(process.argv[2])));const typeCountMode=process.argv[2]==='type-count',powerMode=process.argv[2]==='years-exact-power',yearMode=powerMode||process.argv[2]==='years',driveMode=process.argv[2]==='drive',equipmentMode=driveMode||process.argv[2]==='equipment';
const raw=await readFile(resolve(dir,typeCountMode?'transmission-type-count-drafts-v1.json':powerMode?'gearbox-year-drafts-v2.json':yearMode?'gearbox-year-drafts-v1.json':driveMode?'equipment-drive-drafts-v1.json':equipmentMode?'equipment-model-drafts-v1.json':'alphanumeric-box-drafts-v1.json'),'utf8'),report=JSON.parse(raw),sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
assert.equal(sha(sql),report.sourceHash);assert.equal(sha(await readFile(report.parentPath,'utf8')),report.planHash);
for(const [file,hash]of Object.entries(report.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{explicitMannAlphanumericModels:parse}=await jiti.import('../src/lib/mann-transmission-model-list.ts'),{parseFluidCapacities:capacity}=await jiti.import('../src/lib/fluid-capacity-parser.ts'),{parseSpecifications}=await jiti.import('../src/lib/fluid-catalog.ts');
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s])),seen=new Set();
const {extractFluidAggregateSourceContext:aggregate}=await jiti.import('../src/lib/fluid-aggregate-source-context.ts');
const {mannExactEquipmentModel:equipmentModel,mannEquipmentComponentDrives:drivesOf,readMannEquipmentScope}=await jiti.import('../src/lib/mann-equipment-scope.ts');
const {explicitMannTransmissionModelYears:yearsOf}=await jiti.import('../src/lib/mann-transmission-model-list.ts');
const {mannExplicitTransmissionTypeCount:typeCountOf}=await jiti.import('../src/lib/mann-transmission-component.ts'),{extractFluidSourceSystemContext:sourceContext}=await jiti.import('../src/lib/fluid-source-system-context.ts');
for(const d of report.drafts){
 const r=d.revision,s=sources.get(r.sourceRequirementId),scope=r.applicabilityJson,tech=r.technicalDataJson;
 const key=driveMode?`${s.id}:${d.driveBranch}`:s.id;assert.ok(!seen.has(key));seen.add(key);assert.deepEqual(s,d.originalSource);assert.equal(sha(s),d.sourceHash);
 assert.equal(r.componentModel,s.componentModel);assert.equal(scope.componentModel,s.componentModel);
 if(equipmentMode){
  const metadata=aggregate(s.systemNameRaw,s.componentModel),model=equipmentModel(s.componentModel);assert.ok(driveMode?drivesOf(s.componentModel):model);
  assert.deepEqual(r.provenanceJson.sourceAggregateContext,metadata);assert.deepEqual(metadata.issues,['COMPONENT_OR_CONDITIONS_REQUIRE_REVIEW']);
  if(driveMode){assert.deepEqual(r.provenanceJson.explicitComponentDriveCondition,{policy:'EXPLICIT_COMPONENT_DRIVE_CONDITION_V1',sourceComponentModel:s.componentModel,drives:drivesOf(s.componentModel)});assert.ok(drivesOf(s.componentModel).includes(d.driveBranch));assert.ok(!metadata.requiredDrive||metadata.requiredDrive===d.driveBranch);}
  else assert.deepEqual(r.provenanceJson.explicitEquipmentModel,{policy:'EXACT_SOURCE_EQUIPMENT_MODEL_V1',sourceComponentModel:s.componentModel,model});
  assert.deepEqual(scope.requiredEquipment,{systemCode:s.systemCode,circuit:metadata.circuit,...(driveMode?{drive:d.driveBranch}:{componentModel:model,...(metadata.requiredDrive?{drive:metadata.requiredDrive}:{})}),...(metadata.attachedTransmissionType?{attachedTransmissionType:metadata.attachedTransmissionType}:{})});
  assert.ok(readMannEquipmentScope(scope.requiredEquipment));assert.equal(r.matchClass,'CONDITIONAL_EQUIPMENT');assert.equal(r.provenanceJson.conditionalEquipmentPolicy,'USER_CONFIRMED_EQUIPMENT_V1');
  assert.ok(!('transmissionGearCount' in scope));assert.ok(!('transmissionType' in scope));
 }else if(typeCountMode){
  const parsed=typeCountOf(s.componentModel);assert.ok(parsed);assert.deepEqual(r.provenanceJson.explicitTransmissionTypeCount,{policy:'EXPLICIT_SOURCE_TYPE_COUNT_V1',sourceComponentModel:s.componentModel,typeCount:parsed});
  assert.deepEqual(r.provenanceJson.sourceTransmissionContext,sourceContext(s.systemNameRaw,s.componentModel));assert.equal(scope.transmissionType,parsed.type);assert.equal(scope.transmissionGearCount,parsed.gearCount);assert.ok(!r.provenanceJson.explicitTransmissionModelList);
 }else if(yearMode){
  const range=yearsOf(s.componentModel);assert.ok(range);
  assert.deepEqual(r.provenanceJson.explicitTransmissionModelList,{policy:'EXPLICIT_SOURCE_MODEL_YEAR_RANGE_V1',sourceComponentModel:s.componentModel,models:[range.model],modelYearRange:range});
  const originalSourceWindow={from:`${s.yearFrom}-01`,to:`${s.yearTo}-12`},componentWindow={from:`${range.yearFrom}-01`,to:`${range.yearTo}-12`},qualifiedSourceWindow=intersectMonths(originalSourceWindow,componentWindow);
  const expected={originalSourceWindow,componentWindow,qualifiedSourceWindow,excludedBySourceCondition:subtractMonths(originalSourceWindow,[qualifiedSourceWindow])};
  assert.deepEqual(d.yearScope,expected);assert.deepEqual(r.provenanceJson.sourceComponentYearScope,expected);
  assert.deepEqual(scope.window.source,qualifiedSourceWindow);assert.deepEqual(scope.window.intersection,intersectMonths(qualifiedSourceWindow,scope.window.mann));
  assert.deepEqual(unionMonths([scope.window.intersection,...d.pendingWindows,...expected.excludedBySourceCondition]),[originalSourceWindow]);
  for(const w of expected.excludedBySourceCondition)assert.equal(intersectMonths(w,qualifiedSourceWindow),null);
 }else assert.deepEqual(r.provenanceJson.explicitTransmissionModelList,{policy:'EXPLICIT_ALPHANUMERIC_SOURCE_MODEL_LIST_V1',sourceComponentModel:s.componentModel,models:parse(s.componentModel)});
 assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.deepEqual(r.verifiedFieldsJson,[]);
 assert.deepEqual(tech.capacities,capacity(s.fillVolumeText,s.systemCode).capacities);
 for(const k of ['fillVolumeText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])assert.deepEqual(tech[k],s[k]);
 const sections=splitSpecificationSections(s.specificationText,s.analogText);
 if(sections.status==='EXPLICIT_ANALOG_SEPARATED'){
  const main=sections.main.text.trim(),grades=[...new Set([...main.matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map(m=>m[0].toUpperCase()))];
  assert.equal(tech.specificationText,main);assert.deepEqual(tech.viscosityGrades,grades);assert.deepEqual(tech.specifications,[{type:'SOURCE_REQUIREMENT_TEXT',value:main},...parseSpecifications(main,grades).filter(s=>s.type!=='RAW')]);
  const a=tech.sourceSpecificationAttribution;assert.equal(a.originalSpecificationText,s.specificationText);assert.equal(a.unverifiedAnalogText,sections.analog.text.trim());assert.equal(a.metadataAndCautionText,sections.suffix.text.trim());assert.equal(a.oemVerified,false);assert.equal(a.automaticAnalogSelectionAllowed,false);
 }else{assert.equal(tech.specificationText,s.specificationText);assert.deepEqual(tech.specifications,s.specificationsJson);assert.deepEqual(tech.viscosityGrades,s.viscosityGradesJson);}
 assert.deepEqual(unionMonths([scope.window.intersection,...d.pendingWindows]),[scope.window.source]);for(const p of d.pendingWindows)assert.equal(intersectMonths(p,scope.window.intersection),null);
 if(!equipmentMode){if(scope.transmissionType==='cvt')assert.ok(!('transmissionGearCount' in scope));else assert.ok(Number.isInteger(scope.transmissionGearCount));}
}
assert.equal(seen.size,typeCountMode?2:yearMode?report.drafts.length:driveMode?10:equipmentMode?12:11);
if(typeCountMode){
 const preRaw=await readFile(resolve(dir,'source-type-count-preflight-v1.json'),'utf8'),pre=JSON.parse(preRaw);assert.equal(sha(preRaw),report.preflightHash);
 assert.deepEqual(report.reviewEntries,pre.findings.filter(f=>f.reasons.length));assert.equal(report.reviewEntries.length,20);
 assert.deepEqual([...seen].sort(),pre.findings.filter(f=>!f.reasons.length).map(f=>f.sourceRequirementId).sort());
}
if(yearMode){
 assert.equal(report.drafts.length+report.heldEntries.length,2);
 for(const h of report.heldEntries){assert.ok(!seen.has(h.sourceRequirementId));seen.add(h.sourceRequirementId);assert.deepEqual(h.originalSource,sources.get(h.sourceRequirementId));assert.equal(h.sourceHash,sha(h.originalSource));assert.equal(h.publicationAllowed,false);assert.equal(h.reason,'QUALIFIED_YEAR_RERANK_HAS_NEAR_EXACT_ENGINE_ALTERNATIVE');assert.ok(h.candidateRows.length>1);}
 assert.equal(seen.size,2);
}
if(powerMode){
 assert.equal(report.drafts.length,2);assert.equal(report.heldEntries.length,0);
 const rawProof=await readFile(resolve(dir,'gearbox-year-exact-power-scope-v1.json'),'utf8'),proof=JSON.parse(rawProof);
 assert.equal(report.powerProofHash,sha(rawProof));assert.equal(proof.sourceHash,sha(sql));assert.equal(proof.planHash,report.planHash);
 const d=report.drafts.find(d=>d.revision.sourceRequirementId===proof.sourceRequirementId);assert.ok(d);
 assert.deepEqual(d.revision.provenanceJson.exactSourcePowerResolution,{proofHash:sha(rawProof),proof});assert.equal(d.revision.vehicleVariantKey,proof.selectedVariantId);assert.equal(d.originalSource.powerHp,proof.requiredSourcePowerHp);
 const archive=await readFile(proof.archivePath,'utf8');assert.equal(sha(archive),proof.archiveHash);const rawRows=archive.trim().split('\n').map(JSON.parse);
 assert.deepEqual(rawRows.find(r=>r.row_id===proof.rawEngineAnchor.row_id),proof.rawEngineAnchor);assert.deepEqual(rawRows.find(r=>r.row_id===proof.rawFluidRow.row_id),proof.rawFluidRow);
 assert.equal(proof.rawFluidRow.table_index,proof.rawEngineAnchor.table_index);assert.equal(proof.rawFluidRow.source_url,proof.rawEngineAnchor.source_url);assert.match(proof.rawEngineAnchor.model,/2UZ-FE\s*\/\s*235\s*л\.с\./);
 const mann=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mann),proof.mannHash);const targets=Map.groupBy(parseCopy(mann,'mann_filter_applications'),r=>r.vehicleVariantKey);
 for(const c of proof.decisions){assert.deepEqual(targets.get(c.variantId),c.targetRows);assert.ok(c.targetRows.every(t=>c.variantId===proof.selectedVariantId?Number(t.hp)===proof.requiredSourcePowerHp:Number(t.hp)!==proof.requiredSourcePowerHp));}
}
if(driveMode){
 const groups=Map.groupBy(report.drafts,d=>d.revision.sourceRequirementId);assert.equal(groups.size,9);
 for(const group of groups.values()){
  assert.deepEqual(group.map(d=>d.driveBranch),drivesOf(group[0].originalSource.componentModel));
  for(const d of group){assert.deepEqual(d.revision.technicalDataJson,group[0].revision.technicalDataJson);assert.deepEqual(d.revision.applicabilityJson.window,group[0].revision.applicabilityJson.window);}
 }
 assert.equal(new Set(report.drafts.map(d=>d.revision.id)).size,10);
}
const result={planHash:report.planHash,draftHash:sha(raw),sourceHash:sha(sql),checked:report.drafts.length,...(yearMode?{held:report.heldEntries.length}:{}),allSourceModelsPreserved:true,technicalSourceFieldsPreserved:true,pendingIntervals:report.summary.pendingIntervals,productionApplyAllowed:false};
await writeFile(resolve(dir,typeCountMode?'transmission-type-count-draft-verification-v1.json':powerMode?'gearbox-year-draft-verification-v2.json':yearMode?'gearbox-year-draft-verification-v1.json':driveMode?'equipment-drive-draft-verification-v1.json':equipmentMode?'equipment-model-draft-verification-v1.json':'alphanumeric-box-draft-verification-v1.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
