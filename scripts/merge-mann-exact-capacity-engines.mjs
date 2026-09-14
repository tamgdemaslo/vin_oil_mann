import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-exact-engine-v10-preview-2026-09-14');
const [raw,additionRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'exact-capacity-engine-replacements-v1.json'),'utf8')]);
const parent=JSON.parse(raw),addition=JSON.parse(additionRaw);assert.equal(addition.planHash,sha(raw));
for(const [field,file] of [['matcherHash','mann-fluid-matcher-v2.ts'],['resolverHash','mann-vehicle-resolver.ts']])assert.equal(addition[field],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
const map=new Map(),history=[],residuals=[];
for(const item of addition.replacements){
  const original=parent.newRevisions.find(r=>r.id===item.originalRevisionId),fresh=item.revision;assert.equal(sha(original),item.originalRevisionHash);
  assert.ok(parent.exactEngineReview.some(r=>r.originalRevisionId===original.id));
  assert.equal(fresh.applyEligible,false);assert.equal(fresh.verificationStatus,'UNVERIFIED');
  assert.deepEqual(fresh.replacesRevisionIds,original.replacesRevisionIds);
  assert.deepEqual({...fresh.technicalDataJson,capacityBranches:original.technicalDataJson.capacityBranches},original.technicalDataJson);
  assert.deepEqual({...fresh.applicabilityJson,matchedEngineScope:original.applicabilityJson.matchedEngineScope},original.applicabilityJson);
  assert.equal(fresh.technicalDataJson.capacityBranches.length,original.technicalDataJson.capacityBranches.length);
  for(const [i,branch] of fresh.technicalDataJson.capacityBranches.entries()){
    const old=original.technicalDataJson.capacityBranches[i],residual=item.residuals.find(r=>r.scopeIndex===i);assert.ok(residual);
    assert.deepEqual({...branch,applicabilityJson:old.applicabilityJson,validation:old.validation},old);
    assert.deepEqual({...branch.applicabilityJson,matchedEngineScope:old.applicabilityJson.matchedEngineScope},old.applicabilityJson);
    assert.deepEqual(new Set([...branch.applicabilityJson.matchedEngineScope,...residual.excludedEngineCodes]),new Set(old.applicabilityJson.matchedEngineScope));
    assert.ok(!branch.applicabilityJson.matchedEngineScope.some(c=>residual.excludedEngineCodes.includes(c)));
    residuals.push({originalRevision:original,scopeIndex:i,requiredCondition:old.condition,excludedEngineCodes:residual.excludedEngineCodes,
      pendingWindow:old.applicabilityJson.window.intersection,publicationAllowed:false});
  }
  const union=new Set(fresh.technicalDataJson.capacityBranches.flatMap(b=>b.applicabilityJson.matchedEngineScope));
  assert.deepEqual(new Set(fresh.applicabilityJson.matchedEngineScope),union);
  const fingerprint=sha({key:`${fresh.sourceRequirementId}:${fresh.vehicleVariantKey}`,policy:fresh.provenanceJson.catalogPreviewPolicy,
    applicabilityJson:fresh.applicabilityJson,technicalDataJson:fresh.technicalDataJson});
  assert.equal(fingerprint,fresh.semanticFingerprint);assert.equal(fresh.id,`mtar_${fingerprint.slice(0,24)}`);
  map.set(original.id,fresh);history.push({originalRevision:original,replacementRevisionId:fresh.id});
}
const newRevisions=parent.newRevisions.map(r=>map.get(r.id)??r);assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
const actionHistory=[];
const existingActions=parent.existingActions.map(a=>{
  const refs=[...(a.successorIds??(a.successorId?[a.successorId]:[])),...(a.proposedSuccessorIds??[])];
  if(!refs.some(id=>map.has(id)))return a;
  assert.notEqual(a.action,'PRESERVE_PROTECTED');actionHistory.push(a);
  const {successorId,successorIds,proposedSuccessorIds,...rest}=a;
  return {...rest,action:'REVIEW_SOURCE_ENGINE_SCOPE',proposedSuccessorIds:[...new Set(refs.map(id=>map.get(id)?.id??id))]};
});
const ids=new Set(newRevisions.map(r=>r.id));
for(const a of existingActions)for(const id of [...(a.successorIds??(a.successorId?[a.successorId]:[])),...(a.proposedSuccessorIds??[])])assert.ok(ids.has(id));
const exactEngineReview=parent.exactEngineReview.filter(r=>!map.has(r.originalRevisionId));
const plan={...parent,newRevisions,existingActions,exactEngineReview,exactCapacityResiduals:residuals,
  exactCapacityHistory:{parentPath:resolve(dir,'plan.json'),parentHash:sha(raw),additionHash:sha(additionRaw),revisions:history,actions:actionHistory},
  summary:{...parent.summary,exactCapacityEngineReplacements:map.size,exactCapacityResidualScopes:residuals.length,exactEnginePendingRevisions:exactEngineReview.length,
    actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
const out=resolve(root,'outputs/mann-exact-capacity-engine-preview-2026-09-14');await mkdir(out);
const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
await writeFile(resolve(out,'merge-verification.json'),JSON.stringify({planHash:sha(serialized),parentHash:sha(raw),replacements:map.size,
  residualScopes:residuals.length,changedActions:actionHistory.length,allOriginalRecordsPreserved:true,noDanglingSuccessors:true,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,...plan.summary},null,2));
