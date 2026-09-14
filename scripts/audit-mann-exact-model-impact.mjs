import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { parseCopy, sha } from './lib/mann-offline-scope.mjs';

const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'outputs/mann-combined-preview-plan-2026-09-13');
const jiti = createJiti(import.meta.url, {alias: {'@': resolve(root, 'src')}});
const {hasExactMannModelIdentity} = await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeFluidRequirementVehicle} = await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const [sourceRaw, mannRaw, planRaw] = await Promise.all([
  readFile('/tmp/vehicle_fluid_requirements.sql', 'utf8'),
  readFile('/tmp/mann_filter_applications.sql', 'utf8'),
  readFile(resolve(dir, 'plan.json'), 'utf8'),
]);
const plan = JSON.parse(planRaw);
assert.equal(plan.inputHashes.source, sha(sourceRaw));
const sources = new Map(parseCopy(sourceRaw, 'vehicle_fluid_requirements').map(r => [r.id, r]));
const variants = Map.groupBy(parseCopy(mannRaw, 'mann_filter_applications'), r => r.vehicleVariantKey);
const rejected = [];
for (const revision of plan.newRevisions) {
  const source = sources.get(revision.sourceRequirementId);
  const rows = variants.get(revision.vehicleVariantKey);
  assert.ok(source && rows?.length);
  const vehicle = normalizeFluidRequirementVehicle(source);
  if (!vehicle || !rows.every(row => hasExactMannModelIdentity(source.model, vehicle.canonicalMake, row))) {
    rejected.push({revisionId: revision.id, requirementId: source.id, vehicleVariantKey: revision.vehicleVariantKey,
      sourceMake: source.make, sourceModel: source.model, sourceGeneration: source.generation,
      sourceUrl: source.sourceUrl, mannModels: [...new Set(rows.map(r => r.model))], systemCode: source.systemCode});
  }
}
const groups = [...Map.groupBy(rejected, r => JSON.stringify([r.sourceMake, r.sourceModel, r.mannModels]))]
  .map(([identity, rows]) => ({identity: JSON.parse(identity), revisions: rows.length}));
const report = {kind: 'EXACT_MODEL_GATE_IMPACT', productionApplyAllowed: false,
  limitation: 'Identity gate only on existing candidate plan; not a full matcher rerank or OEM verification. Rejections require review, not source deletion.',
  hashes: {source: sha(sourceRaw), mann: sha(mannRaw), plan: sha(planRaw),
    resolver: sha(await readFile(resolve(root, 'src/lib/mann-vehicle-resolver.ts'), 'utf8')),
    matcher: sha(await readFile(resolve(root, 'src/lib/mann-fluid-matcher-v2.ts'), 'utf8'))},
  checkedRevisions: plan.newRevisions.length, retainedByModelGate: plan.newRevisions.length - rejected.length,
  rejectedRevisions: rejected.length, rejectedSourceRequirements: new Set(rejected.map(r => r.requirementId)).size,
  groups, rejected};
await writeFile(resolve(dir, 'exact-model-impact-v2.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
console.log(JSON.stringify({...report, rejected: undefined}, null, 2));
