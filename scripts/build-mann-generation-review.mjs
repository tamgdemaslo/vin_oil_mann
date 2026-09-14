import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCopy, sha } from './lib/mann-offline-scope.mjs';
const root = resolve(import.meta.dirname, '..'), dir = resolve(root, 'outputs/mann-parentheses-scoped-2026-09-13');
const comparisonRaw = await readFile(resolve(dir, 'comparison.json'), 'utf8');
const sourceRaw = await readFile('/tmp/vehicle_fluid_requirements.sql', 'utf8');
const decisionsRaw = await readFile(resolve(dir, 'decisions.ndjson'), 'utf8');
const sources = new Map(parseCopy(sourceRaw, 'vehicle_fluid_requirements').map(r => [r.id, r]));
const decisions = new Map(decisionsRaw.trim().split('\n').map(JSON.parse).map(r => [r.requirementId, r]));
const comparison = JSON.parse(comparisonRaw);
const rows = comparison.lost.map(lost => {
  const source = sources.get(lost.requirementId), decision = decisions.get(lost.requirementId);
  assert.ok(source && decision && decision.proposals.length === 0);
  const category = source.model === 'corolla' ? 'COMPETING_POWER_VARIANT'
    : source.model === 'tiida' ? 'REGIONAL_GENERATION_NUMBERING_UNVERIFIED'
    : 'DERIVATIVE_MODEL_GENERATION_AND_MARKET_REVIEW';
  return { requirementId: source.id, systemCode: source.systemCode, category,
    sourceIdentity: { make: source.make, model: source.model, modelNormalized: source.modelNormalized,
      generation: source.generation, bodyCodes: source.bodyCodesJson, engine: source.engineCodeNormalized,
      years: [source.yearFrom, source.yearTo], powerHp: source.powerHp, powerKw: source.powerKw },
    previousVariantKeys: lost.removed, sourceUrl: source.sourceUrl,
    candidates: decision.match.topCandidates.slice(0, 3).map(c => ({ variantIds: c.variantIds, model: c.model,
      vehicleText: c.vehicleText, engineCode: c.engineCode, vehicleYears: c.vehicleYears,
      score: c.score, hardConflicts: c.hardConflicts, reviewBlockers: c.reviewBlockers, featureContributions: c.featureContributions })),
    autoRestoreAllowed: false };
});
assert.equal(rows.length, comparison.noLongerProposedRequirements);
const groups = [...Map.groupBy(rows, r => `${r.sourceIdentity.model}:${r.sourceIdentity.generation}`)].map(([key, records]) => ({ key, category: records[0].category, requirementIds: records.map(r => r.requirementId), requirements: records.length }));
const report = { kind: 'LOST_ASSOCIATION_GENERATION_REVIEW', inputs: { comparison: sha(comparisonRaw), source: sha(sourceRaw), decisions: sha(decisionsRaw) },
  requirements: rows.length, groups, productionApplyAllowed: false,
  conclusion: 'Generation numbering is model/market-specific. No automatic generation substitution or restoration of lost fluid links is authorized by vehicle-history evidence.', rows };
await writeFile(resolve(dir, 'generation-review.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ requirements: rows.length, groups }, null, 2));
