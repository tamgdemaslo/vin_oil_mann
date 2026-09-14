import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';

const root=resolve(import.meta.dirname,'..');
assert.ok(process.argv.length===2||(process.argv.length===3&&['equipment','drive','years','type-count'].includes(process.argv[2])));
const typeCount=process.argv[2]==='type-count',years=process.argv[2]==='years',driveMode=process.argv[2]==='drive',equipmentMode=driveMode||process.argv[2]==='equipment',expected=(typeCount||years)?2:driveMode?10:equipmentMode?12:11,pendingCount=(typeCount||years)?47:driveMode?46:equipmentMode?34:22;
const dir=resolve(root,typeCount?'outputs/mann-type-count-added-preview-2026-09-14':years?'outputs/mann-gearbox-year-added-preview-2026-09-14':driveMode?'outputs/mann-equipment-drive-added-preview-2026-09-14':equipmentMode?'outputs/mann-equipment-model-added-preview-2026-09-14':'outputs/mann-alphanumeric-box-added-preview-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(raw),hash=sha(raw);
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const history=plan.strongSourceDraftHistory,parentRaw=await readFile(history.parentPath,'utf8'),parent=JSON.parse(parentRaw);
assert.equal(sha(parentRaw),history.parentHash);
const ids=new Set(history.originalDrafts.map(d=>d.revision.id));
assert.equal(ids.size,expected);
const actions=new Map(history.actionHistory.map(a=>[a.revisionId,a]));
assert.equal(actions.size,typeCount?2:(years||equipmentMode)?0:8);
assert.deepEqual({...plan,newRevisions:plan.newRevisions.filter(r=>!ids.has(r.id)),existingActions:plan.existingActions.map(a=>actions.get(a.revisionId)??a),strongSourceDraftPending:plan.strongSourceDraftPending.slice(0,parent.strongSourceDraftPending.length),strongSourceDraftHistory:history.previous,summary:parent.summary},parent);
assert.equal(plan.productionApplyAllowed,false);
if(typeCount){
 const drafts=await read(resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14/transmission-type-count-drafts-v1.json'));
 assert.deepEqual(history.reviewEntries,drafts.reviewEntries);assert.equal(history.reviewEntries.length,20);
 assert.deepEqual(plan.strongSourceDraftPending,parent.strongSourceDraftPending);
}
const audit=await read(resolve(dir,'profile-composition-audit-v5.json'));
const prior=await read(resolve(history.parentPath,'..','profile-composition-audit-v5.json'));
assert.equal(audit.planSha256,hash);
assert.deepEqual(audit.unseenCandidateRevisions,prior.unseenCandidateRevisions);
assert.deepEqual(audit.equivalentRows,prior.equivalentRows);
assert.equal(audit.specificationDivergencePairs,prior.specificationDivergencePairs);
assert.ok(audit.specificationDifferences.every(d=>d.systemCode==='TIRES_WHEELS'));
assert.equal(audit.individuallyExercisedCandidates,plan.newRevisions.length);
assert.equal(audit.droppedExpectedItems,0);assert.equal(audit.capacityConflictCases,0);
for(const id of ids)assert.ok(!audit.unseenCandidateRevisions.includes(id));
const shadow=await read(resolve(dir,'shadowed-core-scope-verification-v2.json'));
assert.equal(shadow.planHash,hash);
assert.equal(shadow.auditHash,sha(await readFile(resolve(dir,'profile-composition-audit-v5.json'),'utf8')));
assert.deepEqual(shadow.summary,{unresolvedRepresentation:7,proved:7,unresolved:0});
const coverage=await read(resolve(dir,'full-source-coverage.json'));
assert.equal(coverage.planHash,hash);assert.equal(plan.strongSourceDraftPending.length,pendingCount);
for(const pending of plan.strongSourceDraftPending){
 const row=coverage.rows.find(r=>r.requirementId===pending.sourceRequirementId);
 assert.ok(row);assert.equal(row.sourceFullyResolved,false);
 assert.ok(row.pendingReview.some(p=>p.reason===pending.reason&&JSON.stringify(p.pendingWindow)===JSON.stringify(pending.window)&&JSON.stringify(p.sourceEngineBranch)===JSON.stringify(pending.sourceEngineBranch)));
}
if(driveMode)for(const p of plan.strongSourceDraftPending.slice(parent.strongSourceDraftPending.length))assert.deepEqual(p.sourceEngineBranch.requiredEquipment,p.originalApplicability.requiredEquipment);
if(years)for(const d of history.originalDrafts){
 const r=coverage.rows.find(r=>r.requirementId===d.revision.sourceRequirementId);assert.ok(r);
 assert.deepEqual(r.sourceComponentYearScopes,[{revisionId:d.revision.id,componentModel:d.revision.componentModel,...d.yearScope}]);
 assert.deepEqual(d.yearScope,d.revision.provenanceJson.sourceComponentYearScope);
 for(const excluded of d.yearScope.excludedBySourceCondition)assert.ok(!r.pendingReview.some(p=>JSON.stringify(p.pendingWindow)===JSON.stringify(excluded)));
}
for(const file of ['engine-subset-audit-v2.json','source-market-context-audit-v1.json','source-market-target-scope-audit-v2.json'])assert.equal((await read(resolve(dir,file))).planHash,hash);
console.log(JSON.stringify({planHash:hash,exactParentRestoration:true,newCandidates:ids.size,pendingIntervals:pendingCount,jointCases:audit.cases,knownShadowed:17,newCandidatesVisible:true,productionApplyAllowed:false}));
