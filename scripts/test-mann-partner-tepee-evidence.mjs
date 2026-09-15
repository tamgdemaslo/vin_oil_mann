import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..');
const e=JSON.parse(await readFile(resolve(root,'data/mann-partner-tepee-model-evidence-v1.json'),'utf8'));
const pre=JSON.parse(await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/vin-priority-fluid-preflight-v4.json'),'utf8'));
const f=pre.findings.find(f=>f.sourceRequirementId===e.sourceRequirementId&&f.vehicleVariantKey===e.vehicleVariantKey);assert.ok(f);
assert.deepEqual(f.scope.sourceVehicleScope,{make:e.sourceVehicle.make,model:e.sourceVehicle.model,generation:e.sourceVehicle.generation});
assert.deepEqual(f.scope.window.intersection,e.sourceBranchWindow);assert.deepEqual(f.branch.powerHp,[e.sourceVehicle.powerHp]);assert.equal(f.branch.engineCode,e.sourceVehicle.engineCode);
const rows=parseCopy(await readFile('/tmp/mann_filter_applications.sql','utf8'),'mann_filter_applications').filter(r=>r.vehicleVariantKey===e.vehicleVariantKey);assert.ok(rows.length);
for(const r of rows){assert.equal(r.make,'PEUGEOT');assert.equal(r.model,'Partner II');assert.equal(r.engineCode,'TU5JP4B');assert.equal(Number(r.hp),90);assert.equal(Number(r.kw),66);assert.equal(r.vehicleYears,'04/08 ->');}
assert.equal(e.observations.length,2);assert.equal(e.productionApplyAllowed,false);
console.log(JSON.stringify({test:'PARTNER_TEPEE_EXTERNAL_EVIDENCE_ARCHIVE_JOIN',catalogRows:rows.length,sourceBranchPreserved:true,acceptanceRuleChanged:false}));
