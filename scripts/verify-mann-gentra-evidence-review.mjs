import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(raw),history=plan.sourceEvidenceReviewHistory;
const parentRaw=await readFile(history.parentPath,'utf8'),parent=JSON.parse(parentRaw);assert.equal(history.parentHash,sha(parentRaw));
const evidenceRaw=await readFile(history.evidencePath,'utf8'),evidence=JSON.parse(evidenceRaw);assert.equal(history.evidenceHash,sha(evidenceRaw));assert.equal(evidence.planHash,sha(parentRaw));
const pdfHash=createHash('sha256').update(await readFile(evidence.pdfEvidence.path)).digest('hex');assert.equal(pdfHash,evidence.pdfEvidence.sha256);
const restored=structuredClone(plan);for(const key of ['sourceEvidenceReview','sourceEvidenceReviewHistory']){if(Object.hasOwn(parent,key))restored[key]=parent[key];else delete restored[key];}
assert.deepEqual(restored,parent,'Every pre-existing plan field and revision must remain identical');
assert.equal(plan.newRevisions.length,1932);assert.equal(plan.productionApplyAllowed,false);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),evidence.sourceHash);const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const currentCoverageRaw=await readFile(resolve(dir,'full-source-coverage.json'),'utf8'),coverage=JSON.parse(currentCoverageRaw);
const oldCoverage=JSON.parse(await readFile(resolve(dirname(history.parentPath),'full-source-coverage.json'),'utf8'));
assert.equal(coverage.planHash,sha(raw));assert.equal(oldCoverage.planHash,sha(parentRaw));
const oldRows=new Map(oldCoverage.rows.map(r=>[r.requirementId,r])),newRows=new Map(coverage.rows.map(r=>[r.requirementId,r]));assert.equal(newRows.size,13296);
assert.equal(plan.sourceEvidenceReview.length-(parent.sourceEvidenceReview?.length??0),8);
const added=plan.sourceEvidenceReview.slice(parent.sourceEvidenceReview?.length??0),ids=new Set(added.map(r=>r.sourceRequirementId));assert.equal(ids.size,8);
let checks=0;
for(const entry of added){
 const finding=evidence.findings.find(f=>f.sourceRequirementId===entry.sourceRequirementId);assert.ok(finding);
 assert.deepEqual(entry,{...finding,reason:finding.sourceSpecificationConflict?'SOURCE_SPECIFICATION_CONTRADICTION':'SOURCE_IDENTITY_REQUIRES_PRIMARY_EVIDENCE',evidencePath:history.evidencePath,evidenceHash:history.evidenceHash});
 assert.deepEqual(entry.originalSource,sources.get(entry.sourceRequirementId));assert.equal(entry.sourceHash,sha(entry.originalSource));
 assert.equal(entry.requiredSourceBranch.market,'RU');assert.deepEqual(entry.requiredSourceBranch.powerHp,[107]);assert.equal(entry.requiredSourceBranch.engineCode,'B15D2');
 const counters={candidate:0,pending:0,excluded:0},inWindow=(m,w)=>m>=w.from&&m<=w.to;
 for(let y=2013;y<=2016;y++)for(let m=1;m<=12;m++){
  const month=`${y}-${String(m).padStart(2,'0')}`,states=[inWindow(month,entry.candidateWindow),entry.pendingWindows.some(w=>inWindow(month,w)),entry.excludedBySourceDates.some(w=>inWindow(month,w))];
  assert.equal(states.filter(Boolean).length,1);counters[['candidate','pending','excluded'][states.indexOf(true)]]++;checks++;
  assert.equal(inWindow(month,entry.qualifiedWindow),!states[2]);
 }
 assert.deepEqual(counters,{candidate:28,pending:4,excluded:16});
 const row=newRows.get(entry.sourceRequirementId);assert.equal(row.status,'HELD_SOURCE_REVIEW');assert.equal(row.localRevisionIds.length,0);assert.equal(row.sourceFullyResolved,false);
 const review=row.pendingReview.find(r=>r.evidenceHash===history.evidenceHash);assert.ok(review);assert.deepEqual(review.pendingWindow,entry.qualifiedWindow);assert.deepEqual(review.potentialCandidateWindow,entry.candidateWindow);assert.deepEqual(review.excludedBySourceDates,entry.excludedBySourceDates);
}
for(const [id,row]of newRows)if(!ids.has(id))assert.deepEqual(row,oldRows.get(id));
assert.equal(coverage.pendingReviewRequirements,oldCoverage.pendingReviewRequirements+8);assert.equal(coverage.pendingReviewEntries,oldCoverage.pendingReviewEntries+8);
const conflicts=added.filter(e=>e.sourceSpecificationConflict);assert.equal(conflicts.length,1);assert.equal(conflicts[0].sourceSpecificationConflict.automaticCorrectionAllowed,false);
assert.equal(evidence.pdfEvidence.serviceMaterials.packageSizesAreNotFillCapacities,true);assert.equal(evidence.pdfEvidence.identity.sourceGenerationIICrosswalkProven,false);
const result={planHash:sha(raw),parentHash:sha(parentRaw),evidenceHash:sha(evidenceRaw),coverageHash:sha(currentCoverageRaw),pdfHash,verifiedMonthStates:checks,addedReviewSources:8,sourceSpecificationConflicts:1,unchangedRevisions:1932,unchangedCoverageRows:13288,completeParentRestoration:true,productionApplyAllowed:false,limitation:'Offline review bookkeeping and exact source-month partition only. No fluid approval, source correction, runtime publication or generation crosswalk.'};
await writeFile(resolve(dir,'independent-evidence-review-verification-v1.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
