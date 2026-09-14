import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { parseCopy, sha, applicabilityWindow, originalAssociationFingerprint, YEAR_BLOCKER } from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
assert.ok(process.argv.length<=4 && !process.argv.slice(2).some(a=>a.startsWith('--')), 'Offline only: [directory correction-file]');
const root = resolve(import.meta.dirname, '..'), dir = resolve(root, process.argv[2]??'outputs/mann-parentheses-scoped-2026-09-13');
const [auditRaw, sourceRaw, mannRaw] = await Promise.all([
  readFile(resolve(dir, 'conditional-capacity-audit-v2.json'), 'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql', 'utf8'), readFile('/tmp/mann_filter_applications.sql', 'utf8')]);
const audit = JSON.parse(auditRaw);
assert.equal(audit.sourceSha256, sha(sourceRaw));
for (const [file, hash] of Object.entries(audit.codeHashes)) assert.equal(sha(await readFile(resolve(root, file), 'utf8')), hash);
const overlay=await loadIdentityOverlay(root,sourceRaw,process.argv[3] ? resolve(root,process.argv[3]) : null);
const sources = new Map(overlay.requirements.map(r => [r.id, r]));
const rows = parseCopy(mannRaw, 'mann_filter_applications'), variants = Map.groupBy(rows, r => r.vehicleVariantKey);
const denied = new Set(JSON.parse(await readFile(resolve(root, 'data/mann-technical-association-denylist-v1.json'), 'utf8')).rejectedAssociationFingerprints);
const jiti = createJiti(import.meta.url, { alias: { '@': resolve(root, 'src') } });
const { matchFluidRequirementToMann: match, normalizeFluidRequirementVehicle: normalize } = await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const { mannMakeFormsForTest } = await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const { normalizeMannText } = await jiti.import('../src/lib/mann-catalog.ts');
const { parseFluidCapacities } = await jiti.import('../src/lib/fluid-capacity-parser.ts');
const { parseConditionalFluidCapacities } = await jiti.import('../src/lib/fluid-capacity-conditions.ts');
const makeCache = new Map(), results = [];
const confirmed = d => ['CONFIRMED_SINGLE', 'CONFIRMED_MULTI_APPLICABILITY'].includes(d.status);
for (const sourceAudit of audit.structured) {
  const source = sources.get(sourceAudit.requirementId); assert.ok(source);
  const parsed = parseConditionalFluidCapacities(source.fillVolumeText, source.systemCode, [source.engineCodeNormalized, ...(source.engineCodesJson ?? [])].filter(Boolean));
  assert.equal(parsed.status, 'structured'); assert.deepEqual(parsed.branches, sourceAudit.branches);
  const make = normalize(source)?.canonicalMake;
  if (!makeCache.has(make)) { const forms = new Set(mannMakeFormsForTest(make ?? '')); makeCache.set(make, rows.filter(r => forms.has(normalizeMannText(r.makeNormalized || r.make)))); }
  const catalog = makeCache.get(make), originalCapacity = parseFluidCapacities(source.fillVolumeText, source.systemCode);
  const windowFor = key => { const windows = (variants.get(key) ?? []).map(r => applicabilityWindow(source, r)); return windows.length && windows.every(Boolean) && new Set(windows.map(sha)).size === 1 ? windows[0] : null; };
  for (const branch of parsed.branches) {
    // Do not pretend the vehicle catalogue confirms this user-selectable condition.
    // Engine branches are narrower explicit source applicability. Other selectors
    // remain separate and must be enforced before any eventual display.
    const scoped = { ...source, fillVolumeText: branch.sourceSegment,
      ...(branch.condition.kind === 'engine' ? { engineCodeNormalized: branch.condition.value, engineCodesJson: [branch.condition.value] } : {}) };
    const initial = match(scoped, catalog), proposals = new Map(), blockers = [];
    if (!source.specificationText?.trim() && !source.specificationsJson?.length) blockers.push('MISSING_SPECIFICATION');
    if (branch.condition.kind === 'transmission' && source.transmissionType && source.transmissionType !== branch.condition.value) blockers.push('SOURCE_TRANSMISSION_CONDITION_CONFLICT');
    const retain = (decision, expectedKey) => {
      if (!confirmed(decision) || blockers.length) return;
      for (const target of decision.targets) {
        if (expectedKey && target.vehicleVariantKey !== expectedKey) continue;
        if (!target.independentlyValidated || target.hardConflicts.length || target.reviewBlockers.length) continue;
        const engines = normalize(scoped)?.sourceExactEngineCodes ?? [];
        if (engines.length && !target.matchedFields.includes('точный код двигателя')) continue;
        const window = windowFor(target.vehicleVariantKey); if (!window) continue;
        const fingerprint = originalAssociationFingerprint(target.vehicleVariantKey, overlay.originalById.get(source.id), originalCapacity);
        if (denied.has(fingerprint)) { blockers.push('PREVIOUSLY_REJECTED_ASSOCIATION'); continue; }
        proposals.set(target.vehicleVariantKey, { vehicleVariantKey: target.vehicleVariantKey, window, matchedEngineScope: engines,
          requiredCondition: branch.condition, originalAssociationFingerprint: fingerprint, validation: target,
          sourceIdentityCorrection:overlay.changes.has(source.id) ? {artifactSha256:overlay.metadata.sha256,requirementId:source.id,fields:overlay.changes.get(source.id).after} : null,
          matchStatus: decision.status, publicationAllowed: false });
      }
    };
    retain(initial);
    if (!confirmed(initial) && !blockers.length) {
      const attempts = new Map();
      for (const candidate of initial.topCandidates) {
        if (candidate.hardConflicts.length || candidate.reviewBlockers.length !== 1 || candidate.reviewBlockers[0] !== YEAR_BLOCKER) continue;
        for (const key of candidate.variantIds) {
          const window = windowFor(key); if (!window) continue;
          const cacheKey = sha(window.narrowedYears);
          if (!attempts.has(cacheKey)) attempts.set(cacheKey, match({ ...scoped, ...window.narrowedYears }, catalog));
          retain(attempts.get(cacheKey), key);
        }
      }
    }
    results.push({ requirementId: source.id, systemCode: source.systemCode, sourceUrl: source.sourceUrl, originalSourceText: source.fillVolumeText,
      branch, initialMatchStatus: initial.status, blockers, topCandidate: initial.topCandidates[0],
      proposals: [...proposals.values()], requiresConditionSelection: true, requiresSourceTechnicalReview: true, publicationAllowed: false });
  }
  if (results.length % 50 === 0) console.log(JSON.stringify({ branchesProcessed: results.length, sourceTotal: audit.structured.length }));
}
assert.equal(results.length, audit.structured.reduce((n, r) => n + r.branches.length, 0));
const codeFiles = ['src/lib/mann-fluid-matcher-v2.ts', 'src/lib/mann-vehicle-resolver.ts', 'src/lib/vehicle-normalization.ts', 'src/lib/fluid-catalog.ts','scripts/lib/mann-source-identity-overlay.mjs','scripts/match-mann-capacity-branches.mjs'];
const codeHashes = Object.fromEntries(await Promise.all(codeFiles.map(async file => [file, sha(await readFile(resolve(root, file), 'utf8'))])));
const report = { kind: 'CONDITIONAL_CAPACITY_FULL_MAKE_MATCH', identityCorrections:overlay.metadata,sourceHashes: { audit: sha(auditRaw), source: sha(sourceRaw), mann: sha(mannRaw) }, codeHashes,
  requirements: audit.structured.length, branches: results.length, branchesWithProposals: results.filter(r => r.proposals.length).length,
  requirementsWithProposals: new Set(results.filter(r => r.proposals.length).map(r => r.requirementId)).size,
  proposals: results.reduce((n, r) => n + r.proposals.length, 0), productionApplyAllowed: false, results };
await writeFile(resolve(dir, 'capacity-branch-matches.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
