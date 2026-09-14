import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-bmw-body-restored-preview-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--competitor-fix'));
const competitor=process.argv[2]==='--competitor-fix';
const parentPath=resolve(competitor?resolve(root,'outputs/mann-exact-engine-preview-2026-09-14'):dir,'plan.json');
const [raw,supplementRaw,auditRaw,proposalsRaw]=await Promise.all([readFile(parentPath,'utf8'),
  readFile(resolve(dir,competitor?'exact-engine-replacement-supplement-v2.json':'exact-engine-replacement-supplement-v1.json'),'utf8'),readFile(resolve(dir,competitor?'exact-engine-review-details-v2.json':'exact-engine-proposal-recheck-v1.json'),'utf8'),
  readFile(resolve(dir,'exact-engine-scope-proposals-v2.json'),'utf8')]);
const parent=JSON.parse(raw),supplement=JSON.parse(supplementRaw),audit=JSON.parse(auditRaw),proposals=JSON.parse(proposalsRaw);
assert.equal(supplement.planHash,competitor?parent.exactEngineHistory.parentHash:sha(raw));assert.equal(supplement.auditHash,sha(auditRaw));assert.equal(supplement.proposalsHash,sha(proposalsRaw));
assert.equal(audit.resolverHash,sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')));
assert.equal(parent.productionApplyAllowed,false);if(!competitor)assert.ok(!parent.exactEngineResiduals);
if(competitor)assert.equal(supplement.matcherHash,sha(await readFile(resolve(root,'src/lib/mann-fluid-matcher-v2.ts'),'utf8')));
const byId=new Map(parent.newRevisions.map(r=>[r.id,r])),map=new Map(),history=[],residuals=[];
for(const item of supplement.replacements){
  const original=byId.get(item.originalRevisionId);assert.equal(sha(original),item.originalRevisionHash);
  if(competitor)assert.ok(parent.exactEngineReview.some(r=>r.originalRevisionId===original.id));
  const fresh=item.revision;
  assert.equal(original.sourceRequirementId,fresh.sourceRequirementId);assert.equal(original.vehicleVariantKey,fresh.vehicleVariantKey);
  assert.deepEqual(original.technicalDataJson,fresh.technicalDataJson);assert.deepEqual(original.replacesRevisionIds,fresh.replacesRevisionIds);
  assert.deepEqual({...fresh.applicabilityJson,matchedEngineScope:original.applicabilityJson.matchedEngineScope},original.applicabilityJson);
  const excluded=[...new Set(item.residuals.flatMap(r=>r.excludedEngineCodes))];
  assert.deepEqual(new Set([...fresh.applicabilityJson.matchedEngineScope,...excluded]),new Set(original.applicabilityJson.matchedEngineScope));
  assert.ok(!fresh.applicabilityJson.matchedEngineScope.some(c=>excluded.includes(c)));
  const fingerprint=sha({policy:fresh.provenanceJson.catalogPreviewPolicy,sourceRequirementId:fresh.sourceRequirementId,
    vehicleVariantKey:fresh.vehicleVariantKey,applicability:fresh.applicabilityJson,technicalData:fresh.technicalDataJson});
  assert.equal(fresh.semanticFingerprint,fingerprint);assert.equal(fresh.id,`mtar_${fingerprint.slice(0,24)}`);
  assert.equal(fresh.applyEligible,false);assert.equal(fresh.verificationStatus,'UNVERIFIED');
  assert.ok(!map.has(original.id));map.set(original.id,fresh);
  history.push({originalRevision:original,replacementRevisionId:fresh.id});
  residuals.push({originalRevision:original,replacementRevisionId:fresh.id,excludedEngineCodes:excluded,
    pendingWindow:original.applicabilityJson.window.intersection,publicationAllowed:false});
}
const newRevisions=parent.newRevisions.map(r=>map.get(r.id)??r);assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
const actionHistory=[];
const existingActions=parent.existingActions.map(action=>{
  const successors=action.successorIds??(action.successorId?[action.successorId]:[]),proposed=action.proposedSuccessorIds??[];
  if(![...successors,...proposed].some(id=>map.has(id)))return action;
  assert.notEqual(action.action,'PRESERVE_PROTECTED');actionHistory.push(action);
  const ids=[...new Set([...successors,...proposed].map(id=>map.get(id)?.id??id))];
  const {successorId,successorIds,proposedSuccessorIds,...rest}=action;
  return {...rest,action:'REVIEW_SOURCE_ENGINE_SCOPE',proposedSuccessorIds:ids};
});
const ids=new Set(newRevisions.map(r=>r.id));
for(const a of existingActions)for(const id of [...(a.successorIds??(a.successorId?[a.successorId]:[])),...(a.proposedSuccessorIds??[])])assert.ok(ids.has(id));
assert.deepEqual(existingActions.filter(a=>a.action==='PRESERVE_PROTECTED'),parent.existingActions.filter(a=>a.action==='PRESERVE_PROTECTED'));
const review=[...audit.results.filter(r=>r.status==='REVIEW').map(r=>({sourceRequirementId:r.sourceRequirementId,originalRevisionId:r.originalRevisionId,reason:'FULL_MAKE_AMBIGUITY',evidence:r})),
  ...proposals.proposals.filter(r=>r.status==='CAPACITY_BRANCH_REPLAY_REQUIRED').map(r=>({sourceRequirementId:r.sourceRequirementId,originalRevisionId:r.originalRevisionId,reason:'CAPACITY_FULL_MAKE_RECHECK_PENDING',evidence:r}))];
if(competitor)assert.deepEqual(new Set(review.map(r=>r.originalRevisionId)),new Set(parent.exactEngineReview.filter(r=>!map.has(r.originalRevisionId)).map(r=>r.originalRevisionId)));
const allResiduals=[...(parent.exactEngineResiduals??[]),...residuals];
const plan={...parent,newRevisions,existingActions,exactEngineResiduals:allResiduals,exactEngineReview:review,
  exactEngineHistory:{revisions:history,actions:actionHistory,parentPath,parentHash:sha(raw),supplementHash:sha(supplementRaw),...(competitor?{previousHistory:parent.exactEngineHistory}:{})},
  summary:{...parent.summary,exactEngineReplacements:(parent.summary.exactEngineReplacements??0)+map.size,exactEngineResiduals:allResiduals.length,exactEnginePendingRevisions:review.length,
    actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
const out=resolve(root,competitor?'outputs/mann-exact-engine-v10-preview-2026-09-14':'outputs/mann-exact-engine-preview-2026-09-14');await mkdir(out);
const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
await writeFile(resolve(out,'merge-verification.json'),JSON.stringify({planHash:sha(serialized),parentHash:sha(raw),replacements:map.size,
  unchanged:parent.newRevisions.length-map.size,changedActions:actionHistory.length,allOriginalRecordsPreserved:true,
  residuals:residuals.length,pendingReviews:review.length,noDanglingSuccessors:true,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,...plan.summary},null,2));
