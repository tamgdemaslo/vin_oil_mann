import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const dir=resolve(import.meta.dirname,'../outputs/mann-gentra-evidence-review-2026-09-14');
const oldRaw=await readFile(resolve(dir,'full-source-coverage-v7.json'),'utf8'),newRaw=await readFile(resolve(dir,'full-source-coverage-v8.json'),'utf8'),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const before=JSON.parse(oldRaw),after=JSON.parse(newRaw),plan=JSON.parse(planRaw),history=plan.xc60PowerRestoredHistory;
assert.equal(sha(planRaw),'0f09e72ca05abe50f929a58c8fbcc0c127c3d9561ad8fbfc3933ceb701879234');assert.equal(after.planHash,sha(planRaw));
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(after.sourceHash,sha(sql));assert.equal(before.sourceHash,after.sourceHash);
const sourceIds=new Set(parseCopy(sql,'vehicle_fluid_requirements').map(s=>s.id));assert.equal(after.rows.length,13296);assert.deepEqual(new Set(after.rows.map(r=>r.requirementId)),sourceIds);
const byId=new Map(after.rows.map(r=>[r.requirementId,r]));let preserved=0,reconciled=0,replaced=0,removedReasons=0;
for(const old of before.rows)for(const entry of old.pendingReview){
 const current=byId.get(old.requirementId).pendingReview;
 if(entry.reason!=='XC60_SOURCE_BRANCH_PAIR_REVIEW'){assert.ok(current.some(p=>sha(p)===sha(entry)));preserved++;continue;}
 const transition=history.reviewTransitions.find(t=>t.sourceRequirementId===old.requirementId&&t.targetId===entry.targetId&&sha(t.branch)===sha(entry.branch));assert.ok(transition);
 assert.deepEqual(transition.beforeReasons,entry.reasons);removedReasons+=transition.removedReasons.length;
 assert.ok(transition.removedReasons.every(r=>r==='SOURCE_ANCHOR_POWER_CONFLICT'));
 if(transition.remainingReasons.length){
  const expected={...entry,reasons:transition.remainingReasons,draftHash:history.draftHash};assert.ok(current.some(p=>sha(p)===sha(expected)));reconciled++;
 }else{
  assert.ok(current.some(p=>p.reason==='XC60_SOURCE_SCOPE_RECONCILIATION'&&p.vehicleVariantKey===entry.targetId&&p.draftHash===history.draftHash));replaced++;
 }
}
assert.equal(removedReasons,21);assert.equal(reconciled,37);assert.equal(replaced,3);assert.equal(preserved,1818);
const pending=after.rows.flatMap(r=>r.pendingReview);assert.equal(pending.length,1858);assert.equal(after.pendingReviewEntries,pending.length);
assert.equal(pending.filter(p=>p.reason==='XC60_SOURCE_SCOPE_RECONCILIATION').length,9);assert.equal(pending.filter(p=>p.reason==='XC60_SOURCE_BRANCH_PAIR_REVIEW').length,37);
assert.equal(plan.newRevisions.length,1967);assert.deepEqual(new Set(after.rows.flatMap(r=>r.localRevisionIds)),new Set(plan.newRevisions.map(r=>r.id)));
assert.equal(Object.values(after.statusCounts).reduce((n,v)=>n+v,0),13296);assert.ok(after.rows.every(r=>r.sourceFullyResolved===false&&r.productionAppliedByThisWork===false));
const summary={sourceRows:13296,localRevisionIds:1967,preservedPendingEntries:preserved,reconciledReviewPairs:reconciled,reviewPairsReplacedBySourceScopePending:replaced,removedProvenPowerReasons:removedReasons,totalPendingEntries:pending.length};
await writeFile(resolve(dir,'xc60-reconciled-coverage-verification-v1.json'),JSON.stringify({kind:'XC60_RECONCILED_COVERAGE_INTEGRITY',planHash:sha(planRaw),beforeHash:sha(oldRaw),afterHash:sha(newRaw),summary,productionApplyAllowed:false,limitations:['Bookkeeping and explicit reason-transition proof, not full-source fluid verification or deployed VIN result.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
