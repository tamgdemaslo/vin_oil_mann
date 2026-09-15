import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const version=process.argv[2]??'v1',expectedHashes={v1:'df04fc11f498bb6e4c48d0b2976e2f01ecc9442ae6fcbc7c3973c7329224c3e5',v2:'33fcc0c9b7396f57fca01ae9e062eb5faecf1e7b37a56f15a6fa4d9ec0a68596'};
assert.ok(expectedHashes[version]);
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),expectedHashes[version]);
const plan=JSON.parse(raw),oldRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(oldRaw),plan.inputHashes.live);
const old=JSON.parse(oldRaw),byOld=new Map(old.map(r=>[r.id,r])),byNew=new Map(plan.newRevisions.map(r=>[r.id,r]));
assert.equal(new Set(plan.existingActions.map(a=>a.revisionId)).size,old.length);
const findings=plan.existingActions.map(a=>{
 const before=byOld.get(a.revisionId);assert.ok(before);assert.equal(before.semanticFingerprint,a.expectedSemanticFingerprint);assert.equal(before.state,a.expectedState);
 const ids=a.successorIds??(a.successorId?[a.successorId]:[]);
 const missing=ids.filter(id=>!byNew.has(id));
 const protectedRow=before.reviewConfirmed||before.applyEligible||before.verificationStatus!=='UNVERIFIED'||before.state==='ACTIVE';
 const sameIdentity=ids.filter(id=>byNew.has(id)).every(id=>{const r=byNew.get(id);return r.vehicleVariantKey===before.vehicleVariantKey&&r.sourceRequirementId===before.sourceRequirementId&&r.systemCode===before.systemCode;});
 return {revisionId:a.revisionId,action:a.action,oldRowHash:sha(before),successorIds:ids,missingSuccessorIds:missing,protectedRow:!!protectedRow,sameSourceVariantSystem:sameIdentity,
   reviewRequired:a.action!=='REPLACE_WITH_PREVIEW'&&a.action!=='PRESERVE_PROTECTED',publicationAllowed:false};
});
const replacements=findings.filter(f=>f.action==='REPLACE_WITH_PREVIEW');
const blockers=replacements.filter(f=>f.protectedRow||!f.sameSourceVariantSystem||!f.successorIds.length||f.missingSuccessorIds.length);
const summary={historicalRevisions:old.length,actions:findings.length,replacementActions:replacements.length,replacementStructuralBlockers:blockers.length,protectedRows:findings.filter(f=>f.protectedRow).length,protectedRowsMarkedForReplacement:replacements.filter(f=>f.protectedRow).length,missingActiveSuccessorReferences:findings.reduce((n,f)=>n+f.missingSuccessorIds.length,0),reviewActions:findings.filter(f=>f.reviewRequired).length};
const report={kind:'HISTORICAL_REPLACEMENT_LINK_INTEGRITY',planHash:sha(raw),historicalSnapshotHash:sha(oldRaw),summary,blockers,findings,productionApplyAllowed:false,limitations:['Historical archived snapshot only; no new DB connection or export.','Structural links do not prove scope coverage, technical correctness or replacement authorization.','Full fresh review decisions are unavailable; reviewConfirmed only detects historical CONFIRM decisions.','Review actions are not converted into replacements; missing links are not silently repaired.']};
await writeFile(resolve(dir,`current-replacement-links-${version}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
