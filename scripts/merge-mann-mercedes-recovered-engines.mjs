import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--compressed'));
const compressed=process.argv[2]==='--compressed',count=compressed?2:14;
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,compressed?'outputs/mann-mercedes-engine-preview-2026-09-14':'outputs/mann-rf-market-preview-2026-09-14');
const version=compressed?'v2':'v1';
const [raw,supplementRaw,auditRaw]=await Promise.all(['plan.json',`mercedes-recovered-engine-supplement-${version}.json`,`mercedes-source-engine-recheck-${version}.json`].map(f=>readFile(resolve(dir,f),'utf8')));
const parent=JSON.parse(raw),supplement=JSON.parse(supplementRaw),audit=JSON.parse(auditRaw);
assert.equal(supplement.planHash,sha(raw));assert.equal(audit.planHash,sha(raw));assert.equal(supplement.auditHash,sha(auditRaw));
for(const [field,file] of [['matcherHash','mann-fluid-matcher-v2.ts'],['resolverHash','mann-vehicle-resolver.ts'],['applicabilityHash','mann-technical-applicability.ts'],['profileHash','mann-unified-technical-profile.ts']])assert.equal(supplement[field],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
assert.equal(audit.helperHash,sha(await readFile(resolve(root,'scripts/lib/mann-mercedes-source-engine.mjs'),'utf8')));
for(const [field,path] of [['sourceHash','/tmp/vehicle_fluid_requirements.sql'],['mannHash','/tmp/mann_filter_applications.sql'],['rawHash',resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson')]])assert.equal(audit[field],sha(await readFile(path,'utf8')));
assert.deepEqual(supplement.summary,compressed?{replacements:2,checks:452,visible:109}:{replacements:14,checks:2196,visible:666});
if(compressed)assert.equal(audit.targetParserHash,sha(await readFile(resolve(root,'src/lib/mann-engine-code-list.ts'),'utf8')));
const map=new Map(),history=[],residuals=[];
for(const item of supplement.replacements){
  const old=parent.newRevisions.find(r=>r.id===item.originalRevisionId),fresh=item.revision;
  assert.equal(sha(old),item.originalRevisionHash);assert.deepEqual(item.residual.originalRevision,old);
  const finding=audit.results.find(r=>r.revisionId===old.id);assert.equal(finding.status,'SOURCE_ENGINE_RECOVERY_CONFIRMED');
  assert.equal(finding.target.independentlyValidated,true);assert.equal(finding.revisionHash,sha(old));
  assert.deepEqual(fresh.applicabilityJson,{...old.applicabilityJson,matchedEngineScope:finding.exactCodes});
  assert.deepEqual(fresh.technicalDataJson,old.technicalDataJson);assert.deepEqual(fresh.replacesRevisionIds,old.replacesRevisionIds);
  assert.deepEqual(item.residual.requiredCondition,{kind:'REVIEW_PREVIOUSLY_UNRESTRICTED_ENGINE_SCOPE',acceptedEngineScope:finding.exactCodes});
  assert.deepEqual(item.residual.pendingWindow,old.applicabilityJson.window.intersection);
  assert.deepEqual(item.residual.excludedSourceCodes,finding.sourceCodes.filter(c=>!finding.exactCodes.includes(c)));
  assert.deepEqual(item.residual.excludedTargetCodes,finding.targetCodes.filter(c=>!finding.exactCodes.includes(c)));
  assert.equal(fresh.applyEligible,false);assert.equal(fresh.verificationStatus,'UNVERIFIED');
  const fingerprint=sha({policy:old.provenanceJson.catalogPreviewPolicy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,applicability:fresh.applicabilityJson,technicalData:fresh.technicalDataJson});
  assert.equal(fresh.semanticFingerprint,fingerprint);assert.equal(fresh.id,`mtar_${fingerprint.slice(0,24)}`);
  assert.ok(!map.has(old.id));map.set(old.id,fresh);history.push({originalRevision:old,replacementRevisionId:fresh.id});residuals.push(item.residual);
}
assert.equal(map.size,count);
const actionHistory=[];
const existingActions=parent.existingActions.map(a=>{
  const refs=[...(a.successorIds??(a.successorId?[a.successorId]:[])),...(a.proposedSuccessorIds??[])];
  if(!refs.some(id=>map.has(id)))return a;
  assert.notEqual(a.action,'PRESERVE_PROTECTED');actionHistory.push(a);
  const {successorId,successorIds,proposedSuccessorIds,...rest}=a;
  return {...rest,action:'REVIEW_SOURCE_ENGINE_SCOPE',proposedSuccessorIds:[...new Set(refs.map(id=>map.get(id)?.id??id))]};
});
const newRevisions=parent.newRevisions.map(r=>map.get(r.id)??r),ids=new Set(newRevisions.map(r=>r.id));
assert.equal(ids.size,parent.newRevisions.length);
for(const a of existingActions)for(const id of [...(a.successorIds??(a.successorId?[a.successorId]:[])),...(a.proposedSuccessorIds??[])])assert.ok(ids.has(id));
const plan={...parent,newRevisions,existingActions,
  sourceEngineRecoveryResiduals:[...(parent.sourceEngineRecoveryResiduals??[]),...residuals],
  sourceEngineRecoveryHistory:{previousHistory:parent.sourceEngineRecoveryHistory??null,parentPath:resolve(dir,'plan.json'),parentHash:sha(raw),supplementHash:sha(supplementRaw),revisions:history,actions:actionHistory},
  summary:{...parent.summary,mercedesSourceEngineReplacements:(parent.summary.mercedesSourceEngineReplacements??0)+count,actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
for(const key of Object.keys(parent).filter(k=>!['newRevisions','existingActions','summary','sourceEngineRecoveryResiduals','sourceEngineRecoveryHistory'].includes(k)))assert.deepEqual(plan[key],parent[key]);
const out=resolve(root,compressed?'outputs/mann-mercedes-compressed-preview-2026-09-14':'outputs/mann-mercedes-engine-preview-2026-09-14');await mkdir(out);
const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
await writeFile(resolve(out,'merge-verification.json'),JSON.stringify({planHash:sha(serialized),parentHash:sha(raw),replacements:count,unchangedRevisions:newRevisions.length-count,changedActions:actionHistory.length,residuals:count,noDanglingSuccessors:true,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,hash:sha(serialized),revisions:newRevisions.length,changedActions:actionHistory.length}));
