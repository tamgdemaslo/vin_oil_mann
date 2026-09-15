import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel,applyFuelCorrections} from './lib/mann-source-fuel-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
const previousRaw=await readFile(resolve(dir,'volvo-fuel-candidate-replay-v1.json'),'utf8');assert.equal(sha(previousRaw),'f89a05aa6f8cae28239ec8a03f100e0ea940dc94dc9cba357bc171b740bd5706');const previous=JSON.parse(previousRaw);
assert.equal(sha(sql),previous.hashes.sql);assert.equal(sha(mannRaw),previous.hashes.mann);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),previous.hashes.plan);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),previous.hashes.raw);
const identity=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,raw),originalHash=sha(power.requirements);
const fuel=await applyAuditedSourceFuel(root,power.requirements,raw);assert.equal(sha(power.requirements),originalHash);
let unchanged=0;
for(let i=0;i<fuel.requirements.length;i++){
 const before=power.requirements[i],after=fuel.requirements[i];
 if(!fuel.changes.has(after.id)){assert.equal(after,before);unchanged++;continue;}
 const {sourceFuelCorrection,...rest}=after.rawRequirementJson;
 assert.deepEqual({...after,fuelType:before.fuelType,rawRequirementJson:rest},before);
 assert.equal(sourceFuelCorrection.technicalReviewRequired,true);
}
const proof=JSON.parse(await readFile(resolve(dir,'volvo-fuel-import-transition-v1.json'),'utf8'));
assert.throws(()=>applyFuelCorrections(fuel.requirements,proof,fuel.fresh));
for(const tamper of [p=>p.differences.push(p.differences[0]),p=>p.differences[0].afterFuel='gasoline',p=>p.differences[0].provenance.marketReviewRequired='tampered']){
 const bad=structuredClone(proof);tamper(bad);assert.throws(()=>applyFuelCorrections(power.requirements,bad,fuel.fresh));
}
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
for(const path of ['mann-fluid-matcher-v2.ts','mann-vehicle-resolver.ts','vehicle-normalization.ts','mann-row-generation-evidence.ts'])assert.equal(sha(await readFile(resolve(root,'src/lib',path),'utf8')),previous.hashes[path]);
const forms=new Set(mannMakeFormsForTest('VOLVO')),catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));assert.equal(catalog.length,1362);
const findings=[];
for(const source of fuel.requirements.filter(r=>fuel.changes.has(r.id))){
 const parsed=fuel.fresh.get(source.id),input={...source,engineCodeNormalized:parsed.engineCodeNormalized,engineCodesJson:parsed.engineCodesJson};
 const decision=match(input,catalog),old=previous.findings.find(f=>f.sourceRequirementId===source.id);assert.ok(old);
 // Historical report is JSON: compare the same persisted representation,
 // where optional undefined object properties are omitted.
 assert.deepEqual(JSON.parse(JSON.stringify(decision)),old.newDecision);
 findings.push({sourceRequirementId:source.id,decision,provenance:source.rawRequirementJson.sourceFuelCorrection,canonical:old.canonical,publicationAllowed:false});
}
const summary={requirements:fuel.requirements.length,corrected:fuel.changes.size,unchanged,fullDecisionsEqualPreviousProbe:findings.length,tamperAndDoubleApplicationChecks:4,originalSqlAndInputsUnchanged:true};
await writeFile(resolve(dir,'source-fuel-overlay-verification-v1.json'),JSON.stringify({kind:'AUDITED_SOURCE_FUEL_OVERLAY_MATCHER_VERIFICATION',summary,proofHash:fuel.proofHash,parserHash:fuel.parserHash,planHash:sha(planRaw),previousReplayHash:sha(previousRaw),overlayHash:sha(await readFile(resolve(root,'scripts/lib/mann-source-fuel-overlay.mjs'),'utf8')),findings,productionApplyAllowed:false,limitations:['New explicit overlay is consumed by this matcher verification; historical identity-only scripts keep original fuel until migrated explicitly.','Nineteen matcher decisions checked; unchanged source objects are not a whole-base applicability verification.','No canonical revision refresh, SQL import or production publication.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
