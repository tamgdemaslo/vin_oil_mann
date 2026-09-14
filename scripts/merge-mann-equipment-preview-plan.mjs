import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),baseDir=resolve(root,'outputs/mann-all-fluids-preview-2026-09-14'),equipmentDir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const files={base:resolve(baseDir,'plan.json'),baseVerification:resolve(baseDir,'verification.json'),baseComposition:resolve(baseDir,'profile-composition-audit-v2.json'),
  equipment:resolve(equipmentDir,'conditional-equipment-plan-v1.json'),equipmentVerification:resolve(equipmentDir,'conditional-equipment-runtime-v2.json')};
const raw=Object.fromEntries(await Promise.all(Object.entries(files).map(async([k,p])=>[k,await readFile(p,'utf8')])));
const {base,baseVerification,baseComposition,equipment,equipmentVerification}=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,JSON.parse(v)]));
assert.equal(base.productionApplyAllowed,false);assert.equal(equipment.productionApplyAllowed,false);
assert.equal(baseVerification.planSha256,sha(raw.base));assert.equal(baseVerification.issueCount,0);
assert.equal(baseComposition.planSha256,sha(raw.base));assert.equal(baseComposition.capacityConflictCases,0);
assert.equal(equipmentVerification.planSha256,sha(raw.equipment));assert.equal(equipmentVerification.individualIssues,0);assert.equal(equipmentVerification.compositionConflictCases,0);
for(const [k,p] of Object.entries(base.inputFiles))assert.equal(sha(await readFile(resolve(root,p),'utf8')),base.inputHashes[k]);
assert.equal(equipment.inputHashes.source,base.inputHashes.source);assert.equal(equipment.inputHashes.live,base.inputHashes.live);
const original=JSON.parse(await readFile(base.inputFiles.base,'utf8'));
assert.equal(original.inputs.identityCorrections.sha256,equipment.identityCorrections.sha256);
assert.equal(sha(await readFile(equipment.identityCorrections.path,'utf8')),equipment.identityCorrections.sha256);
const key=r=>`${r.sourceRequirementId}:${r.vehicleVariantKey}`,candidates=new Map(base.newRevisions.map(r=>[key(r),r]));
const live=JSON.parse(await readFile(resolve(root,base.inputFiles.live),'utf8'));
for(const r of equipment.revisions){
  assert.ok(!candidates.has(key(r)),'Overlapping draft requires explicit reconciliation');
  assert.equal(r.applyEligible,false);assert.equal(r.state,'REVIEW');assert.equal(r.verificationStatus,'UNVERIFIED');
  const predecessors=live.filter(old=>key(old)===key(r));
  assert.deepEqual([...r.replacesRevisionIds].sort(),predecessors.map(r=>r.id).sort());
  assert.ok(predecessors.every(r=>!r.reviewConfirmed&&r.verificationStatus!=='PRIMARY_SOURCE_VERIFIED_FIELDS'));
  candidates.set(key(r),r);
}
const existingActions=base.existingActions.map(action=>{
  const old=live.find(r=>r.id===action.revisionId);assert.ok(old);
  const successor=candidates.get(key(old));
  if(action.action==='PRESERVE_PROTECTED'){assert.ok(!successor);return action;}
  return successor?{...action,action:'REPLACE_WITH_PREVIEW',successorId:successor.id}:action;
});
const newRevisions=[...candidates.values()];assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
const summary={...base.summary,candidateRevisions:newRevisions.length,conditionalEquipmentRevisions:equipment.revisions.length,
  actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))};
const plan={...base,kind:'ALL_SYSTEMS_EQUIPMENT_PREVIEW_PLAN',summary,newRevisions,existingActions,
  mergeInputFiles:files,mergeInputHashes:Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,sha(v)])),
  equipmentReviewDecisions:equipment.decisions.filter(d=>!d.successorId),
  limitation:'Offline equipment-inclusive draft, pending joint verification. Not whole-source coverage or production authorization.'};
const out=resolve(root,'outputs/mann-equipment-inclusive-preview-2026-09-14');await mkdir(out);
await writeFile(resolve(out,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,summary,productionApplyAllowed:false},null,2));
