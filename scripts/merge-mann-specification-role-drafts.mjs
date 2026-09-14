import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-market-month-scoped-preview-2026-09-14');
const [raw,draftRaw,proofRaw,auditRaw,sql]=await Promise.all(['plan.json','specification-role-drafts-v1.json','specification-role-draft-verification-v1.json','specification-attribution-v2.json'].map(f=>readFile(resolve(dir,f),'utf8')).concat(readFile('/tmp/vehicle_fluid_requirements.sql','utf8')));
const parent=JSON.parse(raw),draft=JSON.parse(draftRaw),proof=JSON.parse(proofRaw),audit=JSON.parse(auditRaw);
assert.equal(draft.planHash,sha(raw));assert.equal(proof.planHash,sha(raw));assert.equal(proof.draftHash,sha(draftRaw));assert.equal(proof.auditHash,sha(auditRaw));assert.equal(draft.auditHash,sha(auditRaw));assert.equal(draft.sourceHash,sha(sql));assert.equal(proof.checked,142);assert.equal(draft.drafts.length,142);assert.equal(draft.held.length,0);
for(const [file,hash]of Object.entries({...audit.codeHashes,...draft.codeHashes}))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const mannHash=sha(await readFile('/tmp/mann_filter_applications.sql','utf8'));assert.equal(mannHash,'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const rawSourceHash=sha(await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8'));assert.equal(rawSourceHash,'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const liveRaw=await readFile(resolve(root,parent.inputFiles.live),'utf8');assert.equal(sha(liveRaw),parent.inputHashes.live);
const live=new Map(JSON.parse(liveRaw).map(r=>[r.id,r])),sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const replacements=new Map(draft.drafts.map(d=>[d.originalRevisionId,d.revision]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const deniedRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8'),denied=new Set(JSON.parse(deniedRaw).rejectedAssociationFingerprints);
for(const d of draft.drafts){
 const old=parent.newRevisions.find(r=>r.id===d.originalRevisionId),r=d.revision,source=sources.get(r.sourceRequirementId);
 assert.equal(sha(old),d.originalRevisionHash);assert.deepEqual(source,d.originalSource);
 assert.ok(!denied.has(originalAssociationFingerprint(r.vehicleVariantKey,source,parse(source.fillVolumeText,source.systemCode))));
 assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.deepEqual(r.applicabilityJson,old.applicabilityJson);
 const policy=r.provenanceJson.catalogPreviewPolicy??r.provenanceJson.conditionalTransmissionPolicy??r.provenanceJson.conditionalEquipmentPolicy;
 const fingerprint=policy==='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1'?sha({key:`${r.sourceRequirementId}:${r.vehicleVariantKey}`,policy,applicabilityJson:r.applicabilityJson,technicalDataJson:r.technicalDataJson}):policy==='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1'?sha({policy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technicalData:r.technicalDataJson}):sha({policy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicabilityJson:r.applicabilityJson,technicalDataJson:r.technicalDataJson});
 assert.equal(fingerprint,r.semanticFingerprint);assert.equal(r.id,`mtar_${fingerprint.slice(0,24)}`);
}
const remap=id=>replacements.get(id)?.id??id,history={previous:parent.sourceSpecificationRoleHistory??null,parentPath:resolve(dir,'plan.json'),parentHash:sha(raw),draftHash:sha(draftRaw),proofHash:sha(proofRaw),auditHash:sha(auditRaw),revisionHistory:[],actionHistory:[],queueHistory:[]};
const newRevisions=parent.newRevisions.map(r=>{const fresh=replacements.get(r.id);if(!fresh)return r;history.revisionHistory.push({originalRevision:r,replacementRevisionId:fresh.id});return fresh;});
assert.equal(newRevisions.length,parent.newRevisions.length);assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
const existingActions=parent.existingActions.map(a=>{
 const refs=[...new Set([a.successorId,...(a.successorIds??[]),...(a.proposedSuccessorIds??[])].filter(Boolean))];if(!refs.some(id=>replacements.has(id)))return a;
 assert.notEqual(a.action,'PRESERVE_PROTECTED');const current=live.get(a.revisionId);assert.ok(current);assert.equal(current.state,a.expectedState);assert.equal(current.semanticFingerprint,a.expectedSemanticFingerprint);assert.equal(current.verificationStatus,'UNVERIFIED');assert.equal(current.reviewConfirmed,false);history.actionHistory.push(a);
 const {successorIds,...rest}=a;return {...rest,action:'REVIEW_SOURCE_SPECIFICATION_ROLES',successorId:null,proposedSuccessorIds:refs.map(remap)};
});
const sourceMarketScopeReview=parent.sourceMarketScopeReview.map((e,index)=>{
 const fresh=replacements.get(e.revision.id),partition=e.sourceMonthPartition;
 if(!fresh&&!partition?.replacementRevisionIds.some(id=>replacements.has(id)))return e;
 history.queueHistory.push({queue:'sourceMarketScopeReview',index,originalEntry:e});
 return {...e,revision:fresh??e.revision,...(partition?{sourceMonthPartition:{...partition,replacementRevisionIds:partition.replacementRevisionIds.map(remap)}}:{}),specificationRoleReferenceRepair:{originalRevisionId:e.revision.id,originalEntryHash:sha(e),proofHash:sha(proofRaw),scopeUnchanged:true}};
});
const remapQueue=(name,key)=>parent[name].map((e,index)=>{
 const value=e[key],fresh=Array.isArray(value)?value.map(remap):remap(value);if(sha(fresh)===sha(value))return e;
 history.queueHistory.push({queue:name,index,originalEntry:e});return {...e,[key]:fresh};
});
const exactEngineResiduals=remapQueue('exactEngineResiduals','replacementRevisionId'),sourceMarketMonthPending=remapQueue('sourceMarketMonthPending','candidateRevisionIds');
const plan={...parent,newRevisions,existingActions,sourceMarketScopeReview,exactEngineResiduals,sourceMarketMonthPending,sourceSpecificationRoleHistory:history,
 summary:{...parent.summary,specificationRoleReplacements:142,actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
for(const k of Object.keys(parent).filter(k=>!['newRevisions','existingActions','sourceMarketScopeReview','exactEngineResiduals','sourceMarketMonthPending','summary'].includes(k)))assert.deepEqual(plan[k],parent[k]);
assert.deepEqual(new Set(newRevisions.map(r=>r.sourceRequirementId)),new Set(parent.newRevisions.map(r=>r.sourceRequirementId)));
for(const a of existingActions)for(const id of [a.successorId,...(a.successorIds??[]),...(a.proposedSuccessorIds??[])].filter(Boolean))assert.ok(!replacements.has(id));
const out=resolve(root,'outputs/mann-specification-role-scoped-preview-2026-09-14');await mkdir(out);
const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
const result={planHash:sha(serialized),parentHash:sha(raw),replacements:142,candidates:newRevisions.length,sources:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,changedActions:history.actionHistory.length,changedQueueEntries:history.queueHistory.length,mannHash,rawSourceHash,denylistHash:sha(deniedRaw),productionApplyAllowed:false};
await writeFile(resolve(out,'merge-verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
