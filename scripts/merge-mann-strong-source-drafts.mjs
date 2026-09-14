import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&['alphanumeric','equipment','drive','years','type-count'].includes(process.argv[2])));
const typeCount=process.argv[2]==='type-count',years=process.argv[2]==='years',drive=process.argv[2]==='drive',equipment=drive||process.argv[2]==='equipment',alpha=typeCount||years||equipment||process.argv[2]==='alphanumeric',expected=typeCount?2:years?2:drive?10:equipment?12:alpha?11:7,expectedPending=typeCount?0:years?1:alpha?12:10;
const [draftRaw,proofRaw,summaryRaw]=await Promise.all([typeCount?'transmission-type-count-drafts-v1.json':years?'gearbox-year-drafts-v2.json':drive?'equipment-drive-drafts-v1.json':equipment?'equipment-model-drafts-v1.json':alpha?'alphanumeric-box-drafts-v1.json':'strong-source-drafts-v1.json',typeCount?'transmission-type-count-draft-verification-v1.json':years?'gearbox-year-draft-verification-v2.json':drive?'equipment-drive-draft-verification-v1.json':equipment?'equipment-model-draft-verification-v1.json':alpha?'alphanumeric-box-draft-verification-v1.json':'strong-source-draft-verification-v1.json','summary.json'].map(f=>readFile(resolve(dir,f),'utf8')));
const draft=JSON.parse(draftRaw),proof=JSON.parse(proofRaw),summary=JSON.parse(summaryRaw),parentPath=alpha?draft.parentPath:summary.planPath,parentRaw=await readFile(parentPath,'utf8'),parent=JSON.parse(parentRaw),entries=alpha?draft.drafts:draft.revisionDrafts;
assert.equal(proof.draftHash,sha(draftRaw));assert.equal(proof.planHash,sha(parentRaw));assert.equal(draft.planHash,sha(parentRaw));assert.equal(proof.checked,expected);assert.equal(entries.length,expected);
for(const [file,hash]of Object.entries(alpha?draft.codeHashes:proof.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
assert.equal(proof.sourceHash,sha(await readFile('/tmp/vehicle_fluid_requirements.sql','utf8')));assert.equal(alpha?draft.denylistHash:proof.denylistHash,sha(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')));
assert.equal(summary.mannHash,sha(await readFile('/tmp/mann_filter_applications.sql','utf8')));
const liveRaw=await readFile(resolve(root,parent.inputFiles.live),'utf8');assert.equal(sha(liveRaw),draft.liveHash);const live=new Map(JSON.parse(liveRaw).map(r=>[r.id,r]));
const additions=entries.map(d=>d.revision),byPrior=new Map(),pending=[],history=[];
for(const d of entries){
 const r=d.revision;assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.ok(!parent.newRevisions.some(p=>p.id===r.id||(p.sourceRequirementId===r.sourceRequirementId&&p.vehicleVariantKey===r.vehicleVariantKey)));
 assert.equal(sha(d.originalSource),d.sourceHash);
 if(years){assert.deepEqual(d.yearScope,r.provenanceJson.sourceComponentYearScope);assert.ok(d.yearScope.excludedBySourceCondition.length);assert.deepEqual(d.yearScope.qualifiedSourceWindow,r.applicabilityJson.window.source);}
 const policy=r.provenanceJson.catalogPreviewPolicy??r.provenanceJson.conditionalTransmissionPolicy??r.provenanceJson.conditionalEquipmentPolicy;
 const fp=policy==='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1'?sha({policy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technicalData:r.technicalDataJson}):sha({policy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicabilityJson:r.applicabilityJson,technicalDataJson:r.technicalDataJson});assert.equal(fp,r.semanticFingerprint);assert.equal(r.id,`mtar_${fp.slice(0,24)}`);
 for(const id of r.replacesRevisionIds){const prior=live.get(id);assert.ok(prior);assert.equal(prior.reviewConfirmed,false);assert.notEqual(prior.verificationStatus,'PRIMARY_SOURCE_VERIFIED_FIELDS');const ids=byPrior.get(id)??[];ids.push(r.id);byPrior.set(id,ids);}
 for(const window of d.pendingWindows)pending.push({sourceRequirementId:r.sourceRequirementId,originalSource:d.originalSource,sourceHash:d.sourceHash,sourceEngineBranch:{engineCodes:r.applicabilityJson.matchedEngineScope,powerHp:d.originalSource.powerHp,requiredMarket:null,...(drive?{requiredEquipment:r.applicabilityJson.requiredEquipment}:{})},sourceWindow:r.applicabilityJson.window.source,window,originalApplicability:r.applicabilityJson,candidateRevisionIds:[r.id],reason:'SOURCE_MONTHS_OUTSIDE_NEW_EXACT_TARGET_SCOPE',publicationAllowed:false});
}
if(drive){
 const groups=Map.groupBy(additions,r=>`${r.sourceRequirementId}:${r.vehicleVariantKey}`);assert.equal(groups.size,9);
 for(const group of groups.values()){
  const drives=group[0].provenanceJson.explicitComponentDriveCondition.drives;
  assert.deepEqual(group.map(r=>r.applicabilityJson.requiredEquipment.drive),drives);
  assert.equal(new Set(drives).size,drives.length);
  for(const r of group)assert.deepEqual(r.technicalDataJson,group[0].technicalDataJson);
 }
}
assert.equal(pending.length,expectedPending);
const touched=new Set(),existingActions=parent.existingActions.map(a=>{
 if(!byPrior.has(a.revisionId))return a;const prior=live.get(a.revisionId);assert.notEqual(a.action,'PRESERVE_PROTECTED');assert.equal(prior.state,a.expectedState);assert.equal(prior.semanticFingerprint,a.expectedSemanticFingerprint);history.push(a);touched.add(a.revisionId);
 const {successorIds,...rest}=a;return {...rest,action:'REVIEW_NEW_STRONG_SOURCE_CANDIDATE',successorId:null,proposedSuccessorIds:[...new Set([a.successorId,...(a.successorIds??[]),...(a.proposedSuccessorIds??[]),...byPrior.get(a.revisionId)].filter(Boolean))]};
});
assert.equal(touched.size,byPrior.size,'Every affected live revision must already have an action');
const newRevisions=[...parent.newRevisions,...additions];assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
const allPending=[...(parent.strongSourceDraftPending??[]),...pending];
const plan={...parent,newRevisions,existingActions,strongSourceDraftPending:allPending,strongSourceDraftHistory:{previous:parent.strongSourceDraftHistory??null,parentPath,parentHash:sha(parentRaw),draftHash:sha(draftRaw),proofHash:sha(proofRaw),originalDrafts:entries,reviewEntries:draft.reviewEntries??[],actionHistory:history},summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,strongSourceDraftPending:allPending.length,actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
for(const k of Object.keys(parent).filter(k=>!['newRevisions','existingActions','summary','strongSourceDraftPending','strongSourceDraftHistory'].includes(k)))assert.deepEqual(plan[k],parent[k]);
assert.deepEqual(plan.strongSourceDraftPending.slice(0,parent.strongSourceDraftPending?.length??0),parent.strongSourceDraftPending??[]);
assert.deepEqual(plan.strongSourceDraftHistory.previous,parent.strongSourceDraftHistory??null);
const out=resolve(root,typeCount?'outputs/mann-type-count-added-preview-2026-09-14':years?'outputs/mann-gearbox-year-added-preview-2026-09-14':drive?'outputs/mann-equipment-drive-added-preview-2026-09-14':equipment?'outputs/mann-equipment-model-added-preview-2026-09-14':alpha?'outputs/mann-alphanumeric-box-added-preview-2026-09-14':'outputs/mann-strong-source-added-preview-2026-09-14');await mkdir(out);const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
const result={planHash:sha(serialized),parentHash:sha(parentRaw),added:expected,pendingIntervals:expectedPending,totalStrongSourcePending:allPending.length,changedActions:history.length,candidates:newRevisions.length,sources:plan.summary.sourceRequirements,productionApplyAllowed:false};await writeFile(resolve(out,'merge-verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
