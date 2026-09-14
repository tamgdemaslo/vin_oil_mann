import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-exact-capacity-engine-preview-2026-09-14');
const [raw,proofRaw,auditRaw]=await Promise.all(['plan.json','rf-market-request-verification-v1.json','recovered-rf-engine-recheck-v1.json'].map(f=>readFile(resolve(dir,f),'utf8')));
const parent=JSON.parse(raw),proof=JSON.parse(proofRaw),audit=JSON.parse(auditRaw);
assert.equal(proof.planHash,sha(raw));assert.equal(audit.planHash,sha(raw));assert.equal(proof.auditHash,sha(auditRaw));
for(const [report,field,file] of [[proof,'applicabilityHash','mann-technical-applicability.ts'],[proof,'profileHash','mann-unified-technical-profile.ts'],[proof,'requestContextHash','mann-technical-request-context.ts'],[proof,'vehicleIdentityHash','vehicle-identity.ts'],[proof,'vehicleMarketHash','vehicle-market.ts'],[audit,'matcherHash','mann-fluid-matcher-v2.ts'],[audit,'resolverHash','mann-vehicle-resolver.ts']])assert.equal(report[field],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
assert.equal(audit.sourceHash,sha(await readFile('/tmp/vehicle_fluid_requirements.sql','utf8')));
assert.equal(audit.mannHash,sha(await readFile('/tmp/mann_filter_applications.sql','utf8')));
assert.deepEqual(proof.summary,{proposals:2,checks:1638,visible:178});
const replacements=new Map(),history=[],residuals=[];
for(const proposal of proof.proposals){
  const old=parent.newRevisions.find(r=>r.id===proposal.originalRevisionId);
  assert.equal(sha(old),proposal.originalRevisionHash);
  const finding=audit.results.find(r=>r.revisionId===old.id);assert.equal(finding.revisionHash,sha(old));
  assert.equal(finding.target.independentlyValidated,true);
  assert.deepEqual(finding.sourceConditions,{powerHp:83,fuelType:'diesel',market:'Россия'});
  assert.deepEqual(finding.reasons,['SOURCE_RUSSIA_MARKET_CONDITION_NOT_YET_VERIFIED']);
  assert.deepEqual(proposal.proposedApplicability,{...old.applicabilityJson,matchedEngineScope:['RF'],requiredMarket:'RU'});
  assert.ok(!old.technicalDataJson.capacityBranches);
  const fingerprint=sha({policy:old.provenanceJson.catalogPreviewPolicy,sourceRequirementId:old.sourceRequirementId,
    vehicleVariantKey:old.vehicleVariantKey,applicability:proposal.proposedApplicability,technicalData:old.technicalDataJson});
  const fresh={...old,id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,applicabilityJson:proposal.proposedApplicability,
    provenanceJson:{...old.provenanceJson,independentValidation:finding.target,sourceTechnicalReviewRequired:true,
      rfMarketRecovery:{originalRevisionId:old.id,originalRevisionHash:sha(old),proofHash:sha(proofRaw),auditHash:sha(auditRaw),sourceConditions:finding.sourceConditions}}};
  assert.equal(fresh.applyEligible,false);assert.equal(fresh.verificationStatus,'UNVERIFIED');
  assert.deepEqual(fresh.technicalDataJson,old.technicalDataJson);assert.deepEqual(fresh.replacesRevisionIds,old.replacesRevisionIds);
  replacements.set(old.id,fresh);history.push({originalRevision:old,replacementRevisionId:fresh.id});
  residuals.push({originalRevision:old,pendingWindow:old.applicabilityJson.window.intersection,
    requiredCondition:{kind:'REVIEW_PREVIOUSLY_UNRESTRICTED_SCOPE',acceptedEngineScope:['RF'],acceptedMarket:'RU'},
    reason:'Other engines/markets were never source-confirmed; unknown market requires vehicle evidence, not automatic replacement.',publicationAllowed:false});
}
assert.equal(replacements.size,2);
const actionHistory=[];
const existingActions=parent.existingActions.map(action=>{
  const refs=[...(action.successorIds??(action.successorId?[action.successorId]:[])),...(action.proposedSuccessorIds??[])];
  if(!refs.some(id=>replacements.has(id)))return action;
  assert.notEqual(action.action,'PRESERVE_PROTECTED');actionHistory.push(action);
  const {successorId,successorIds,proposedSuccessorIds,...rest}=action;
  return {...rest,action:'REVIEW_SOURCE_MARKET_ENGINE_SCOPE',proposedSuccessorIds:[...new Set(refs.map(id=>replacements.get(id)?.id??id))]};
});
const newRevisions=parent.newRevisions.map(r=>replacements.get(r.id)??r),ids=new Set(newRevisions.map(r=>r.id));
assert.equal(ids.size,parent.newRevisions.length);
for(const action of existingActions)for(const id of [...(action.successorIds??(action.successorId?[action.successorId]:[])),...(action.proposedSuccessorIds??[])])assert.ok(ids.has(id));
const plan={...parent,newRevisions,existingActions,sourceMarketResiduals:[...(parent.sourceMarketResiduals??[]),...residuals],
  sourceMarketHistory:{previousHistory:parent.sourceMarketHistory??null,parentPath:resolve(dir,'plan.json'),parentHash:sha(raw),proofHash:sha(proofRaw),revisions:history,actions:actionHistory},
  summary:{...parent.summary,rfMarketRecoveredRevisions:2,actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
for(const key of Object.keys(parent).filter(k=>!['newRevisions','existingActions','summary','sourceMarketHistory','sourceMarketResiduals'].includes(k)))assert.deepEqual(plan[key],parent[key]);
const out=resolve(root,'outputs/mann-rf-market-preview-2026-09-14');await mkdir(out);
const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
await writeFile(resolve(out,'merge-verification.json'),JSON.stringify({planHash:sha(serialized),parentHash:sha(raw),replacements:2,unchangedRevisions:newRevisions.length-2,changedActions:actionHistory.length,residuals:residuals.length,noDanglingSuccessors:true,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,hash:sha(serialized),revisions:newRevisions.length,changedActions:actionHistory.length}));
