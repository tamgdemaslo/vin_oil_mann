import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { parseCopy, sha, applicabilityWindow } from './lib/mann-offline-scope.mjs';
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'outputs/mann-scoped-merge-plan-2026-09-13-v2');
const planRaw = await readFile(resolve(dir, 'plan.json'), 'utf8');
const liveRaw = await readFile(resolve(root, 'outputs/mann-live-audit-1789334190861/revisions.json'), 'utf8');
const decisionsRaw = await readFile(resolve(root, 'outputs/mann-engine-date-scoped-2026-09-13/decisions.ndjson'), 'utf8');
const mannRaw = await readFile('/tmp/mann_filter_applications.sql', 'utf8');
const sourceRaw = await readFile('/tmp/vehicle_fluid_requirements.sql', 'utf8');
const plan = JSON.parse(planRaw);
assert.equal(plan.inputs.liveRevisions, sha(liveRaw));
assert.equal(plan.inputs.decisions, sha(decisionsRaw));
assert.equal(plan.inputs.source, sha(sourceRaw));
const ids = new Set(plan.existingActions.filter(a => a.action === 'REVIEW_UNREPLACED').map(a => a.revisionId));
const revisions = JSON.parse(liveRaw).filter(r => ids.has(r.id));
const decisions = new Map(decisionsRaw.trim().split('\n').map(JSON.parse).map(d => [d.requirementId, d]));
const sources = new Map(parseCopy(sourceRaw, 'vehicle_fluid_requirements').map(r => [r.id, r]));
const rows = parseCopy(mannRaw, 'mann_filter_applications');
const variants = Map.groupBy(rows, r => r.vehicleVariantKey);
const jiti = createJiti(import.meta.url, { alias: { '@': resolve(root, 'src') } });
const { matchFluidRequirementToMann, normalizeFluidRequirementVehicle } = await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const { mannMakeFormsForTest } = await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const { normalizeMannText } = await jiti.import('../src/lib/mann-catalog.ts');
const makeCache = new Map(), results = [];
for (const old of revisions) {
  const source = sources.get(old.sourceRequirementId), decision = decisions.get(old.sourceRequirementId);
  assert.ok(source && decision);
  const windows = (variants.get(old.vehicleVariantKey) ?? []).map(row => applicabilityWindow(source, row));
  const window = windows.length && windows.every(Boolean) && new Set(windows.map(sha)).size === 1 ? windows[0] : null;
  const make = normalizeFluidRequirementVehicle(source)?.canonicalMake;
  let recheck = null, candidate = null;
  if (window && make) {
    if (!makeCache.has(make)) { const forms = new Set(mannMakeFormsForTest(make)); makeCache.set(make, rows.filter(row => forms.has(normalizeMannText(row.makeNormalized || row.make)))); }
    recheck = matchFluidRequirementToMann({ ...source, ...window.narrowedYears }, makeCache.get(make));
    candidate = recheck.topCandidates.find(c => c.variantIds.includes(old.vehicleVariantKey));
  }
  const reasons = [];
  if (!window) reasons.push('MONTH_SCOPE_UNKNOWN_OR_INCONSISTENT');
  if (decision.capacity.needsReview) reasons.push('CAPACITY_REQUIRES_REVIEW');
  if (decision.proposals.length) reasons.push('OTHER_VARIANT_HAS_SUCCESSOR');
  if (window && !candidate) reasons.push('OLD_TARGET_NOT_IN_TOP_CANDIDATES');
  if (candidate?.hardConflicts.length) reasons.push('HARD_CONFLICT');
  if (candidate?.reviewBlockers.length) reasons.push('APPLICABILITY_BLOCKER');
  if (candidate && candidate.score < 80) reasons.push('SCORE_BELOW_80');
  if (candidate && !candidate.matchedFields.includes('точный код двигателя')) reasons.push('NO_EXACT_ENGINE');
  if (candidate && candidate.variantIds.length !== 1) reasons.push('GROUPED_VARIANTS');
  if (recheck?.targets.some(t => t.vehicleVariantKey === old.vehicleVariantKey)) reasons.push('TARGET_PASSES_SCOPED_RECHECK');
  if (!reasons.length) reasons.push('REQUIRES_POLICY_REVIEW');
  results.push({ revisionId: old.id, sourceRequirementId: source.id, vehicleVariantKey: old.vehicleVariantKey,
    vehicle: decision.vehicle, systemCode: source.systemCode, sourceUrl: source.sourceUrl,
    oldMatchScore: old.matchScore, currentDisposition: decision.disposition, currentBlockers: decision.blockers,
    currentOtherProposals: decision.proposals.map(p => p.vehicleVariantKey), reasons, window,
    recheckStatus: recheck?.status, top1Top2Gap: recheck?.top1Top2Gap, candidate,
    topCandidate: recheck?.topCandidates[0], publicationAllowed: false });
  if (results.length % 25 === 0) console.log(JSON.stringify({ processed: results.length, total: revisions.length }));
}
assert.equal(results.length, ids.size);
const counts = Object.fromEntries([...new Set(results.flatMap(r => r.reasons))].map(reason => [reason, results.filter(r => r.reasons.includes(reason)).length]));
const report = { kind: 'UNREPLACED_REVISION_AUDIT', inputs: { plan: sha(planRaw), live: sha(liveRaw), decisions: sha(decisionsRaw), mann: sha(mannRaw), source: sha(sourceRaw) },
  total: results.length, sourceRequirements: new Set(results.map(r => r.sourceRequirementId)).size, counts, productionApplyAllowed: false, results };
const output = resolve(dir, process.argv[2] || 'unreplaced-audit.json');
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ output, total: report.total, sourceRequirements: report.sourceRequirements, counts }, null, 2));
