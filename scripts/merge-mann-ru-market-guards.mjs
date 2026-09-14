import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
assert.ok(process.argv.length<=4&&(!process.argv[3]||process.argv[3]==='non-ru'));const nonRu=process.argv[3]==='non-ru',prefix=nonRu?'non-ru':'ru',expectedDrafts=nonRu?74:245;
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,process.argv[2]??'outputs/mann-market-power-held-preview-2026-09-14');
const [raw,draftRaw,proofRaw,identityRaw,marketRaw,contextRaw,sql]=await Promise.all(['plan.json',`${prefix}-market-guard-drafts-v1.json`,`${prefix}-market-guard-draft-verification-v1.json`,`${prefix}-market-identity-recheck-v1.json`,nonRu?'source-market-target-scope-audit-v2.json':'source-market-target-scope-audit-v1.json','source-market-context-audit-v1.json'].map(f=>readFile(resolve(dir,f),'utf8')).concat(readFile('/tmp/vehicle_fluid_requirements.sql','utf8')));
const parent=JSON.parse(raw),draft=JSON.parse(draftRaw),proof=JSON.parse(proofRaw),identity=JSON.parse(identityRaw),market=JSON.parse(marketRaw),context=JSON.parse(contextRaw);
for(const report of [draft,proof,identity,market,context])assert.equal(report.planHash,sha(raw));assert.equal(proof.draftHash,sha(draftRaw));assert.equal(draft.identityAuditHash,sha(identityRaw));assert.equal(draft.marketAuditHash,sha(marketRaw));assert.equal(market.inputHash,sha(contextRaw));assert.equal(context.sourceHash,sha(sql));assert.equal(identity.sourceHash,sha(sql));
assert.equal(context.rawHash,sha(await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')));assert.equal(market.mannHash,sha(await readFile('/tmp/mann_filter_applications.sql','utf8')));
for(const[file,hash]of Object.entries(draft.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
assert.deepEqual(proof.summary,{verifiedDrafts:expectedDrafts,technicalValueChanges:0,sourceReviewObligationsPreserved:expectedDrafts});assert.equal(draft.summary.drafts,expectedDrafts);
const liveRaw=await readFile(resolve(root,parent.inputFiles.live),'utf8');assert.equal(sha(liveRaw),parent.inputHashes.live);const live=new Map(JSON.parse(liveRaw).map(r=>[r.id,r]));
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r])),oldRows=new Map(parent.newRevisions.map(r=>[r.id,r])),replacements=new Map(),revisionHistory=[],reviewHistory=[],actionHistory=[];
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints),jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
for(const d of draft.drafts){
 const old=oldRows.get(d.originalRevisionId),fresh=d.revision;assert.equal(sha(old),d.originalRevisionHash);assert.equal(fresh.applyEligible,false);assert.equal(fresh.verificationStatus,'UNVERIFIED');assert.ok(['STAGED','REVIEW'].includes(fresh.state));
 const source=sources.get(old.sourceRequirementId),f=identity.findings.find(f=>f.revisionId===old.id);assert.equal(sha(source),f.sourceHash);assert.deepEqual(f.reasons,[]);
 const sourceFingerprint=originalAssociationFingerprint(old.vehicleVariantKey,source,parse(source.fillVolumeText,source.systemCode));assert.ok(!denied.has(sourceFingerprint));if(old.provenanceJson.sourceAssociationFingerprint)assert.ok(!denied.has(old.provenanceJson.sourceAssociationFingerprint));
 const m=market.findings.find(m=>m.revisionId===old.id),markets=[...new Set(m.checks.flatMap(c=>c.markets))];assert.equal(markets.length,1);const requiredMarket=markets[0];assert.ok(nonRu?['JP','US'].includes(requiredMarket):requiredMarket==='RU');
 assert.deepEqual(fresh.applicabilityJson,{...old.applicabilityJson,requiredMarket});
 const technical=structuredClone(fresh.technicalDataJson);for(const b of technical.capacityBranches??[]){assert.equal(b.applicabilityJson.requiredMarket,requiredMarket);delete b.applicabilityJson.requiredMarket;}assert.deepEqual(technical,old.technicalDataJson);
 const policy=fresh.provenanceJson.catalogPreviewPolicy??fresh.provenanceJson.conditionalTransmissionPolicy??fresh.provenanceJson.conditionalEquipmentPolicy;
 const fingerprint=policy==='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1'?sha({key:`${old.sourceRequirementId}:${old.vehicleVariantKey}`,policy,applicabilityJson:fresh.applicabilityJson,technicalDataJson:fresh.technicalDataJson}):policy==='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1'?sha({policy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,applicability:fresh.applicabilityJson,technicalData:fresh.technicalDataJson}):sha({policy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,applicabilityJson:fresh.applicabilityJson,technicalDataJson:fresh.technicalDataJson});
 assert.equal(fingerprint,fresh.semanticFingerprint);assert.equal(fresh.id,`mtar_${fingerprint.slice(0,24)}`);assert.ok(!oldRows.has(fresh.id));replacements.set(old.id,fresh);revisionHistory.push({originalRevision:old,replacementRevisionId:fresh.id,sourceAssociationFingerprint:sourceFingerprint});
}
const buildHeld=(f,reason)=>{
 const revision=oldRows.get(f.revisionId),originalSource=sources.get(f.sourceRequirementId),anchor=context.findings.find(e=>e.revisionId===f.revisionId);assert.equal(sha(revision),f.revisionHash);assert.equal(sha(originalSource),anchor.sourceHash);assert.ok(!replacements.has(revision.id));
 assert.equal(revision.applyEligible,false);assert.equal(revision.verificationStatus,'UNVERIFIED');
 return {revision,originalSource,sourceHash:sha(originalSource),sourceAnchor:anchor.anchor,evidence:f,reason,publicationAllowed:false};
};
const extraPower=market.findings.filter(f=>f.statuses.length===1&&f.statuses[0]==='EXACT_ENGINE_POWER_NOT_IN_SOURCE').map(f=>buildHeld(f,'SOURCE_MARKET_BRANCH_POWER_MISMATCH_REQUIRES_REVIEW'));assert.equal(extraPower.length,nonRu?0:10);
const identityHeld=identity.findings.filter(f=>f.reasons.length).map(f=>({...buildHeld(market.findings.find(m=>m.revisionId===f.revisionId),'SOURCE_MARKET_VEHICLE_IDENTITY_REQUIRES_REVIEW'),identityEvidence:f}));
assert.equal(identityHeld.length,nonRu?21:38);const heldIds=new Set([...extraPower,...identityHeld].map(h=>h.revision.id));assert.equal(heldIds.size,nonRu?21:48);
const sourceMarketScopeReview=parent.sourceMarketScopeReview.flatMap(e=>{
 if(heldIds.has(e.revision.id)){reviewHistory.push(e);return [];}
 if(!replacements.has(e.revision.id))return[e];
 reviewHistory.push(e);const fresh=replacements.get(e.revision.id),partition=proof.findings.find(f=>f.originalRevisionId===e.revision.id);assert.equal(partition.sourceReviewHash,sha(e));
 return[{...e,revision:fresh,originalRevisionId:e.revision.id,originalReviewHash:sha(e),reason:nonRu?'MARKET_GUARD_APPLIED_SOURCE_BRANCH_REVIEW_REMAINS':'RU_GUARD_APPLIED_SOURCE_BRANCH_REVIEW_REMAINS',guardProofHash:sha(proofRaw),retainedSourceBranches:partition.retainedSourceBranches,restrictedCandidateConditions:partition.restrictedCandidateConditions}];
});
const existingActions=parent.existingActions.map(a=>{
 const refs=[...new Set([a.successorId,...(a.successorIds??[]),...(a.proposedSuccessorIds??[])].filter(Boolean))];
 if(!refs.some(id=>replacements.has(id)||heldIds.has(id)))return a;
 assert.notEqual(a.action,'PRESERVE_PROTECTED');const prior=live.get(a.revisionId);assert.ok(prior);assert.equal(prior.state,a.expectedState);assert.equal(prior.semanticFingerprint,a.expectedSemanticFingerprint);assert.equal(prior.verificationStatus,'UNVERIFIED');assert.equal(prior.reviewConfirmed,false);
 actionHistory.push(a);const {successorIds,...rest}=a;
 return {...rest,action:'REVIEW_SOURCE_MARKET_SCOPE',successorId:null,proposedSuccessorIds:[...new Set(refs.filter(id=>!heldIds.has(id)).map(id=>replacements.get(id)?.id??id))],withheldSuccessorIds:[...new Set([...(a.withheldSuccessorIds??[]),...refs.filter(id=>heldIds.has(id))])]};
});
const newRevisions=parent.newRevisions.filter(r=>!heldIds.has(r.id)).map(r=>replacements.get(r.id)??r);assert.equal(newRevisions.length,nonRu?1870:1891);assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
for(const a of existingActions)for(const id of [a.successorId,...(a.successorIds??[]),...(a.proposedSuccessorIds??[])].filter(Boolean))assert.ok(!heldIds.has(id)&&!replacements.has(id));
const plan={...parent,newRevisions,existingActions,sourceMarketScopeReview,sourceMarketPowerHeld:[...parent.sourceMarketPowerHeld,...extraPower],sourceMarketIdentityHeld:[...(parent.sourceMarketIdentityHeld??[]),...identityHeld],sourceMarketGuardHistory:{previous:parent.sourceMarketGuardHistory??null,parentPath:resolve(dir,'plan.json'),parentHash:sha(raw),draftHash:sha(draftRaw),proofHash:sha(proofRaw),revisionHistory,reviewHistory,actionHistory},summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,sourceMarketPowerHeld:parent.sourceMarketPowerHeld.length+extraPower.length,sourceMarketIdentityHeld:(parent.sourceMarketIdentityHeld??[]).length+identityHeld.length,sourceMarketScopeReview:sourceMarketScopeReview.length,actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
for(const key of Object.keys(parent).filter(k=>!['newRevisions','existingActions','sourceMarketScopeReview','sourceMarketPowerHeld','sourceMarketIdentityHeld','sourceMarketGuardHistory','summary'].includes(k)))assert.deepEqual(plan[key],parent[key]);
const out=resolve(root,nonRu?'outputs/mann-non-ru-market-guarded-preview-2026-09-14':'outputs/mann-ru-market-guarded-preview-2026-09-14');await mkdir(out);const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
const result={planHash:sha(serialized),parentHash:sha(raw),replaced:replacements.size,newPowerHolds:extraPower.length,newIdentityHolds:identityHeld.length,retained:newRevisions.length,sources:plan.summary.sourceRequirements,remainingMarketReview:sourceMarketScopeReview.length,changedActions:actionHistory.length,productionApplyAllowed:false};await writeFile(resolve(out,'merge-verification.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
