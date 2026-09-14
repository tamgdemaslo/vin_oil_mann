import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { parseCopy, sha } from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root = resolve(import.meta.dirname, '..'), dir = resolve(root,process.argv[2]??'outputs/mann-combined-preview-plan-2026-09-13');
const raw = await readFile(resolve(dir, 'plan.json'), 'utf8'), plan = JSON.parse(raw);
assert.equal(plan.productionApplyAllowed, false); assert.equal(plan.writeMode, 'DRY_RUN_ONLY');
const inputs = {};
for (const [key, file] of Object.entries(plan.inputFiles)) {
  const text = await readFile(resolve(root, file), 'utf8'); assert.equal(sha(text), plan.inputHashes[key]);
  inputs[key] = key === 'source' ? text : JSON.parse(text);
}
assert.equal(inputs.base.inputs.identityCorrections?.sha256,inputs.branches.identityCorrections?.sha256);
const identity=inputs.base.inputs.identityCorrections;
const overlay=await loadIdentityOverlay(root,inputs.source,identity?.path,identity?.sha256);
const source = new Map(overlay.requirements.map(r => [r.id,r]));
const key = r => `${r.sourceRequirementId}:${r.vehicleVariantKey}`;
const candidates = new Map(), live = new Map(inputs.live.map(r => [r.id,r]));
const originalDrafts = new Map(inputs.base.newRevisions.map(r => [r.id,r]));
const conditionalDrafts = new Map(inputs.branches.revisions.map(r => [r.id,r]));
const jiti = createJiti(import.meta.url, { alias: { '@': resolve(root, 'src') } });
const { buildMannUnifiedTechnicalProfile: profile } = await jiti.import('../src/lib/mann-unified-technical-profile.ts');
let conditionalBranches = 0, runtimeCases = 0;
for (const r of plan.newRevisions) {
  assert.ok(!candidates.has(key(r))); candidates.set(key(r),r);
  assert.equal(r.applyEligible,false); assert.equal(r.state,'STAGED'); assert.equal(r.verificationStatus,'UNVERIFIED');
  assert.deepEqual(r.verifiedFieldsJson,[]);
  assert.ok(Object.values(r.fieldConfidenceJson).every(v => typeof v === 'string' && v.startsWith('SECONDARY_SOURCE_')));
  const s = source.get(r.sourceRequirementId); assert.ok(s);
  if(identity)assert.deepEqual(r.applicabilityJson.sourceVehicleScope,{make:s.make,model:s.model,...(s.generation?{generation:s.generation}:{})});
  assert.notEqual(s.rawRequirementJson?.sourceIdentity?.reviewRequired,true);
  assert.equal(r.systemCode,s.systemCode); assert.equal(r.componentModel,s.componentModel);
  assert.equal(r.technicalDataJson.fillVolumeText,s.fillVolumeText);
  assert.deepEqual(r.technicalDataJson.specifications,s.specificationsJson);
  assert.deepEqual(r.technicalDataJson.viscosityGrades,s.viscosityGradesJson);
  if (r.sourceConditionalDraftId) {
    const draft = conditionalDrafts.get(r.sourceConditionalDraftId); assert.ok(draft);
    assert.equal(key(draft),key(r));
    assert.deepEqual(r.technicalDataJson.capacityBranches,draft.technicalDataJson.capacityBranches);
    assert.deepEqual(r.applicabilityJson,draft.applicabilityJson);
    for (const field of ['recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText']) assert.deepEqual(r.technicalDataJson[field],s[field]);
    conditionalBranches += r.technicalDataJson.capacityBranches.length;
  } else assert.deepEqual(r, originalDrafts.get(r.id));
  for (const id of r.replacesRevisionIds) {
    const old = live.get(id); assert.ok(old); assert.equal(key(old),key(r));
    assert.equal(old.reviewConfirmed,false); assert.notEqual(old.verificationStatus,'PRIMARY_SOURCE_VERIFIED_FIELDS');
  }
  const row = { ...r, createdAt: new Date('2026-09-13'), reviewConfirmed:false,
    run: { status:'COMPLETED', mode:'STAGING', independentHumanSignoff:false, productionApplyAuthorized:false,
      gatesJson: { catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy, automaticProductSelection:false } } };
  const choices = r.technicalDataJson.capacityBranches ?? [{ applicabilityJson:r.applicabilityJson }];
  for (const choice of choices) {
    const scope = choice.applicabilityJson;
    const context = { ...r.applicabilityJson.sourceVehicleScope,engineCode:scope.matchedEngineScope?.[0], productionMonth:scope.window.intersection.from ?? scope.window.intersection.to };
    if (choice.condition?.kind === 'engine') context.engineCode = choice.condition.value;
    const type = choice.condition?.kind === 'transmission' ? choice.condition.value : undefined;
    const result = profile([row],type,context);
    assert.equal(result.items.length,1,r.id); assert.equal(result.items[0].automaticSelectionEligible,false);
    assert.equal(profile([row]).items.length,0);
    if(identity){
      assert.equal(profile([row],type,{...context,model:'WRONG_MODEL'}).items.length,0);
      assert.equal(profile([row],type,{...context,make:undefined}).items.length,0);
      if(context.generation)assert.equal(profile([row],type,{...context,generation:'WRONG'}).items.length,0);
    }
    if (choice.condition) assert.equal(result.items[0].capacities.length,1);
    runtimeCases++;
  }
}
const actionIds = new Set();
for (const action of plan.existingActions) {
  const old = live.get(action.revisionId); assert.ok(old && !actionIds.has(old.id)); actionIds.add(old.id);
  assert.equal(action.expectedSemanticFingerprint,old.semanticFingerprint); assert.equal(action.expectedState,old.state);
  if (old.reviewConfirmed || old.verificationStatus === 'PRIMARY_SOURCE_VERIFIED_FIELDS') {
    assert.equal(action.action,'PRESERVE_PROTECTED'); assert.equal(action.successorId,null); assert.ok(!candidates.has(key(old)));
  } else if (candidates.has(key(old))) {
    assert.equal(action.action,'REPLACE_WITH_PREVIEW'); assert.equal(action.successorId,candidates.get(key(old)).id);
    assert.ok(candidates.get(key(old)).replacesRevisionIds.includes(old.id));
  } else assert.equal(action.successorId,null);
}
assert.equal(actionIds.size,live.size);
for (const original of inputs.base.newRevisions) {
  const candidate = candidates.get(key(original)); assert.ok(candidate);
  if (candidate.id !== original.id) assert.ok(plan.replacedDrafts.some(r => r.ordinaryDraftId === original.id && r.conditionalDraftId === candidate.sourceConditionalDraftId));
}
for (const draft of inputs.branches.revisions) assert.ok(candidates.get(key(draft))?.sourceConditionalDraftId === draft.id || plan.protectedBranches.some(r => r.branchId === draft.id));
assert.equal(conditionalBranches,plan.summary.preservedCapacityBranches);
assert.equal(candidates.size,plan.summary.candidateRevisions);
const verification = { result:'PASS_COMBINED_OFFLINE_PLAN_AND_RUNTIME', planSha256:sha(raw), candidates:candidates.size, liveRevisions:live.size,
  conditionalBranches,runtimeCases,issueCount:0,productionApplyAllowed:false,
  limitation:'Does not verify current production state, SQL idempotence, browser behavior, or OEM fluid values.' };
await writeFile(resolve(dir,'verification.json'),JSON.stringify(verification,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(verification,null,2));
