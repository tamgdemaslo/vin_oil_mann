import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-passat-date-inclusive-preview-2026-09-14');
const [raw,auditRaw,resolverRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),
  readFile(resolve(dir,'specific-body-preview-recheck-v1.json'),'utf8'),readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')]);
const parent=JSON.parse(raw),audit=JSON.parse(auditRaw);
assert.equal(audit.planHash,sha(raw));assert.equal(audit.resolverHash,sha(resolverRaw));
assert.equal(parent.productionApplyAllowed,false);assert.ok(!parent.sourceBodyHeld);
const byId=new Map(parent.newRevisions.map(r=>[r.id,r])),held=[];
for(const finding of audit.results.filter(r=>r.target?.hardConflicts.includes('код кузова'))){
  const revision=byId.get(finding.revisionId);assert.ok(revision);assert.equal(sha(revision),finding.revisionHash);
  assert.equal(revision.applyEligible,false);assert.equal(revision.verificationStatus,'UNVERIFIED');
  assert.notEqual(revision.reviewConfirmed,true);
  held.push({revision,sourceIssue:finding,resolutionStatus:'EXPLICIT_SOURCE_BODY_EVIDENCE_REQUIRED',publicationAllowed:false});
}
assert.ok(held.length);
const ids=new Set(held.map(r=>r.revision.id));assert.equal(ids.size,held.length);
const newRevisions=parent.newRevisions.filter(r=>!ids.has(r.id));
assert.equal(newRevisions.length+held.length,parent.newRevisions.length);
const existingActions=parent.existingActions.map(action=>{
  const successors=action.successorIds??(action.successorId?[action.successorId]:[]);
  if(!successors.some(id=>ids.has(id)))return action;
  assert.notEqual(action.action,'PRESERVE_PROTECTED');
  const remaining=successors.filter(id=>!ids.has(id));
  const {successorId,successorIds,...rest}=action;
  return {...rest,...(remaining.length===1?{successorId:remaining[0]}:remaining.length?{successorIds:remaining}:{action:'REVIEW_SOURCE_BODY_CONFLICT'})};
});
for(const a of existingActions)for(const id of a.successorIds??(a.successorId?[a.successorId]:[]))assert.ok(!ids.has(id));
assert.deepEqual(existingActions.filter(a=>a.action==='PRESERVE_PROTECTED'),parent.existingActions.filter(a=>a.action==='PRESERVE_PROTECTED'));
const plan={...parent,kind:'SOURCE_BODY_CONFLICT_QUARANTINED_PREVIEW',newRevisions,existingActions,sourceBodyHeld:held,
  bodyQuarantineParent:{path:resolve(dir,'plan.json'),sha256:sha(raw),auditHash:sha(auditRaw)},
  summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,
    engineLineRevisions:newRevisions.filter(r=>r.provenanceJson.engineAnchorRowIds).length,sourceBodyHeld:held.length,
    actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false,
  limitation:'Unpublished candidates with explicit body conflicts held in full, not deleted or resolved. Needs source evidence and whole-plan runtime/technical validation.'};
for(const field of ['sourceQualityHeld','rawDateWithheld','disputedYearPending','passatReview','passatDatePending','passatDateReview'])assert.deepEqual(plan[field],parent[field]);
const out=resolve(root,'outputs/mann-body-quarantined-preview-2026-09-14');await mkdir(out);
const serialized=JSON.stringify(plan,null,2)+'\n';
await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
const proof={planHash:sha(serialized),parentHash:sha(raw),auditHash:sha(auditRaw),heldRevisions:held.length,
  priorRevisions:parent.newRevisions.length,retainedRevisions:newRevisions.length,
  changedActions:existingActions.filter((a,i)=>sha(a)!==sha(parent.existingActions[i])).length,
  allParentRecordsAccounted:true,protectedActionsUnchanged:true,noHeldSuccessors:true,productionApplyAllowed:false};
await writeFile(resolve(out,'quarantine-verification.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(proof,null,2));
