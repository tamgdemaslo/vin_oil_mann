import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-passat-cbab-inclusive-preview-2026-09-14');
const [raw,supplementRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'bmw-m-restoration-supplement-v1.json'),'utf8')]);
const parent=JSON.parse(raw),supplement=JSON.parse(supplementRaw);
assert.equal(supplement.planHash,sha(raw));assert.equal(supplement.productionApplyAllowed,false);assert.equal(parent.productionApplyAllowed,false);
const auditRaw=await readFile(resolve(dir,'bmw-m-source-body-recheck-v1.json'),'utf8');assert.equal(supplement.auditHash,sha(auditRaw));
assert.equal(JSON.parse(auditRaw).resolverHash,sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')));
const originalRaw=await readFile(parent.bodyQuarantineParent.path,'utf8');assert.equal(sha(originalRaw),parent.bodyQuarantineParent.sha256);
const original=JSON.parse(originalRaw),restored=new Map(),history=[],residuals=[];
for(const item of supplement.revisions){
  const held=parent.sourceBodyHeld.find(h=>h.revision.id===item.originalRevisionId);assert.ok(held);assert.equal(sha(held.revision),item.originalRevisionHash);
  const old=held.revision,fresh=item.revision;assert.ok(!parent.newRevisions.some(r=>r.id===fresh.id));
  assert.deepEqual(fresh.technicalDataJson,old.technicalDataJson);
  assert.equal(fresh.sourceRequirementId,old.sourceRequirementId);assert.equal(fresh.vehicleVariantKey,old.vehicleVariantKey);
  assert.deepEqual(fresh.replacesRevisionIds,old.replacesRevisionIds);
  assert.deepEqual({...fresh.applicabilityJson,matchedEngineScope:old.applicabilityJson.matchedEngineScope},old.applicabilityJson);
  assert.deepEqual(new Set([...fresh.applicabilityJson.matchedEngineScope,...item.excludedEngineCodes]),new Set(old.applicabilityJson.matchedEngineScope));
  assert.ok(!fresh.applicabilityJson.matchedEngineScope.some(c=>item.excludedEngineCodes.includes(c)));
  const fingerprint=sha({policy:fresh.provenanceJson.catalogPreviewPolicy,sourceRequirementId:fresh.sourceRequirementId,
    vehicleVariantKey:fresh.vehicleVariantKey,applicability:fresh.applicabilityJson,technicalData:fresh.technicalDataJson});
  assert.equal(fresh.semanticFingerprint,fingerprint);assert.equal(fresh.id,`mtar_${fingerprint.slice(0,24)}`);
  assert.equal(fresh.applyEligible,false);assert.equal(fresh.verificationStatus,'UNVERIFIED');
  restored.set(old.id,item);history.push({...held,restoredRevisionId:fresh.id});
  if(item.excludedEngineCodes.length)residuals.push({originalRevision:old,excludedEngineCodes:item.excludedEngineCodes,
    pendingWindow:old.applicabilityJson.window.intersection,reason:'SOURCE_ENGINES_NOT_CONFIRMED_ON_M_VARIANT',publicationAllowed:false});
}
const existingActions=parent.existingActions.map(action=>{
  if(action.action!=='REVIEW_SOURCE_BODY_CONFLICT')return action;
  const before=original.existingActions.find(a=>a.revisionId===action.revisionId);assert.ok(before);
  const successors=before.successorIds??(before.successorId?[before.successorId]:[]);
  assert.ok(successors.length);
  if(!successors.every(id=>restored.has(id)))return action;
  const entries=successors.map(id=>restored.get(id));
  if(entries.some(e=>e.excludedEngineCodes.length))return {...action,action:'REVIEW_SOURCE_ENGINE_SCOPE',proposedSuccessorIds:entries.map(e=>e.revision.id)};
  const {successorId,successorIds,...rest}=before,newIds=entries.map(e=>e.revision.id);
  return {...rest,...(newIds.length===1?{successorId:newIds[0]}:{successorIds:newIds})};
});
const newRevisions=[...parent.newRevisions,...supplement.revisions.map(r=>r.revision)];
assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
const ids=new Set(newRevisions.map(r=>r.id));
for(const action of existingActions)for(const id of [...(action.successorIds??(action.successorId?[action.successorId]:[])),...(action.proposedSuccessorIds??[])])assert.ok(ids.has(id));
assert.deepEqual(existingActions.filter(a=>a.action==='PRESERVE_PROTECTED'),parent.existingActions.filter(a=>a.action==='PRESERVE_PROTECTED'));
const sourceBodyHeld=parent.sourceBodyHeld.filter(h=>!restored.has(h.revision.id));
assert.equal(sourceBodyHeld.length+history.length,parent.sourceBodyHeld.length);
const plan={...parent,newRevisions,existingActions,sourceBodyHeld,sourceBodyResiduals:residuals,sourceBodyRestorationHistory:history,
  bodyRestoration:{parentPath:resolve(dir,'plan.json'),parentHash:sha(raw),supplementHash:sha(supplementRaw)},
  summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,
    sourceBodyHeld:sourceBodyHeld.length,sourceBodyResidualScopes:residuals.length,
    engineLineRevisions:newRevisions.filter(r=>r.provenanceJson.engineAnchorRowIds).length,
    actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
for(const field of ['rawDateWithheld','sourceQualityHeld','disputedYearPending','passatReview','passatDatePending','passatDateReview'])assert.deepEqual(plan[field],parent[field]);
const out=resolve(root,'outputs/mann-bmw-body-restored-preview-2026-09-14');await mkdir(out);
const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
await writeFile(resolve(out,'restoration-verification.json'),JSON.stringify({planHash:sha(serialized),parentHash:sha(raw),restored:restored.size,
  held:sourceBodyHeld.length,residuals:residuals.length,allOriginalHeldAccounted:true,protectedActionsUnchanged:true,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,...plan.summary},null,2));
