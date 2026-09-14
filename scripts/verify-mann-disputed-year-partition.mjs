import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-disputed-year-preview-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(raw);
const parentRaw=await readFile(plan.disputedYearParent.path,'utf8'),parent=JSON.parse(parentRaw);
assert.equal(sha(parentRaw),plan.disputedYearParent.sha256);
assert.equal(plan.productionApplyAllowed,false);
for(const field of ['rawDateWithheld','sourceQualityHeld','protectedBranches','inputHashes','transmissionReviewDecisions','equipmentReviewDecisions','engineReview'])assert.deepEqual(plan[field],parent[field]);
const originals=new Map(parent.newRevisions.map(r=>[r.id,r])),current=new Map(plan.newRevisions.map(r=>[r.id,r]));
assert.equal(current.size,originals.size);
const mapping=new Map();
for(const entry of plan.disputedYearPending){
  const old=originals.get(entry.originalRevision.id),next=current.get(entry.retainedRevisionId);
  assert.ok(old&&next);assert.deepEqual(entry.originalRevision,old);assert.ok(!mapping.has(old.id));
  mapping.set(old.id,next.id);
  assert.equal(sha(old),next.provenanceJson.disputedSourceDate.parentRevisionHash);
  assert.equal(next.provenanceJson.disputedSourceDate.parentRevisionId,old.id);
  assert.equal(entry.pendingWindow.from,'2024-01');assert.equal(entry.pendingWindow.to,'2024-12');
  assert.equal(old.applicabilityJson.window.intersection.to,entry.pendingWindow.to);
  assert.equal(next.applicabilityJson.window.intersection.to,'2023-12');
  const expected=structuredClone(old.applicabilityJson);
  expected.window.intersection.to='2023-12';expected.window.narrowedYears.yearTo=2023;expected.window.restricted=true;
  if('yearTo' in expected)expected.yearTo=2023;
  assert.deepEqual(next.applicabilityJson,expected);
  for(const key of Object.keys(old).filter(k=>!['id','semanticFingerprint','applicabilityJson','provenanceJson'].includes(k)))assert.deepEqual(next[key],old[key]);
  const {disputedSourceDate,...provenance}=next.provenanceJson;assert.deepEqual(provenance,old.provenanceJson);
}
assert.equal(mapping.size,5);
for(const [id,old] of originals)if(!mapping.has(id))assert.deepEqual(current.get(id),old);
assert.equal(plan.existingActions.length,parent.existingActions.length);
for(let i=0;i<parent.existingActions.length;i++){
  const old=parent.existingActions[i],expected=structuredClone(old);
  if(expected.successorId)expected.successorId=mapping.get(expected.successorId)??expected.successorId;
  if(expected.successorIds)expected.successorIds=expected.successorIds.map(id=>mapping.get(id)??id);
  assert.deepEqual(plan.existingActions[i],expected);
}
const report={kind:'INDEPENDENT_DISPUTED_YEAR_PARTITION_CHECK',planHash:sha(raw),parentHash:sha(parentRaw),
  preservedRevisions:originals.size-mapping.size,restrictedRevisions:mapping.size,originalsFullyRetained:true,
  allPriorReviewQueuesPreserved:true,allPredecessorActionsPreservedExceptSuccessorIds:true,
  productionApplyAllowed:false,limitation:'Exact plan transformation and date partition integrity only; not original source/OEM, parent-chain, full runtime or production approval.'};
await writeFile(resolve(dir,'independent-date-partition-verification.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
