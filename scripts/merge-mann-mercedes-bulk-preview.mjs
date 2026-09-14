import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {createJiti} from 'jiti';
import {gearboxSourceQuality} from './lib/mann-gearbox-source-quality.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&['--equipment','--transmission','--lists'].includes(process.argv[2])));
const lists=process.argv[2]==='--lists',equipment=process.argv[2]==='--equipment',transmission=lists||process.argv[2]==='--transmission',conditional=equipment||transmission,count=lists?3:transmission?18:equipment?31:39;
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,lists?'outputs/mann-mercedes-transmission-preview-2026-09-14':transmission?'outputs/mann-mercedes-equipment-preview-2026-09-14':equipment?'outputs/mann-mercedes-bulk-preview-2026-09-14':'outputs/mann-mercedes-compressed-preview-2026-09-14');
const prefix=lists?'mercedes-transmission-list':transmission?'mercedes-transmission':equipment?'mercedes-equipment':'mercedes-bulk';
const [raw,supplementRaw,partitionRaw]=await Promise.all(['plan.json',`${prefix}-preview-supplement-v1.json`,`${prefix}-partition-v1.json`].map(f=>readFile(resolve(dir,f),'utf8')));
const parent=JSON.parse(raw),supplement=JSON.parse(supplementRaw),partition=JSON.parse(partitionRaw);
assert.equal(supplement.planHash,sha(raw));assert.equal(partition.supplementHash,sha(supplementRaw));
if(conditional){const checkRaw=await readFile(resolve(dir,lists?'mercedes-transmission-list-recheck-v1.json':transmission?'mercedes-bulk-transmission-recheck-v1.json':'mercedes-bulk-equipment-recheck-v1.json'),'utf8');assert.equal(sha(checkRaw),supplement.auditHash);assert.equal(JSON.parse(checkRaw).auditHash,partition.auditHash);if(equipment)assert.equal(supplement.equipmentScopeHash,sha(await readFile(resolve(root,'src/lib/mann-equipment-scope.ts'),'utf8')));}
else assert.equal(partition.auditHash,supplement.auditHash);
assert.deepEqual(supplement.summary,lists?{considered:3,revisions:3,review:0,checks:51435}:transmission?{considered:19,revisions:18,review:1,checks:101115}:equipment?{considered:33,revisions:31,review:2,checks:23481}:{considered:45,revisions:39,review:6,checks:5496});
assert.deepEqual(partition.summary,lists?{sources:3,totalEngineMonths:192,coveredEngineMonths:177,pendingEngineMonths:15,pendingIntervals:4,unsupportedBranches:0}:transmission?{sources:18,totalEngineMonths:900,coveredEngineMonths:713,pendingEngineMonths:187,pendingIntervals:22,unsupportedBranches:0}:equipment?{sources:31,totalEngineMonths:1644,coveredEngineMonths:1383,pendingEngineMonths:261,pendingIntervals:36,unsupportedBranches:0}:{sources:39,totalEngineMonths:1968,coveredEngineMonths:1754,pendingEngineMonths:214,pendingIntervals:50,unsupportedBranches:0});
if(lists){assert.ok(supplement.supportingCodeHashes);for(const [file,hash] of Object.entries(supplement.supportingCodeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));}
if(transmission)for(const [field,file] of [['componentParserHash','mann-transmission-component.ts'],['labelParserHash','fluid-source-system-context.ts']])assert.equal(supplement[field],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
for(const [field,file] of [['matcherHash','mann-fluid-matcher-v2.ts'],['resolverHash','mann-vehicle-resolver.ts'],['targetParserHash','mann-engine-code-list.ts'],['applicabilityHash','mann-technical-applicability.ts'],['profileHash','mann-unified-technical-profile.ts']])assert.equal(supplement[field],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(supplement.sourceHash,sha(sourceRaw));
assert.equal(supplement.mannHash,sha(await readFile('/tmp/mann_filter_applications.sql','utf8')));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {mannTransmissionComponent}=await jiti.import('../src/lib/mann-transmission-component.ts');
const {explicitMannTransmissionModels}=await jiti.import('../src/lib/mann-transmission-model-list.ts');
const {extractFluidSourceSystemContext}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const gearboxQuality=gearboxSourceQuality([...sources.values()],mannTransmissionComponent,extractFluidSourceSystemContext);
const ids=new Set(parent.newRevisions.map(r=>r.id)),pairs=new Set(parent.newRevisions.map(r=>`${r.sourceRequirementId}:${r.vehicleVariantKey}`));
for(const r of supplement.revisions){
 assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.equal(r.state,conditional?'REVIEW':'STAGED');
 assert.ok(!ids.has(r.id));ids.add(r.id);const pair=`${r.sourceRequirementId}:${r.vehicleVariantKey}`;assert.ok(!pairs.has(pair));pairs.add(pair);
 const original=sources.get(r.sourceRequirementId);assert.ok(original);
 assert.ok(!gearboxQuality.heldBySource.has(original.id),'Source model has contradictory gear counts; cannot merge');
 if(lists){const models=explicitMannTransmissionModels(original.componentModel);assert.ok(models);assert.equal(r.componentModel,original.componentModel);assert.equal(r.applicabilityJson.componentModel,original.componentModel);assert.deepEqual(r.provenanceJson.explicitTransmissionModelList,{policy:'EXPLICIT_DECIMAL_MODEL_LIST_V1',sourceComponentModel:original.componentModel,models});}
 for(const key of ['fillVolumeText','specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])assert.deepEqual(r.technicalDataJson[key],original[key]);
 assert.deepEqual(r.technicalDataJson.specifications,original.specificationsJson);assert.deepEqual(r.technicalDataJson.viscosityGrades,original.viscosityGradesJson);
 const fingerprint=sha(conditional?{policy:transmission?r.provenanceJson.conditionalTransmissionPolicy:r.provenanceJson.conditionalEquipmentPolicy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicabilityJson:r.applicabilityJson,technicalDataJson:r.technicalDataJson}:{policy:r.provenanceJson.catalogPreviewPolicy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technicalData:r.technicalDataJson});
 assert.equal(r.semanticFingerprint,fingerprint);assert.equal(r.id,`mtar_${fingerprint.slice(0,24)}`);
 assert.ok(conditional?r.provenanceJson.independentValidation.vehicleIdentityIndependentlyValidated:r.provenanceJson.independentValidation.independentlyValidated);
 if(transmission){assert.equal(r.provenanceJson.conditionalTransmissionPolicy,'USER_CONFIRMED_TRANSMISSION_V1');assert.ok(r.applicabilityJson.componentModel);assert.ok(r.applicabilityJson.transmissionType);assert.ok(Number.isInteger(r.applicabilityJson.transmissionGearCount));}
 if(equipment){assert.equal(r.provenanceJson.conditionalEquipmentPolicy,'USER_CONFIRMED_EQUIPMENT_V1');assert.ok(r.applicabilityJson.requiredEquipment);}
}
const successors=new Map();for(const r of supplement.revisions)for(const id of r.replacesRevisionIds){const list=successors.get(id)??[];list.push(r.id);successors.set(id,list);}
const actionHistory=[];
const existingActions=parent.existingActions.map(a=>{
 if(!successors.has(a.revisionId))return a;
 assert.notEqual(a.action,'PRESERVE_PROTECTED');actionHistory.push(a);
 const refs=[...(a.successorIds??(a.successorId?[a.successorId]:[])),...(a.proposedSuccessorIds??[]),...successors.get(a.revisionId)];
 const {successorId,successorIds,proposedSuccessorIds,...rest}=a;
 return {...rest,action:'REVIEW_SOURCE_ENGINE_SCOPE',proposedSuccessorIds:[...new Set(refs)]};
});
assert.equal(actionHistory.length,successors.size);
for(const a of existingActions)for(const id of [...(a.successorIds??(a.successorId?[a.successorId]:[])),...(a.proposedSuccessorIds??[])])assert.ok(ids.has(id));
const pending=partition.pending.map(entry=>{
 const originalSource=sources.get(entry.sourceRequirementId);assert.equal(sha(originalSource),entry.sourceHash);
 const related=supplement.revisions.filter(r=>r.sourceRequirementId===entry.sourceRequirementId);
 if(equipment)assert.equal(new Set(related.map(r=>JSON.stringify(r.applicabilityJson.requiredEquipment))).size,1);
 if(transmission){const conditions=related.map(r=>({type:r.applicabilityJson.transmissionType,...(lists?{models:r.provenanceJson.explicitTransmissionModelList.models}:{model:r.applicabilityJson.componentModel}),gearCount:r.applicabilityJson.transmissionGearCount}));assert.equal(new Set(conditions.map(c=>JSON.stringify(c))).size,1);assert.deepEqual(entry.requiredTransmission,conditions[0]);}
 return {...entry,originalSource,...(equipment?{requiredEquipment:related[0].applicabilityJson.requiredEquipment}:{})};
});
const newRevisions=[...parent.newRevisions,...supplement.revisions];
const plan={...parent,newRevisions,existingActions,
 mercedesBulkPending:[...(parent.mercedesBulkPending??[]),...pending],mercedesBulkReview:[...(parent.mercedesBulkReview??[]),...supplement.review],
 mercedesBulkHistory:{previousHistory:parent.mercedesBulkHistory??null,parentPath:resolve(dir,'plan.json'),parentHash:sha(raw),supplementHash:sha(supplementRaw),partitionHash:sha(partitionRaw),actions:actionHistory,addedIds:supplement.revisions.map(r=>r.id)},
 summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,mercedesBulkAdded:(parent.summary.mercedesBulkAdded??0)+count,mercedesBulkPendingIntervals:(parent.mercedesBulkPending??[]).length+pending.length,mercedesBulkReview:(parent.mercedesBulkReview??[]).length+supplement.review.length,
 conditionalEquipmentRevisions:(parent.summary.conditionalEquipmentRevisions??0)+(equipment?count:0),
 conditionalTransmissionRevisions:parent.newRevisions.filter(r=>r.provenanceJson?.conditionalTransmissionPolicy).length+(transmission?count:0),
 actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
for(const key of Object.keys(parent).filter(k=>!['newRevisions','existingActions','summary','mercedesBulkPending','mercedesBulkReview','mercedesBulkHistory'].includes(k)))assert.deepEqual(plan[key],parent[key]);
assert.deepEqual(newRevisions.slice(0,parent.newRevisions.length),parent.newRevisions);
const out=resolve(root,lists?'outputs/mann-mercedes-transmission-list-preview-2026-09-14':transmission?'outputs/mann-mercedes-transmission-preview-2026-09-14':equipment?'outputs/mann-mercedes-equipment-preview-2026-09-14':'outputs/mann-mercedes-bulk-preview-2026-09-14');await mkdir(out);
const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
await writeFile(resolve(out,'merge-verification.json'),JSON.stringify({planHash:sha(serialized),parentHash:sha(raw),added:count,preserved:parent.newRevisions.length,pending:pending.length,review:supplement.review.length,changedActions:actionHistory.length,noDanglingSuccessors:true,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,hash:sha(serialized),revisions:newRevisions.length,sources:plan.summary.sourceRequirements,changedActions:actionHistory.length}));
