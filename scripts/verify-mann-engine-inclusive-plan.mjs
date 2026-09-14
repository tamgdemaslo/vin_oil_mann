import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
import {coreScopeContains} from './lib/mann-core-scope-containment.mjs';
const dir=resolve(import.meta.dirname,'../outputs/mann-engine-inclusive-preview-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(raw);
const auditRaw=await readFile(resolve(dir,'profile-composition-audit-v3.json'),'utf8'),audit=JSON.parse(auditRaw);
assert.equal(audit.planSha256,sha(raw));assert.equal(audit.droppedExpectedItems,0);assert.equal(audit.capacityConflictCases,0);
assert.equal(audit.individuallyExercisedCandidates,plan.newRevisions.length);assert.deepEqual(audit.unexercisedCandidates,[]);
const parents={};
for(const [k,path] of Object.entries(plan.engineMergeInputFiles)){
  const value=await readFile(path,'utf8');assert.equal(sha(value),plan.engineMergeInputHashes[k]);parents[k]=JSON.parse(value);
}
const expected=[...parents.base.newRevisions,...parents.engine.revisions];
assert.deepEqual(plan.newRevisions,expected);assert.equal(new Set(expected.map(r=>r.id)).size,expected.length);
// This union adds no replacements; existing protected/review actions stay exact.
assert.deepEqual(plan.existingActions,parents.base.existingActions);
const byId=new Map(plan.newRevisions.map(r=>[r.id,r])),unseen=new Set(audit.unseenCandidateRevisions),accounted=new Set();
for(const pair of audit.equivalentRows){
  const row=byId.get(pair.revisionId),other=byId.get(pair.representedBy);assert.ok(row&&other&&!unseen.has(other.id));
  assert.equal(row.vehicleVariantKey,other.vehicleVariantKey);assert.equal(row.systemCode,other.systemCode);assert.equal(row.componentModel,other.componentModel);
  assert.deepEqual(row.applicabilityJson,other.applicabilityJson);assert.deepEqual(row.technicalDataJson,other.technicalDataJson);
  accounted.add(row.id);
}
const proofRaw=await readFile(resolve(dir,'shadowed-core-scope-verification-v1.json'),'utf8'),proof=JSON.parse(proofRaw);
assert.equal(proof.planHash,sha(raw));assert.equal(proof.auditHash,sha(auditRaw));
for(const finding of proof.findings){
  const row=byId.get(finding.revisionId);assert.ok(row&&unseen.has(row.id));
  assert.ok(finding.coveringRevisionIds.length);
  for(const id of finding.coveringRevisionIds){
    const other=byId.get(id);assert.ok(other&&!unseen.has(id));
    assert.equal(row.vehicleVariantKey,other.vehicleVariantKey);assert.equal(row.systemCode,other.systemCode);assert.equal(row.componentModel,other.componentModel);
    assert.deepEqual(row.technicalDataJson,other.technicalDataJson);assert.ok(coreScopeContains(other.applicabilityJson,row.applicabilityJson));
  }
  accounted.add(row.id);
}
assert.deepEqual([...accounted].sort(),[...unseen].sort());
const report={kind:'ENGINE_INCLUSIVE_OFFLINE_UNION_VERIFICATION',planSha256:sha(raw),auditHash:sha(auditRaw),containmentProofHash:sha(proofRaw),
  issueCount:0,productionApplyAllowed:false,candidateRevisions:expected.length,sourceRequirements:new Set(expected.map(r=>r.sourceRequirementId)).size,
  exactDuplicateRows:audit.equivalentRows.length,containedDuplicateRows:proof.findings.length,
  limitation:'Exact offline union and scope representation proved, sampled joint capacity audit passed. Not OEM verification, specification-conflict clearance, full-month joint replay, deployment or whole-source completion.'};
await writeFile(resolve(dir,'verification.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
