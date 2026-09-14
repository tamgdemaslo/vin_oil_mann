import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
const root = resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url, { alias: { '@': resolve(root, 'src') } });
const { buildMannUnifiedTechnicalProfile: profile } = await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const plan = JSON.parse(await readFile(resolve(root, process.argv[2] ?? 'outputs/mann-scoped-merge-plan-2026-09-13-v2', 'plan.json'), 'utf8'));
assert.equal(plan.productionApplyAllowed, false);
let checked = 0;
for (const planned of plan.newRevisions) {
  // Synthetic completed staging run: this tests runtime, not a production import.
  const row = { ...planned, createdAt: new Date('2026-09-13T00:00:00Z'), reviewConfirmed: false,
    run: { status: 'COMPLETED', mode: 'STAGING', independentHumanSignoff: false, productionApplyAuthorized: false,
      gatesJson: { catalogPreviewPolicy: plan.policy, automaticProductSelection: false } } };
  const window = row.applicabilityJson.window.intersection;
  const context = { ...row.applicabilityJson.sourceVehicleScope,engineCode: row.applicabilityJson.matchedEngineScope?.[0], productionMonth: window.from ?? window.to };
  assert.ok(context.productionMonth);
  const result = profile([row], undefined, context);
  assert.equal(result.items.length, 1, row.id);
  assert.equal(result.status, 'catalog_preview');
  assert.equal(result.items[0].automaticSelectionEligible, false);
  assert.equal(profile([row]).items.length, 0);
  assert.equal(profile([row], undefined, { ...context, productionMonth: 'invalid' }).items.length, 0);
  assert.equal(profile([row], undefined, { ...context, year: 1800 }).items.length, 0);
  if (context.engineCode) assert.equal(profile([row], undefined, { ...context, engineCode: 'WRONG_ENGINE' }).items.length, 0);
  if (row.applicabilityJson.sourceVehicleScope) {
    assert.equal(profile([row],undefined,{...context,model:'UNRELATED_MODEL'}).items.length,0);
    assert.equal(profile([row],undefined,{...context,model:undefined}).items.length,0);
    assert.equal(profile([row],undefined,{...context,make:undefined}).items.length,0);
    if(context.generation)assert.equal(profile([row],undefined,{...context,generation:'WRONG_GENERATION'}).items.length,0);
  }
  for (const field of ['window', 'matchedEngineScope']) {
    const applicabilityJson = { ...row.applicabilityJson }; delete applicabilityJson[field];
    assert.equal(profile([{ ...row, applicabilityJson }], undefined, context).items.length, 0, `missing ${field}`);
  }
  assert.equal(profile([{ ...row, provenanceJson: { ...row.provenanceJson, sourceTechnicalReviewRequired: false } }], undefined, context).items.length, 0);
  assert.equal(profile([{ ...row, run: { ...row.run, gatesJson: { ...row.run.gatesJson, catalogPreviewPolicy: 'MANN_V9_CONSERVATIVE_MATCHER' } } }], undefined, context).items.length, 0);
  checked++;
}
assert.equal(checked, plan.newRevisions.length);
console.log(JSON.stringify({ result: 'PASS_SCOPED_PLAN_RUNTIME', checked, limitation: 'Synthetic staging only; does not validate source facts, import, or production HTTP.' }));
