import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-non-ru-market-guarded-preview-2026-09-14');
const [raw,draftRaw,proofRaw,recheckRaw,partitionRaw,sourceProofRaw,sql]=await Promise.all(['plan.json','source-market-month-drafts-v1.json','source-market-month-draft-verification-v1.json','source-market-month-identity-recheck-v1.json','source-market-month-partition-v1.json','source-market-month-partition-verification-v1.json'].map(f=>readFile(resolve(dir,f),'utf8')).concat(readFile('/tmp/vehicle_fluid_requirements.sql','utf8')));
const parent=JSON.parse(raw),draft=JSON.parse(draftRaw),proof=JSON.parse(proofRaw),recheck=JSON.parse(recheckRaw),partition=JSON.parse(partitionRaw),sourceProof=JSON.parse(sourceProofRaw);
for(const r of [draft,proof,recheck,partition,sourceProof])assert.equal(r.planHash,sha(raw));assert.equal(proof.draftHash,sha(draftRaw));assert.equal(draft.recheckHash,sha(recheckRaw));assert.equal(draft.partitionHash,sha(partitionRaw));assert.equal(sourceProof.partitionHash,sha(partitionRaw));assert.equal(draft.sourceHash,sha(sql));assert.equal(sourceProof.sourceHash,sha(sql));
assert.equal(sourceProof.rawHash,sha(await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')));assert.equal(recheck.mannHash,sha(await readFile('/tmp/mann_filter_applications.sql','utf8')));
for(const[file,hash]of Object.entries(draft.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
assert.deepEqual(proof.summary,{drafts:121,representedProposalBranches:123,negativeChecks:2840,sourcePartitions:103,pendingIntervals:242});
const liveRaw=await readFile(resolve(root,parent.inputFiles.live),'utf8');assert.equal(sha(liveRaw),parent.inputHashes.live);const live=new Map(JSON.parse(liveRaw).map(r=>[r.id,r]));
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r])),oldRows=new Map(parent.newRevisions.map(r=>[r.id,r])),reviews=new Map(parent.sourceMarketScopeReview.map(e=>[e.revision.id,e])),groups=Map.groupBy(draft.drafts,d=>d.originalRevisionId);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts'),denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const revisionHistory=[],reviewHistory=[],actionHistory=[],held=[],pending=[];
for(const [oldId,entries]of groups){
 const old=oldRows.get(oldId),source=sources.get(old.sourceRequirementId),review=reviews.get(oldId);assert.ok(review);assert.deepEqual(review.originalSource,source);assert.equal(sha(old),entries[0].originalRevisionHash);assert.ok(!denied.has(originalAssociationFingerprint(old.vehicleVariantKey,source,parse(source.fillVolumeText,source.systemCode))));
 for(const d of entries){const r=d.revision;assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.ok(['STAGED','REVIEW'].includes(r.state));assert.equal(r.sourceRequirementId,old.sourceRequirementId);assert.equal(r.vehicleVariantKey,old.vehicleVariantKey);assert.deepEqual(r.replacesRevisionIds,old.replacesRevisionIds);assert.ok(!oldRows.has(r.id));
  const t=structuredClone(r.technicalDataJson);for(let i=0;i<(t.capacityBranches??[]).length;i++)t.capacityBranches[i].applicabilityJson=old.technicalDataJson.capacityBranches[i].applicabilityJson;assert.deepEqual(t,old.technicalDataJson);
  const policy=r.provenanceJson.catalogPreviewPolicy??r.provenanceJson.conditionalTransmissionPolicy??r.provenanceJson.conditionalEquipmentPolicy;
  const fingerprint=policy==='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1'?sha({key:`${r.sourceRequirementId}:${r.vehicleVariantKey}`,policy,applicabilityJson:r.applicabilityJson,technicalDataJson:r.technicalDataJson}):policy==='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1'?sha({policy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technicalData:r.technicalDataJson}):sha({policy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicabilityJson:r.applicabilityJson,technicalDataJson:r.technicalDataJson});assert.equal(fingerprint,r.semanticFingerprint);assert.equal(r.id,`mtar_${fingerprint.slice(0,24)}`);
 }
 revisionHistory.push({originalRevision:old,replacementRevisionIds:entries.map(d=>d.revision.id)});
}
for(const f of recheck.findings.filter(f=>f.branches.some(b=>b.identityReasons.length))){
 assert.ok(f.branches.every(b=>b.identityReasons.length));assert.ok(!groups.has(f.revisionId));const review=reviews.get(f.revisionId);assert.ok(review);assert.equal(sha(review.revision),f.revisionHash);
 held.push({...review,reason:'SOURCE_MARKET_MONTH_IDENTITY_REQUIRES_REVIEW',identityEvidence:{reasons:[...new Set(f.branches.flatMap(b=>b.identityReasons))],recheck:f},publicationAllowed:false});
}
const heldIds=new Set(held.map(h=>h.revision.id));assert.equal(heldIds.size,22);
for(const p of proof.sourcePartitions){
 const old=oldRows.get(p.originalRevisionId),source=sources.get(p.sourceRequirementId),f=recheck.findings.find(f=>f.revisionId===old.id);assert.equal(sha(source),f.sourceHash);
 assert.deepEqual(p.replacementRevisionIds,(groups.get(old.id)??[]).map(d=>d.revision.id));
 for(const b of p.branches)for(const window of b.pendingWindows)pending.push({originalRevisionId:old.id,sourceRequirementId:source.id,originalSource:source,sourceHash:sha(source),sourceEngineBranch:{engineCode:b.engineCode,powerHp:b.powerHp,requiredMarket:b.requiredMarket},sourceWindow:b.sourceWindow,window,requiredTransmission:old.applicabilityJson.requiredTransmission??null,requiredEquipment:old.applicabilityJson.requiredEquipment??null,originalApplicability:old.applicabilityJson,candidateRevisionIds:p.replacementRevisionIds,reason:'SOURCE_MARKET_ENGINE_POWER_MONTH_NOT_COVERED',publicationAllowed:false});
}
assert.equal(pending.length,242);
const sourceMarketScopeReview=parent.sourceMarketScopeReview.flatMap(e=>{
 if(!groups.has(e.revision.id)&&!heldIds.has(e.revision.id))return[e];reviewHistory.push(e);if(heldIds.has(e.revision.id))return[];
 return groups.get(e.revision.id).map(d=>({...e,revision:d.revision,originalRevisionId:e.revision.id,originalReviewHash:sha(e),reason:'MARKET_MONTH_REPAIRED_SOURCE_BRANCH_REVIEW_REMAINS',monthProofHash:sha(proofRaw),sourceMonthPartition:proof.sourcePartitions.find(p=>p.originalRevisionId===e.revision.id)}));
});
const existingActions=parent.existingActions.map(a=>{
 const refs=[...new Set([a.successorId,...(a.successorIds??[]),...(a.proposedSuccessorIds??[])].filter(Boolean))];if(!refs.some(id=>groups.has(id)||heldIds.has(id)))return a;
 assert.notEqual(a.action,'PRESERVE_PROTECTED');const prior=live.get(a.revisionId);assert.ok(prior);assert.equal(prior.state,a.expectedState);assert.equal(prior.semanticFingerprint,a.expectedSemanticFingerprint);assert.equal(prior.verificationStatus,'UNVERIFIED');assert.equal(prior.reviewConfirmed,false);actionHistory.push(a);
 const {successorIds,...rest}=a;return{...rest,action:'REVIEW_SOURCE_MARKET_MONTH_SCOPE',successorId:null,proposedSuccessorIds:[...new Set(refs.filter(id=>!heldIds.has(id)).flatMap(id=>groups.has(id)?groups.get(id).map(d=>d.revision.id):[id]))],withheldSuccessorIds:[...new Set([...(a.withheldSuccessorIds??[]),...refs.filter(id=>heldIds.has(id))])]};
});
const newRevisions=parent.newRevisions.flatMap(r=>heldIds.has(r.id)?[]:groups.has(r.id)?groups.get(r.id).map(d=>d.revision):[r]);assert.equal(newRevisions.length,1888);assert.equal(new Set(newRevisions.map(r=>r.id)).size,1888);
for(const a of existingActions)for(const id of [a.successorId,...(a.successorIds??[]),...(a.proposedSuccessorIds??[])].filter(Boolean))assert.ok(!groups.has(id)&&!heldIds.has(id));
const plan={...parent,newRevisions,existingActions,sourceMarketScopeReview,sourceMarketIdentityHeld:[...parent.sourceMarketIdentityHeld,...held],sourceMarketMonthPending:[...(parent.sourceMarketMonthPending??[]),...pending],sourceMarketMonthHistory:{previous:parent.sourceMarketMonthHistory??null,parentPath:resolve(dir,'plan.json'),parentHash:sha(raw),draftHash:sha(draftRaw),proofHash:sha(proofRaw),revisionHistory,reviewHistory,actionHistory,sourcePartitions:proof.sourcePartitions},summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,sourceMarketScopeReview:sourceMarketScopeReview.length,sourceMarketIdentityHeld:parent.sourceMarketIdentityHeld.length+held.length,sourceMarketMonthPending:pending.length,actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
for(const k of Object.keys(parent).filter(k=>!['newRevisions','existingActions','sourceMarketScopeReview','sourceMarketIdentityHeld','sourceMarketMonthPending','sourceMarketMonthHistory','summary'].includes(k)))assert.deepEqual(plan[k],parent[k]);
const out=resolve(root,'outputs/mann-market-month-scoped-preview-2026-09-14');await mkdir(out);const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
const result={planHash:sha(serialized),parentHash:sha(raw),replacedOld:groups.size,newDrafts:121,newIdentityHolds:22,pendingIntervals:pending.length,candidates:1888,sources:plan.summary.sourceRequirements,changedActions:actionHistory.length,productionApplyAllowed:false};await writeFile(resolve(out,'merge-verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
