import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-raw-date-preview-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8'),auditRaw=await readFile(resolve(dir,'vw-coolant-identifier-audit-v1.json'),'utf8');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
const parent=JSON.parse(raw),audit=JSON.parse(auditRaw);assert.equal(audit.planHash,sha(raw));assert.equal(audit.sourceHash,sha(sourceRaw));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const ids=new Set(),held=[];
for(const finding of audit.findings){
  const source=sources.get(finding.requirementId);assert.ok(source);assert.equal(sha(source),finding.sourceHash);
  assert.equal(finding.automaticCorrectionAllowed,false);assert.ok(finding.mismatches.length);
  const rows=parent.newRevisions.filter(r=>r.sourceRequirementId===source.id);
  assert.deepEqual(rows.map(r=>r.id).sort(),[...finding.affectedRevisionIds].sort());
  for(const revision of rows){
    assert.equal(revision.applyEligible,false);assert.equal(revision.verificationStatus,'UNVERIFIED');
    assert.notEqual(revision.reviewConfirmed,true);assert.ok(!ids.has(revision.id));ids.add(revision.id);
    held.push({revision,sourceHash:finding.sourceHash,sourceRequirementId:source.id,sourceIssue:finding,
      resolutionStatus:'NEEDS_VEHICLE_SPECIFIC_AUTHORITATIVE_CORRECTION',publicationAllowed:false});
  }
}
const newRevisions=parent.newRevisions.filter(r=>!ids.has(r.id));
assert.equal(newRevisions.length+held.length,parent.newRevisions.length);
assert.deepEqual(new Set([...newRevisions.map(r=>r.id),...held.map(r=>r.revision.id)]),new Set(parent.newRevisions.map(r=>r.id)));
const existingActions=parent.existingActions.map(action=>{
  const successors=action.successorIds??(action.successorId?[action.successorId]:[]);
  if(!successors.some(id=>ids.has(id)))return action;
  assert.notEqual(action.action,'PRESERVE_PROTECTED');
  const remaining=successors.filter(id=>!ids.has(id));
  const {successorId,successorIds,...rest}=action;
  return {...rest,...(remaining.length===1?{successorId:remaining[0]}:remaining.length?{successorIds:remaining}:{action:'REVIEW_SOURCE_SPECIFICATION_CONTRADICTION'})};
});
assert.deepEqual(existingActions.filter(a=>a.action==='PRESERVE_PROTECTED'),parent.existingActions.filter(a=>a.action==='PRESERVE_PROTECTED'));
for(const a of existingActions)for(const id of a.successorIds??(a.successorId?[a.successorId]:[]))assert.ok(!ids.has(id));
const plan={...parent,kind:'SOURCE_CONTRADICTION_QUARANTINED_PREVIEW',newRevisions,existingActions,
  sourceQualityParent:{path:resolve(dir,'plan.json'),sha256:sha(raw),auditHash:sha(auditRaw)},sourceQualityHeld:held,
  summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,
    engineLineRevisions:newRevisions.filter(r=>r.provenanceJson.engineAnchorRowIds).length,sourceContradictionHeld:held.length,
    actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false,
  limitation:'Temporary exclusion, not resolution or source correction. All held recommendations retain their full payload. Remaining alternatives do not become primary verified or universally applicable.'};
const out=resolve(root,'outputs/mann-source-quality-preview-2026-09-14');await mkdir(out);
await writeFile(resolve(out,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
await writeFile(resolve(out,'quarantine-verification.json'),JSON.stringify({planHash:sha(JSON.stringify(plan,null,2)+'\n'),parentHash:sha(raw),
  auditHash:sha(auditRaw),heldRevisions:held.length,allParentRecordsAccounted:true,protectedActionsUnchanged:true,noHeldSuccessors:true,
  productionApplyAllowed:false,limitation:'Partition and predecessor integrity only; not a full-plan approval.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,...plan.summary},null,2));
