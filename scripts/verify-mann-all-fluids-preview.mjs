import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,process.argv[2]??'outputs/mann-all-fluids-preview-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(raw);
assert.equal(plan.productionApplyAllowed,false);assert.equal(plan.writeMode,'DRY_RUN_ONLY');
const inputs={};
for(const [k,p] of Object.entries(plan.mergeInputFiles)){
  const content=await readFile(p,'utf8');assert.equal(sha(content),plan.mergeInputHashes[k]);inputs[k]=JSON.parse(content);
}
for(const [k,p] of Object.entries(plan.inputFiles))assert.equal(sha(await readFile(resolve(root,p),'utf8')),plan.inputHashes[k]);
const supplemental=inputs.equipment??inputs.transmission;
const expected=[...inputs.base.newRevisions,...supplemental.revisions];
assert.equal(expected.length,plan.newRevisions.length);
const byId=new Map(plan.newRevisions.map(r=>[r.id,r]));assert.equal(byId.size,expected.length);
const key=r=>`${r.sourceRequirementId}:${r.vehicleVariantKey}`;
assert.equal(new Set(plan.newRevisions.map(key)).size,expected.length);
for(const r of expected)assert.deepEqual(byId.get(r.id),r,'Merge altered parent revision');
const live=JSON.parse(await readFile(resolve(root,plan.inputFiles.live),'utf8'));
const actions=new Map(plan.existingActions.map(a=>[a.revisionId,a]));assert.equal(actions.size,live.length);
const candidates=new Map(plan.newRevisions.map(r=>[key(r),r]));
for(const old of live){
  const action=actions.get(old.id);assert.ok(action);
  assert.equal(action.expectedSemanticFingerprint,old.semanticFingerprint);assert.equal(action.expectedState,old.state);
  const successor=candidates.get(key(old));
  if(old.reviewConfirmed||old.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'){
    assert.equal(action.action,'PRESERVE_PROTECTED');assert.equal(action.successorId,null);assert.ok(!successor);
  }else if(successor){
    assert.equal(action.action,'REPLACE_WITH_PREVIEW');assert.equal(action.successorId,successor.id);
    assert.ok(successor.replacesRevisionIds.includes(old.id));
  }else{
    assert.equal(action.successorId,null);
    assert.equal(action.action,old.matchClass==='CONDITIONAL_TRANSMISSION'?'RECHECK_CONDITIONAL':'REVIEW_UNREPLACED');
  }
}
if(inputs.equipment){
  assert.deepEqual(plan.equipmentReviewDecisions,inputs.equipment.decisions.filter(d=>!d.successorId));
  assert.deepEqual(plan.transmissionReviewDecisions,inputs.base.transmissionReviewDecisions);
}else assert.deepEqual(plan.transmissionReviewDecisions,inputs.transmission.decisions.filter(d=>!d.successorId));
const auditRaw=await readFile(resolve(dir,'profile-composition-audit-v2.json'),'utf8'),audit=JSON.parse(auditRaw);
assert.equal(audit.planSha256,sha(raw));assert.equal(audit.capacityConflictCases,0);assert.equal(audit.droppedExpectedItems,0);
assert.equal(audit.individuallyExercisedCandidates,expected.length);assert.deepEqual(audit.unexercisedCandidates,[]);
for(const pair of audit.equivalentRows){
  const a=byId.get(pair.revisionId),b=byId.get(pair.representedBy);assert.ok(a&&b&&a.id!==b.id);
  assert.equal(a.vehicleVariantKey,b.vehicleVariantKey);assert.equal(a.systemCode,b.systemCode);
  assert.equal(a.componentModel,b.componentModel);assert.deepEqual(a.applicabilityJson,b.applicabilityJson);
  assert.deepEqual(a.technicalDataJson,b.technicalDataJson);
}
const report={result:'PASS_OFFLINE_ALL_PREVIEW_MERGE',planSha256:sha(raw),compositionAuditSha256:sha(auditRaw),
  candidates:expected.length,existingRevisions:live.length,preservedProtected:plan.existingActions.filter(a=>a.action==='PRESERVE_PROTECTED').length,
  remainingConditionalReview:plan.transmissionReviewDecisions.length,issueCount:0,productionApplyAllowed:false,
  limitation:'Exact parent preservation and sampled local runtime checks, not all source requirements or production/OEM verification.'};
await writeFile(resolve(dir,'verification.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
