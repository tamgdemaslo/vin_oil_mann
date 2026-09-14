import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { parseCopy, sha, applicabilityWindow, originalAssociationFingerprint } from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
assert.ok(process.argv.length<=3 && !process.argv[2]?.startsWith('--'));
const root = resolve(import.meta.dirname, '..'), dir = resolve(root, process.argv[2]??'outputs/mann-parentheses-scoped-2026-09-13');
const raw = await readFile(resolve(dir, 'capacity-branch-matches.json'), 'utf8'), report = JSON.parse(raw);
const sourceRaw = await readFile('/tmp/vehicle_fluid_requirements.sql', 'utf8'), mannRaw = await readFile('/tmp/mann_filter_applications.sql', 'utf8');
const auditRaw = await readFile(resolve(dir, 'conditional-capacity-audit-v2.json'), 'utf8'), audit = JSON.parse(auditRaw);
assert.deepEqual(report.sourceHashes, { source: sha(sourceRaw), mann: sha(mannRaw), audit: sha(auditRaw) });
for (const [file, hash] of Object.entries(report.codeHashes)) assert.equal(sha(await readFile(resolve(root, file), 'utf8')), hash);
const overlay=await loadIdentityOverlay(root,sourceRaw,report.identityCorrections?.path,report.identityCorrections?.sha256);
const sources = new Map(overlay.requirements.map(r => [r.id, r]));
const variants = Map.groupBy(parseCopy(mannRaw, 'mann_filter_applications'), r => r.vehicleVariantKey);
const expected = new Map(audit.structured.flatMap(r => r.branches.map(b => [`${r.requirementId}:${b.condition.kind}:${b.condition.value}`, b])));
const jiti = createJiti(import.meta.url, { alias: { '@': resolve(root, 'src') } });
const { matchFluidRequirementToMann: match, normalizeFluidRequirementVehicle: normalize } = await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const { parseFluidCapacities } = await jiti.import('../src/lib/fluid-capacity-parser.ts');
const { selectConditionalFluidCapacity: select } = await jiti.import('../src/lib/fluid-capacity-conditions.ts');
const denied = new Set(JSON.parse(await readFile(resolve(root, 'data/mann-technical-association-denylist-v1.json'), 'utf8')).rejectedAssociationFingerprints);
const seen = new Set(); let checked = 0;
for (const result of report.results) {
  const r = sources.get(result.requirementId); assert.ok(r);
  if(r.rawRequirementJson?.sourceIdentity?.reviewRequired)assert.equal(result.proposals.length,0);
  const branch = result.branch, key = `${r.id}:${branch.condition.kind}:${branch.condition.value}`;
  assert.ok(!seen.has(key) && expected.has(key)); seen.add(key);
  assert.deepEqual(branch, expected.get(key)); assert.equal(result.originalSourceText, r.fillVolumeText);
  assert.equal(result.publicationAllowed, false); assert.equal(result.requiresConditionSelection, true);
  assert.equal(select([branch], {}), null);
  const wrong = { engineCode: 'WRONG', transmissionType: 'WRONG', driveMode: 'WRONG' };
  assert.equal(select([branch], wrong), null);
  const selector = branch.condition.kind === 'engine' ? { engineCode: branch.condition.value } : branch.condition.kind === 'drive' ? { driveMode: branch.condition.value } : { transmissionType: branch.condition.value };
  assert.equal(select([branch], selector), branch);
  const targets = new Set();
  for (const proposal of result.proposals) {
    assert.ok(!targets.has(proposal.vehicleVariantKey)); targets.add(proposal.vehicleVariantKey);
    assert.equal(proposal.publicationAllowed, false); assert.deepEqual(proposal.requiredCondition, branch.condition);
    const rows = variants.get(proposal.vehicleVariantKey); assert.ok(rows?.length);
    for (const row of rows) assert.deepEqual(proposal.window, applicabilityWindow(r, row));
    const original = parseFluidCapacities(r.fillVolumeText, r.systemCode);
    const fingerprint = originalAssociationFingerprint(proposal.vehicleVariantKey, overlay.originalById.get(r.id), original);
    assert.deepEqual(proposal.sourceIdentityCorrection??null,overlay.changes.has(r.id)?{artifactSha256:overlay.metadata.sha256,requirementId:r.id,fields:overlay.changes.get(r.id).after}:null);
    assert.equal(proposal.originalAssociationFingerprint, fingerprint); assert.ok(!denied.has(fingerprint));
    const scoped = { ...r, ...proposal.window.narrowedYears, fillVolumeText: branch.sourceSegment,
      ...(branch.condition.kind === 'engine' ? { engineCodeNormalized: branch.condition.value, engineCodesJson: [branch.condition.value] } : {}) };
    assert.deepEqual(proposal.matchedEngineScope, normalize(scoped)?.sourceExactEngineCodes ?? []);
    const parsed = parseFluidCapacities(scoped.fillVolumeText, r.systemCode);
    assert.equal(parsed.needsReview, false); assert.deepEqual(parsed.capacities, [branch.capacity]);
    const replay = match(scoped, rows);
    assert.ok(['CONFIRMED_SINGLE', 'CONFIRMED_MULTI_APPLICABILITY'].includes(replay.status));
    const target = replay.targets.find(t => t.vehicleVariantKey === proposal.vehicleVariantKey);
    assert.ok(target?.independentlyValidated); assert.deepEqual(target.hardConflicts, []); assert.deepEqual(target.reviewBlockers, []);
    checked++;
  }
}
assert.equal(seen.size, expected.size); assert.equal(checked, report.proposals);
const verification = { result: 'PASS_CONDITIONAL_BRANCH_SOURCE_TARGET_REPLAY', reportSha256: sha(raw), branches: seen.size, proposals: checked, issueCount: 0,
  productionApplyAllowed: false, limitation: 'Target-only replay; not independent full-catalog ranking, OEM fluid verification, or runtime integration.' };
await writeFile(resolve(dir, 'capacity-branch-verification.json'), JSON.stringify(verification, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(verification, null, 2));
