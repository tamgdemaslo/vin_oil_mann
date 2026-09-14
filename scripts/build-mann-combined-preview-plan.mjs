import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCopy, sha } from './lib/mann-offline-scope.mjs';
assert.ok([2,5].includes(process.argv.length) && !process.argv.slice(2).some(a=>a.startsWith('--')), 'Offline only: [ordinary-directory branch-directory output-directory]');
const root = resolve(import.meta.dirname, '..');
const baseDir=process.argv[2]??'outputs/mann-scoped-merge-plan-2026-09-13-v3',branchDir=process.argv[3]??'outputs/mann-parentheses-scoped-2026-09-13';
const files = {
  base: resolve(root,baseDir,'plan.json'),
  baseVerification: resolve(root,baseDir,'verification.json'),
  branches: resolve(root,branchDir,'capacity-branch-plan.json'),
  branchMatches: resolve(root,branchDir,'capacity-branch-matches.json'),
  branchVerification: resolve(root,branchDir,'capacity-branch-verification.json'),
  live: 'outputs/mann-live-audit-1789334190861/revisions.json', source: '/tmp/vehicle_fluid_requirements.sql',
};
const raw = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(resolve(root, file), 'utf8')])));
const base = JSON.parse(raw.base), branchPlan = JSON.parse(raw.branches), live = JSON.parse(raw.live);
assert.equal(JSON.parse(raw.baseVerification).planSha256, sha(base));
assert.equal(JSON.parse(raw.baseVerification).issueCount, 0);
assert.equal(JSON.parse(raw.branchVerification).reportSha256, sha(raw.branchMatches));
assert.equal(JSON.parse(raw.branchVerification).issueCount, 0);
assert.equal(branchPlan.sourceReportHash, sha(raw.branchMatches));
assert.equal(base.inputs.liveRevisions, sha(raw.live)); assert.equal(base.inputs.source, sha(raw.source));
assert.equal(base.inputs.identityCorrections?.sha256,branchPlan.identityCorrections?.sha256,'Cannot mix different source identity versions');
const sources = new Map(parseCopy(raw.source, 'vehicle_fluid_requirements').map(r => [r.id, r]));
const key = r => `${r.sourceRequirementId}:${r.vehicleVariantKey}`;
const byLive = Map.groupBy(live, key), candidates = new Map(base.newRevisions.map(r => [key(r), r]));
const protectedRow = r => r.reviewConfirmed || r.verificationStatus === 'PRIMARY_SOURCE_VERIFIED_FIELDS';
const protectedBranches = [], replacedDrafts = [];
for (const branch of branchPlan.revisions) {
  const old = byLive.get(key(branch)) ?? [];
  if (old.some(protectedRow)) { protectedBranches.push({ branchId: branch.id, key: key(branch), revisionIds: old.map(r => r.id) }); continue; }
  const source = sources.get(branch.sourceRequirementId); assert.ok(source);
  const technicalDataJson = { ...branch.technicalDataJson, recommendationText: source.recommendationText,
    replacementIntervalText: source.replacementIntervalText, replacementKmMin: source.replacementKmMin,
    replacementKmMax: source.replacementKmMax, replacementMonths: source.replacementMonths,
    controlIntervalText: source.controlIntervalText, analogText: source.analogText };
  const previous = candidates.get(key(branch));
  if (previous) {
    assert.equal(previous.technicalDataJson.fillVolumeText, technicalDataJson.fillVolumeText);
    assert.deepEqual(previous.applicabilityJson.window, branch.applicabilityJson.window);
    assert.deepEqual(previous.applicabilityJson.sourceVehicleScope,branch.applicabilityJson.sourceVehicleScope);
    replacedDrafts.push({ key: key(branch), ordinaryDraftId: previous.id, conditionalDraftId: branch.id });
  }
  const semanticFingerprint = sha({ policy: branch.provenanceJson.catalogPreviewPolicy, key: key(branch), applicabilityJson: branch.applicabilityJson, technicalDataJson });
  candidates.set(key(branch), { ...branch, id: `mtar_${semanticFingerprint.slice(0,24)}`, semanticFingerprint, technicalDataJson,
    fieldConfidenceJson: { ...branch.fieldConfidenceJson, 'technical.recommendation': 'SECONDARY_SOURCE_PARSED_MEDIUM', 'technical.replacementInterval': 'SECONDARY_SOURCE_PARSED_MEDIUM' },
    replacesRevisionIds: old.map(r => r.id), sourceConditionalDraftId: branch.id });
}
const newRevisions = [...candidates.values()];
assert.equal(new Set(newRevisions.map(r => r.id)).size, newRevisions.length);
const existingActions = live.map(r => {
  const successor = candidates.get(key(r));
  const action = protectedRow(r) ? 'PRESERVE_PROTECTED' : successor ? 'REPLACE_WITH_PREVIEW'
    : r.matchClass === 'CONDITIONAL_TRANSMISSION' ? 'RECHECK_CONDITIONAL' : 'REVIEW_UNREPLACED';
  assert.ok(!protectedRow(r) || !successor, 'Protected revision would be shadowed');
  return { revisionId: r.id, expectedSemanticFingerprint: r.semanticFingerprint, expectedState: r.state, action, successorId: successor?.id ?? null };
});
const summary = { candidateRevisions: newRevisions.length, conditionalCapacityRevisions: newRevisions.filter(r => r.sourceConditionalDraftId).length,
  preservedCapacityBranches: newRevisions.reduce((n,r) => n + (r.technicalDataJson.capacityBranches?.length ?? 0), 0),
  existingRevisions: live.length, actions: Object.fromEntries(Object.entries(Object.groupBy(existingActions, a => a.action)).map(([k,v]) => [k,v.length])),
  replacedOrdinaryDrafts: replacedDrafts.length, protectedConditionalDrafts: protectedBranches.length };
const plan = { kind: 'COMBINED_SCOPED_AND_CONDITIONAL_PREVIEW_PLAN', productionApplyAllowed: false, writeMode: 'DRY_RUN_ONLY',
  inputFiles: files, inputHashes: Object.fromEntries(Object.entries(raw).map(([k,v]) => [k,sha(v)])), summary,
  requiredGates: base.requiredGates, newRevisions, existingActions, protectedBranches, replacedDrafts };
const output = resolve(root,process.argv[4]??'outputs/mann-combined-preview-plan-2026-09-13'); await mkdir(output);
await writeFile(resolve(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, summary, productionApplyAllowed: false }, null, 2));
