import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha } from './lib/mann-offline-scope.mjs';

// Offline release audit only: never connects to a database or changes approvals.
const root = resolve(import.meta.dirname, '..');
const directory = 'outputs/mann-gentra-evidence-review-2026-09-14';
const reconciled = process.argv[2] === 'v2';
const evidence = {};
async function read(path) {
  const raw = await readFile(resolve(root, path), 'utf8');
  evidence[path] = sha(raw);
  return JSON.parse(raw);
}
const plan = await read(`${directory}/plan.json`);
const payload = await read(`${directory}/current-staging-payload-v16.json`);
const previous = await read(`${directory}/current-staging-payload-v15.json`);
const lifecycle = await read(`${directory}/current-staging-lifecycle-route-read-v15.json`);
const parents = await read(`outputs/mann-live-audit-1789415211923/canonical-parent-drafts-${reconciled ? 'v13' : 'v12'}.json`);
assert.equal(payload.planHash, evidence[`${directory}/plan.json`]);
assert.deepEqual(payload.revisions.map(row => row.originalRevision), plan.newRevisions);
assert.equal(payload.productionApplyAllowed, false);
assert.equal(payload.writeMode, 'DRY_RUN_ONLY');
assert.equal(lifecycle.payloadHash, evidence[`${directory}/current-staging-payload-v15.json`]);
assert.equal(parents.planHash, reconciled ? payload.planHash : previous.planHash);
if (reconciled) {
  assert.equal(parents.payloadHash, evidence[`${directory}/current-staging-payload-v16.json`]);
  assert.deepEqual([...parents.drafts, ...parents.existing].map(row => row.vehicleVariantKey).sort(), payload.variants.map(row => row.vehicleVariantKey).sort());
}
const current = new Map(payload.revisions.map(row => [row.originalRevision.id, row.originalRevision]));
for (const old of previous.revisions) assert.deepEqual(current.get(old.originalRevision.id), old.originalRevision);
assert.deepEqual(payload.existingActions, previous.existingActions);
const oldIds = new Set(previous.revisions.map(row => row.originalRevision.id));
const oldKeys = new Set(previous.variants.map(row => row.vehicleVariantKey));
const added = payload.revisions.filter(row => !oldIds.has(row.originalRevision.id));
const bySystem = {};
for (const { originalRevision: row } of payload.revisions) {
  const bucket = bySystem[row.systemCode] ??= { revisions: 0, variants: new Set(), powerHolds: 0 };
  bucket.revisions++;
  bucket.variants.add(row.vehicleVariantKey);
  if (row.provenanceJson.sourcePowerReviewHold) bucket.powerHolds++;
  assert.equal(row.applyEligible, false);
  assert.equal(row.verificationStatus, 'UNVERIFIED');
}
for (const bucket of Object.values(bySystem)) bucket.variants = bucket.variants.size;
assert.ok(payload.runs.every(run => run.status === 'PLANNED' && !run.productionApplyAuthorized && !run.independentHumanSignoff));
const report = {
  kind: 'OFFLINE_PUBLICATION_READINESS_AUDIT', evidence,
  summary: payload.summary, bySystem,
  previousPackagePreserved: true,
  packageDelta: { addedRevisions: added.length, addedVariantKeys: payload.variants.filter(row => !oldKeys.has(row.vehicleVariantKey)).map(row => row.vehicleVariantKey), existingActionsUnchanged: true },
  publicationReady: false, fullGoalAchieved: false, productionWritesPerformed: false,
  gates: [
    { gate: 'Current package exactly matches canonical plan', status: 'PASS' },
    { gate: 'Fresh Timeweb snapshot, review decisions and verified backup', status: 'NOT_VERIFIED', reason: 'Saved historical snapshot is not proof of current production state.' },
    { gate: 'Current package canonical parent reconciliation', status: reconciled ? 'PASS_SAVED_SNAPSHOT_ONLY' : 'STALE', reason: reconciled ? 'All 552 keys accounted for: 221 new parent drafts, 331 existing parents preserved. Four historical literal discrepancies are retained, not overwritten. Fresh production recheck still required.' : 'v12 parents cover v15, not the two additional v16 vehicle keys.' },
    { gate: 'Current package transactional import and rollback', status: 'STALE_LOCAL_ONLY', reason: 'v15 lifecycle covers 2043 revisions. Local helper is guarded to mann_fixture and uses synthetic run metadata. It is not a production importer.' },
    { gate: 'Production preview import, deployment and end-to-end VIN check', status: 'NOT_DONE', reason: 'PLANNED runs cannot display these revisions. A real completed STAGING run may expose qualified catalog previews without claiming primary-source verification; do not fake completion or remove applicability gates.' },
    { gate: 'All fluids for every VIN', status: 'NOT_PROVEN', reason: 'Package counts measure revisions, not vehicles with complete fluid coverage. Missing source applicability and missing vehicle context remain.' },
  ],
  nextActions: [
    ...(reconciled ? [] : ['Reconcile both additional vehicle keys without overwriting existing canonical parents.']),
    'Prepare a production-specific transactional preview importer with fresh snapshot/review assertions and a recoverable journal; do not adapt by removing the local fixture guard.',
    'Obtain approval for the bounded Timeweb operation and verify its backup; separately approve schema migrations if needed.',
    'After authorized transfer, verify the ordinary VIN route against production and report per-fluid missingness rather than any-fluid success.',
  ],
};
const output = resolve(root, directory, `publication-readiness-${reconciled ? 'v2' : 'v1'}.json`);
await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ summary: report.summary, delta: report.packageDelta, gates: report.gates, output }, null, 2));
