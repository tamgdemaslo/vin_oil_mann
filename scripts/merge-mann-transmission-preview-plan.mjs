import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..');
const baseDir=resolve(root,'outputs/mann-combined-preview-plan-2026-09-14');
const transmissionDir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const files={base:resolve(baseDir,'plan.json'),baseVerification:resolve(baseDir,'verification.json'),
  baseComposition:resolve(baseDir,'profile-composition-audit.json'),
  transmission:resolve(transmissionDir,'conditional-transmission-plan-v4.json'),
  transmissionVerification:resolve(transmissionDir,'conditional-transmission-runtime-v4.json')};
const raw=Object.fromEntries(await Promise.all(Object.entries(files).map(async([k,p])=>[k,await readFile(p,'utf8')])));
const {base,baseVerification,baseComposition,transmission,transmissionVerification}=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,JSON.parse(v)]));
assert.equal(base.productionApplyAllowed,false);assert.equal(transmission.productionApplyAllowed,false);
assert.equal(baseVerification.planSha256,sha(raw.base));assert.equal(baseVerification.issueCount,0);
assert.equal(baseComposition.planSha256,sha(raw.base));assert.equal(baseComposition.capacityConflictCases,0);
assert.equal(transmissionVerification.planSha256,sha(raw.transmission));
assert.equal(transmissionVerification.individualIssues,0);assert.equal(transmissionVerification.compositionConflictCases,0);
for(const [k,p] of Object.entries(base.inputFiles))assert.equal(sha(await readFile(resolve(root,p),'utf8')),base.inputHashes[k]);
for(const [p,h] of Object.entries(transmission.codeHashes))assert.equal(sha(await readFile(resolve(root,p),'utf8')),h);
assert.equal(base.inputHashes.source,transmission.inputHashes.source);assert.equal(base.inputHashes.live,transmission.inputHashes.live);
const ordinary=JSON.parse(await readFile(base.inputFiles.base,'utf8'));
assert.equal(ordinary.inputs.identityCorrections.sha256,transmission.identityCorrections.sha256);
assert.equal(sha(await readFile(transmission.identityCorrections.path,'utf8')),transmission.identityCorrections.sha256);
const contextRaw=await readFile(resolve(transmissionDir,'source-system-context-v3.json'),'utf8');
assert.equal(sha(contextRaw),transmission.systemContextHash);
assert.equal(JSON.parse(contextRaw).extractorHash,sha(await readFile(resolve(root,'src/lib/fluid-source-system-context.ts'),'utf8')));
const live=JSON.parse(await readFile(resolve(root,base.inputFiles.live),'utf8'));
const key=r=>`${r.sourceRequirementId}:${r.vehicleVariantKey}`;
const candidates=new Map(base.newRevisions.map(r=>[key(r),r]));
for(const r of transmission.revisions){
  assert.ok(!candidates.has(key(r)),'Overlapping drafts need explicit reconciliation');
  assert.equal(r.state,'REVIEW');assert.equal(r.applyEligible,false);
  assert.equal(r.provenanceJson.sourceSystemContext.destinationSystemCode,r.systemCode);
  assert.ok(r.replacesRevisionIds.length);
  for(const id of r.replacesRevisionIds){
    const old=live.find(r=>r.id===id);assert.ok(old);assert.equal(key(old),key(r));
    assert.equal(old.reviewConfirmed,false);assert.notEqual(old.verificationStatus,'PRIMARY_SOURCE_VERIFIED_FIELDS');
    const decision=transmission.decisions.find(d=>d.revisionId===id);assert.equal(decision.successorId,r.id);
  }
  candidates.set(key(r),r);
}
const existingActions=base.existingActions.map(a=>{
  const old=live.find(r=>r.id===a.revisionId);assert.ok(old);
  assert.equal(a.expectedSemanticFingerprint,old.semanticFingerprint);assert.equal(a.expectedState,old.state);
  const successor=candidates.get(key(old));
  if(a.action==='PRESERVE_PROTECTED'){assert.ok(!successor);return a;}
  return successor?{...a,action:'REPLACE_WITH_PREVIEW',successorId:successor.id}:a;
});
assert.equal(new Set(existingActions.map(a=>a.revisionId)).size,live.length);
const newRevisions=[...candidates.values()];assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
const summary={...base.summary,candidateRevisions:newRevisions.length,conditionalTransmissionRevisions:transmission.revisions.length,
  actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))};
const plan={...base,kind:'COMBINED_ALL_PREVIEW_POLICIES_PLAN',summary,newRevisions,existingActions,
  mergeInputFiles:files,mergeInputHashes:Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,sha(v)])),
  transmissionReviewDecisions:transmission.decisions.filter(d=>!d.successorId),
  limitation:'Offline preview only. Pending joint runtime audit, current production revalidation and OEM fact verification.'};
const out=resolve(root,'outputs/mann-all-fluids-preview-2026-09-14');await mkdir(out);
await writeFile(resolve(out,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,summary,productionApplyAllowed:false},null,2));
