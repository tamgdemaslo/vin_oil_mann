import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {createJiti} from 'jiti';
import {gearboxSourceQuality} from './lib/mann-gearbox-source-quality.mjs';
assert.ok(process.argv.length<=4&&!process.argv.slice(2).some(a=>a.startsWith('--')));
const outputName=process.argv[3]??'full-source-coverage.json';
assert.match(outputName,/^full-source-coverage(?:-v\d+)?\.json$/);
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,process.argv[2]??'outputs/mann-equipment-inclusive-preview-2026-09-14'),sourceDir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const [planRaw,sourceRaw,decisionsRaw,aggregateRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile(resolve(sourceDir,'decisions.ndjson'),'utf8'),readFile(resolve(sourceDir,'aggregate-source-context-v1.json'),'utf8')]);
const plan=JSON.parse(planRaw),aggregate=JSON.parse(aggregateRaw);assert.equal(sha(sourceRaw),plan.inputHashes.source);assert.equal(sha(sourceRaw),aggregate.sourceHash);assert.equal(sha(decisionsRaw),aggregate.decisionsHash);
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements'),sourceIds=new Set(sources.map(r=>r.id));assert.equal(sourceIds.size,sources.length);
const decisions=new Map(decisionsRaw.trim().split('\n').map(line=>{const r=JSON.parse(line);return[r.requirementId,r];}));
assert.equal(decisions.size,sources.length);
const revisions=Map.groupBy(plan.newRevisions,r=>r.sourceRequirementId),contexts=new Map(aggregate.findings.map(r=>[r.requirementId,r]));
for(const id of revisions.keys())assert.ok(sourceIds.has(id));
// A candidate does not resolve a held source variant or a disputed date slice.
const obligations=new Map();
// A retained revision may be explicitly withheld; existence is not preview coverage.
const heldRevisionIds=new Set();
for(const revision of plan.newRevisions){
 const hold=revision.provenanceJson?.sourcePowerReviewHold??revision.provenanceJson?.sourceDateReviewHold;
 if(!hold)continue;
 assert.equal(revision.provenanceJson.catalogPreviewEligible,false);
 assert.equal(revision.provenanceJson.conditionalEquipmentEligible,false);
 heldRevisionIds.add(revision.id);
 const list=obligations.get(revision.sourceRequirementId)??[];
 list.push({reason:hold.reason??'EXPLICIT_SOURCE_PREVIEW_HOLD',revisionId:revision.id,hold});
 obligations.set(revision.sourceRequirementId,list);
}
// Repairing a later date window does not resolve the excluded earlier source slice.
const dotSuccessors=new Map((plan.dotTokenRepair?.replacements??[]).map(r=>[r.originalRevisionId,r.successorId]));
const currentRevisionId=id=>{
 const seen=new Set();while(dotSuccessors.has(id)){assert.ok(!seen.has(id),'Cyclic DOT successor history');seen.add(id);id=dotSuccessors.get(id);}return id;
};
for(const entry of plan.fourDateScopeRepair?.replacements??[]){
 const successor=plan.newRevisions.find(r=>r.id===currentRevisionId(entry.successorId));assert.ok(successor);
 assert.ok(sourceIds.has(successor.sourceRequirementId));
 assert.deepEqual(successor.applicabilityJson.window.intersection,entry.newWindow);
 const id=successor.sourceRequirementId,list=obligations.get(id)??[];
 list.push({reason:'SOURCE_ENGINE_BRANCH_DATE_PREFIX_UNSUPPORTED',originalRevisionId:entry.originalRevisionId,candidateRevisionIds:[successor.id],pendingWindow:entry.excludedPrefix,retainedWindow:entry.newWindow});
 obligations.set(id,list);
}
for(const entry of plan.sourceEvidenceReview??[]){
 assert.ok(sourceIds.has(entry.sourceRequirementId));assert.equal(sha(entry.originalSource),entry.sourceHash);
 assert.equal(entry.publicationAllowed,false);
 const list=obligations.get(entry.sourceRequirementId)??[];
 list.push({reason:entry.reason,evidencePath:entry.evidencePath,evidenceHash:entry.evidenceHash,
  pendingWindow:entry.qualifiedWindow,requiredSourceBranch:entry.requiredSourceBranch,
  potentialCandidateWindow:entry.candidateWindow,uncoveredMannWindows:entry.pendingWindows,
  excludedBySourceDates:entry.excludedBySourceDates,identityAndTechnicalReasons:entry.reasons,
  sourceSpecificationConflict:entry.sourceSpecificationConflict});
 obligations.set(entry.sourceRequirementId,list);
}
for(const entry of [...(plan.sourceMarketMonthPending??[]),...(plan.strongSourceDraftPending??[])]){
 assert.ok(sourceIds.has(entry.sourceRequirementId));assert.equal(sha(entry.originalSource),entry.sourceHash);
 const list=obligations.get(entry.sourceRequirementId)??[];
 list.push({reason:entry.reason,originalRevisionId:entry.originalRevisionId,sourceEngineBranch:entry.sourceEngineBranch,pendingWindow:entry.window,originalApplicability:entry.originalApplicability,candidateRevisionIds:entry.candidateRevisionIds});obligations.set(entry.sourceRequirementId,list);
}
for(const entry of [...(plan.sourceMarketPowerHeld??[]),...(plan.sourceMarketScopeReview??[]),...(plan.sourceMarketIdentityHeld??[])]){
 assert.ok(sourceIds.has(entry.revision.sourceRequirementId));assert.equal(sha(entry.originalSource),entry.sourceHash);
 const id=entry.revision.sourceRequirementId,list=obligations.get(id)??[];
 list.push({reason:entry.reason,revisionId:entry.revision.id,vehicleVariantKey:entry.revision.vehicleVariantKey,marketAuditStatuses:entry.evidence.statuses,identityReviewReasons:entry.identityEvidence?.reasons,sourceAnchorHash:sha(entry.sourceAnchor),retainedSourceBranches:entry.retainedSourceBranches,restrictedCandidateConditions:entry.restrictedCandidateConditions});
 obligations.set(id,list);
}
for(const entry of plan.transmissionIdentityHeld??[]){
 assert.ok(sourceIds.has(entry.revision.sourceRequirementId));assert.equal(sha(entry.originalSource),entry.sourceHash);
 const id=entry.revision.sourceRequirementId,list=obligations.get(id)??[];
 list.push({reason:entry.reason,revisionId:entry.revision.id,vehicleVariantKey:entry.revision.vehicleVariantKey,sourceIdentity:entry.evidence.sourceIdentity});
 obligations.set(id,list);
}
for(const entry of [...(plan.nissanTransmissionPending??[]),...(plan.transmissionRestorationPending??[])]){
 assert.ok(sourceIds.has(entry.sourceRequirementId));assert.equal(sha(entry.originalSource),entry.sourceHash);
 const list=obligations.get(entry.sourceRequirementId)??[];
 list.push({reason:entry.reason,sourceEngineBranch:entry.sourceEngineBranch,requiredTransmission:entry.requiredTransmission,pendingWindow:entry.window});
 obligations.set(entry.sourceRequirementId,list);
}
for(const entry of [...(plan.toyotaCapacityPending??[]),...(plan.nissanCapacityPending??[])]){
 assert.ok(sourceIds.has(entry.sourceRequirementId));assert.equal(sha(entry.originalSource),entry.sourceHash);
 const list=obligations.get(entry.sourceRequirementId)??[];
 list.push({reason:entry.reason,sourceEngineBranch:entry.sourceEngineBranch,condition:entry.condition,pendingWindow:entry.window});
 obligations.set(entry.sourceRequirementId,list);
}
for(const entry of plan.toyotaMarketPending??[]){
 assert.ok(sourceIds.has(entry.sourceRequirementId));assert.equal(sha(entry.originalSource),entry.sourceHash);
 const list=obligations.get(entry.sourceRequirementId)??[];
 list.push({reason:entry.reason,matchedEngineScope:entry.matchedEngineScope,requiredMarket:entry.requiredMarket,sourceBranch:entry.sourceBranch,pendingWindow:entry.window});
 obligations.set(entry.sourceRequirementId,list);
}
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {mannTransmissionComponent}=await jiti.import('../src/lib/mann-transmission-component.ts');
const {extractFluidSourceSystemContext}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const gearboxQuality=gearboxSourceQuality(sources,mannTransmissionComponent,extractFluidSourceSystemContext);
for(const [id,conflicts] of gearboxQuality.heldBySource)obligations.set(id,[...(obligations.get(id)??[]),...conflicts.map(c=>({reason:c.reason,modelKey:c.key,evidence:c.evidence,publicationAllowed:false}))]);
for(const entry of [...(plan.mercedesBulkPending??[]),...(plan.mercedesBulkReview??[])]){
  assert.ok(sourceIds.has(entry.sourceRequirementId));
  if(entry.originalSource)assert.equal(sha(entry.originalSource),entry.sourceHash);
  const list=obligations.get(entry.sourceRequirementId)??[];
  list.push({reason:entry.window?'MERCEDES_UNCOVERED_SOURCE_ENGINE_MONTHS':'MERCEDES_BULK_SCOPE_REVIEW',matchedEngineScope:entry.matchedEngineScope,pendingWindow:entry.window??null,vehicleVariantKey:entry.vehicleVariantKey,reasons:entry.reasons,...(entry.requiredEquipment?{requiredEquipment:entry.requiredEquipment}:{}),...(entry.requiredTransmission?{requiredTransmission:entry.requiredTransmission}:{})});
  obligations.set(entry.sourceRequirementId,list);
}
for(const entry of plan.sourceEngineRecoveryResiduals??[]){
  const revision=entry.originalRevision;assert.ok(sourceIds.has(revision.sourceRequirementId));
  const list=obligations.get(revision.sourceRequirementId)??[];
  list.push({reason:'SOURCE_ENGINE_RECOVERY_SCOPE_REVIEW',revisionId:revision.id,pendingWindow:entry.pendingWindow,requiredCondition:entry.requiredCondition,
    excludedSourceCodes:entry.excludedSourceCodes,excludedTargetCodes:entry.excludedTargetCodes});
  obligations.set(revision.sourceRequirementId,list);
}
for(const entry of plan.sourceMarketResiduals??[]){
  const revision=entry.originalRevision;assert.ok(sourceIds.has(revision.sourceRequirementId));
  const list=obligations.get(revision.sourceRequirementId)??[];
  list.push({reason:'SOURCE_MARKET_ENGINE_SCOPE_REVIEW',revisionId:revision.id,pendingWindow:entry.pendingWindow,requiredCondition:entry.requiredCondition});
  obligations.set(revision.sourceRequirementId,list);
}
for(const [field,reason] of [['rawDateWithheld','RAW_DATE_EXCLUDES_MATCH'],['sourceQualityHeld','SOURCE_SPECIFICATION_CONTRADICTION'],['sourceBodyHeld','SOURCE_BODY_CONFLICT'],['sourceBodyResiduals','SOURCE_ENGINE_SCOPE_REMAINDER'],['exactEngineResiduals','EXACT_ENGINE_SCOPE_REMAINDER'],['exactCapacityResiduals','CAPACITY_ENGINE_SCOPE_REMAINDER'],['disputedYearPending','DISPUTED_YEAR_SLICE']]){
  for(const entry of plan[field]??[]){
    const revision=entry.revision??entry.originalRevision;assert.ok(revision);
    assert.ok(sourceIds.has(revision.sourceRequirementId));
    const list=obligations.get(revision.sourceRequirementId)??[];
    list.push({reason,revisionId:revision.id,pendingWindow:entry.pendingWindow??null,...(entry.excludedEngineCodes?{excludedEngineCodes:entry.excludedEngineCodes}:{}),...(entry.requiredCondition?{requiredCondition:entry.requiredCondition,scopeIndex:entry.scopeIndex}:{})});
    obligations.set(revision.sourceRequirementId,list);
  }
}
for(const entry of plan.exactEngineReview??[]){
  assert.ok(sourceIds.has(entry.sourceRequirementId));
  const list=obligations.get(entry.sourceRequirementId)??[];
  list.push({reason:entry.reason,revisionId:entry.originalRevisionId});
  obligations.set(entry.sourceRequirementId,list);
}
for(const entry of [...(plan.passatReview??[]),...(plan.passatDateReview??[])]){
  assert.ok(sourceIds.has(entry.requirementId));
  const list=obligations.get(entry.requirementId)??[];
  list.push({reason:'PASSAT_SOURCE_SCOPE_REVIEW',vehicleVariantKey:entry.vehicleVariantKey,reasons:entry.reasons,pendingWindow:entry.window??null});
  obligations.set(entry.requirementId,list);
}
for(const entry of plan.passatDatePending??[]){
  assert.ok(sourceIds.has(entry.requirementId));
  assert.equal(entry.sourceHash,sha(entry.originalSource));
  const list=obligations.get(entry.requirementId)??[];
  list.push({reason:'PASSAT_UNCOVERED_SOURCE_ENGINE_MONTHS',matchedEngineScope:entry.matchedEngineScope,pendingWindow:entry.window});
  obligations.set(entry.requirementId,list);
}
const rows=sources.map(r=>{
  const decision=decisions.get(r.id);assert.ok(decision);const candidates=revisions.get(r.id)??[],context=contexts.get(r.id);
  const pending=obligations.get(r.id)??[];
  const previewCandidates=candidates.filter(c=>!heldRevisionIds.has(c.id));
  const status=previewCandidates.length?(pending.length?'IN_LOCAL_PREVIEW_WITH_PENDING_REVIEW':'IN_LOCAL_PREVIEW_PLAN'):pending.length?'HELD_SOURCE_REVIEW':context?.disposition==='EXPLICIT_ELECTRIC_STEERING_NO_FLUID'?'SOURCE_SAYS_NO_STEERING_FLUID':
    context?.rematchRequired?'DESTINATION_REVIEW':decision.match.status==='MANN_CATALOG_GAP'?'MANN_CATALOG_GAP':'UNRESOLVED_MATCH_OR_CONDITIONS';
  if(candidates.length)assert.notEqual(context?.rematchRequired,true,'Known destination issue in merged plan');
  return {requirementId:r.id,make:r.make,systemCode:r.systemCode,sourceUrl:r.sourceUrl,status,sourceMatchStatus:decision.match.status,
    localRevisionIds:candidates.map(c=>c.id),withheldRevisionIds:candidates.filter(c=>heldRevisionIds.has(c.id)).map(c=>c.id),hasParsedNumericCapacity:decision.capacity.capacities.length>0,
    pendingReview:pending,sourceFullyResolved:false,
    ...(candidates.some(c=>c.provenanceJson?.sourceComponentYearScope)?{sourceComponentYearScopes:candidates.filter(c=>c.provenanceJson?.sourceComponentYearScope).map(c=>({revisionId:c.id,componentModel:c.componentModel,...c.provenanceJson.sourceComponentYearScope}))}:{}),
    hasSourceSpecification:Boolean(r.specificationText?.trim()||r.specificationsJson?.length),
    blockers:[...new Set([...(decision.blockers??[]),...(decision.match.reviewReasons??[]),...(context?.reasons??[])])],
    productionAppliedByThisWork:false};
});
const counts=(items,field)=>Object.fromEntries([...Map.groupBy(items,field)].map(([k,v])=>[k,v.length]));
const unresolved=rows.filter(r=>r.status!=='IN_LOCAL_PREVIEW_PLAN'&&r.status!=='SOURCE_SAYS_NO_STEERING_FLUID');
const report={kind:'WHOLE_SOURCE_COVERAGE_NOT_COMPLETION',sourceHash:sha(sourceRaw),planHash:sha(planRaw),decisionsHash:sha(decisionsRaw),aggregateHash:sha(aggregateRaw),
  gearboxSourceQuality:{conflicts:gearboxQuality.conflicts,heldSourceCount:gearboxQuality.heldBySource.size,affectedRevisionIds:plan.newRevisions.filter(r=>gearboxQuality.heldBySource.has(r.sourceRequirementId)).map(r=>r.id),codeHashes:Object.fromEntries(await Promise.all(['scripts/lib/mann-gearbox-source-quality.mjs','scripts/lib/mann-explicit-gearbox-list.mjs','src/lib/mann-transmission-component.ts','src/lib/fluid-source-system-context.ts'].map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))])))},
  sourceRequirements:rows.length,localRevisionCount:plan.newRevisions.length,statusCounts:counts(rows,r=>r.status),unresolvedBySystem:counts(unresolved,r=>r.systemCode),
  unresolvedByMake:counts(unresolved,r=>r.make),previewRequirementsWithoutNumericCapacity:rows.filter(r=>r.localRevisionIds.length&&!r.hasParsedNumericCapacity).length,
  pendingReviewRequirements:obligations.size,pendingReviewEntries:[...obligations.values()].reduce((n,r)=>n+r.length,0),
  productionApplyAllowed:false,limitation:'Counts all source rows including non-fluid technical data. Local candidates are not full-source, production coverage or OEM verification. Old matcher statuses are diagnostic, not a fresh complete rematch. Held recommendations and disputed date slices remain unresolved even if another local candidate exists. Electric steering labels are source evidence only.',rows};
await writeFile(resolve(dir,outputName),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,rows:undefined,unresolvedByMake:undefined},null,2));
