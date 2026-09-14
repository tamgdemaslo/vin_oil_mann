import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
const root = resolve(import.meta.dirname, '..');
const jiti = createJiti(import.meta.url, { alias: { '@': resolve(root, 'src') } });
const { buildMannUnifiedTechnicalProfile: profile } = await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const { readMannCapacityBranches } = await jiti.import('../src/lib/mann-capacity-branches.ts');
const plan = JSON.parse(await readFile(resolve(root,process.argv[2]??'outputs/mann-parentheses-scoped-2026-09-13','capacity-branch-plan.json'), 'utf8'));
let checked = 0;
for (const revision of plan.revisions) {
  const row = { ...revision, createdAt: new Date('2026-09-13'), reviewConfirmed: false,
    run: { status: 'COMPLETED', mode: 'STAGING', independentHumanSignoff: false, productionApplyAuthorized: false,
      gatesJson: { catalogPreviewPolicy: plan.policy, automaticProductSelection: false } } };
  const branches = readMannCapacityBranches(row.technicalDataJson, row.applicabilityJson, row.systemCode);
  assert.ok(branches?.length);
  for (const branch of branches) {
    const context = { ...row.applicabilityJson.sourceVehicleScope,engineCode: branch.applicabilityJson.matchedEngineScope?.[0], productionMonth: branch.applicabilityJson.window.intersection.from ?? branch.applicabilityJson.window.intersection.to };
    const transmission = branch.condition.kind === 'transmission' ? branch.condition.value : undefined;
    if (branch.condition.kind === 'engine') context.engineCode = branch.condition.value;
    const result = profile([row], transmission, context);
    assert.equal(result.items.length, 1, row.id);
    assert.equal(result.items[0].capacities.length, 1);
    const capacity = result.items[0].capacities[0];
    for (const field of ['nominalLiters', 'minLiters', 'maxLiters', 'toleranceLiters']) assert.equal(capacity[field] ?? null, branch.capacity[field] ?? null);
    assert.equal(result.items[0].automaticSelectionEligible, false);
    assert.equal(result.status, 'catalog_preview');
    if(row.applicabilityJson.sourceVehicleScope){
      assert.deepEqual(branch.applicabilityJson.sourceVehicleScope,row.applicabilityJson.sourceVehicleScope);
      assert.equal(profile([row],transmission,{...context,model:'WRONG_MODEL'}).items.length,0);
      assert.equal(profile([row],transmission,{...context,make:undefined}).items.length,0);
      if(context.generation)assert.equal(profile([row],transmission,{...context,generation:'WRONG'}).items.length,0);
    }
    if (transmission) {
      assert.ok(result.transmissionOptions.some(o => o.type === transmission));
      assert.equal(profile([row], undefined, context).items[0]?.capacities.length ?? 0, 0);
      assert.equal(profile([row], 'cvt', context).items[0]?.capacities.length ?? 0, 0);
    }
    assert.equal(profile([row], transmission, { ...context, engineCode: 'WRONG_ENGINE' }).items.length, 0);
    assert.equal(profile([row], transmission, { ...context, productionMonth: '1800-01' }).items.length, 0);
    const broken = structuredClone(row);
    broken.technicalDataJson.capacityBranches[0].sourceSegment = '999 л. без условия';
    broken.technicalDataJson.capacities = [{ nominalLiters: 999, confidence: 'HIGH' }];
    assert.equal(profile([broken], transmission, context).items.length, 0, 'malformed branches cannot fall back to unconditioned values');
    const conflicted = structuredClone(row);
    conflicted.technicalDataJson.capacityBranches[0].validation.hardConflicts = ['engine'];
    assert.equal(profile([conflicted], transmission, context).items.length, 0);
    const duplicate = structuredClone(row);
    duplicate.technicalDataJson.capacityBranches.push(duplicate.technicalDataJson.capacityBranches[0]);
    assert.equal(profile([duplicate], transmission, context).items.length, 0);
    checked++;
  }
}
assert.equal(checked, plan.summary.branches);
console.log(JSON.stringify({ result: 'PASS_CONDITIONAL_CAPACITY_PROFILE', revisions: plan.revisions.length, branches: checked, productionTest: false }));
