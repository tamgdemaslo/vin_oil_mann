import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const dir=resolve(import.meta.dirname,'../outputs/mann-gentra-evidence-review-2026-09-14');
const version=process.argv[2]??'v4';assert.ok(['v1','v3','v4'].includes(version));
const files={v1:[4,5],v3:[5,6],v4:[6,7]}[version];
const beforeRaw=await readFile(resolve(dir,`full-source-coverage-v${files[0]}.json`),'utf8'),afterRaw=await readFile(resolve(dir,`full-source-coverage-v${files[1]}.json`),'utf8'),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const before=JSON.parse(beforeRaw),after=JSON.parse(afterRaw),plan=JSON.parse(planRaw);assert.equal(after.planHash,sha(planRaw));assert.equal(sha(planRaw),version==='v4'?'be393d53760bedb9f5165721e5948ee69e43b5e39249c10b5c4fbd656d1079fb':'3a3a0c2a6877dc4917c510713ff23ef7ab9a8d8ddd12abe4838622229b712e42');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(after.sourceHash,sha(sourceRaw));assert.equal(before.sourceHash,after.sourceHash);
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements'),expected=new Set(sources.map(s=>s.id));
assert.equal(after.rows.length,13296);assert.deepEqual(new Set(after.rows.map(r=>r.requirementId)),expected);assert.equal(new Set(after.rows.map(r=>r.requirementId)).size,after.rows.length);
assert.equal(Object.values(after.statusCounts).reduce((a,b)=>a+b,0),13296);
const byId=new Map(after.rows.map(r=>[r.requirementId,r]));let preservedObligations=0;
for(const old of before.rows){
 const current=byId.get(old.requirementId);assert.ok(current);const pending=new Set(current.pendingReview.map(sha));
 for(const obligation of old.pendingReview){assert.ok(pending.has(sha(obligation)),`Prior pending obligation lost: ${old.requirementId}`);preservedObligations++;}
}
const revisionIds=new Set(plan.newRevisions.map(r=>r.id));assert.deepEqual(new Set(after.rows.flatMap(r=>r.localRevisionIds)),revisionIds);
assert.ok(after.rows.every(r=>r.sourceFullyResolved===false&&r.productionAppliedByThisWork===false));
const newObligations=after.rows.flatMap(r=>r.pendingReview).filter(p=>['MERCEDES_GAINED_SOURCE_SCOPE_RECONCILIATION','MERCEDES_GAINED_PAIR_REVIEW'].includes(p.reason));assert.equal(newObligations.length,56);
if(version!=='v1')assert.equal(after.rows.flatMap(r=>r.pendingReview).filter(p=>p.reason==='EXACT_ENGINE_REMATCH_LOST_PRIOR_TARGET').length,2);
if(version==='v4')assert.equal(after.rows.flatMap(r=>r.pendingReview).filter(p=>['XC60_SOURCE_SCOPE_RECONCILIATION','XC60_SOURCE_BRANCH_PAIR_REVIEW'].includes(p.reason)).length,46);
const summary={sourceRows:13296,localRevisionIds:revisionIds.size,preservedPriorPendingEntries:preservedObligations,newPendingEntries:after.pendingReviewEntries-preservedObligations,totalPendingEntries:after.pendingReviewEntries,fullyResolvedClaims:0};
await writeFile(resolve(dir,`current-coverage-ledger-verification-${version}.json`),JSON.stringify({kind:'CURRENT_COVERAGE_LEDGER_INTEGRITY',planHash:sha(planRaw),beforeHash:sha(beforeRaw),afterHash:sha(afterRaw),summary,productionApplyAllowed:false,limitations:['Coverage bookkeeping proof, not validation of all historical matcher results or full-source completeness.','Original unresolved-status classification remains historical; current 422-source rematch is separate evidence, not a complete reclassification.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
