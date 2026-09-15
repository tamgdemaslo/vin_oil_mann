import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-live-audit-1789469257907');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sourceRaw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const originals=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const archive=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
const identity=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,archive),fuel=await applyAuditedSourceFuel(root,power.requirements,archive);
const sources=fuel.requirements.map(s=>({...s,engineCodeNormalized:fuel.fresh.get(s.id).engineCodeNormalized,engineCodesJson:fuel.fresh.get(s.id).engineCodesJson})),mann=parseCopy(mannRaw,'mann_filter_applications');
const manifest=JSON.parse(await readFile(resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2/manifest.json'),'utf8'));
assert.equal(sha(sources),manifest.correctedSourcesHash);
const liveRaw=await readFile(resolve(dir,'revisions.json'),'utf8'),live=JSON.parse(liveRaw);
const replay=JSON.parse(await readFile(resolve(dir,'recorded-vin-fluid-transmission-replay.json'),'utf8'));
const wanted=new Set(['5d2f01e54866ee1b','a228bb4e004fc385','4a9b52c189f3eacc','00a4fbe1e2009760']);
const samples=replay.findings.filter(f=>wanted.has(f.sampleRef));assert.equal(samples.length,4);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {normalizeVehicleMake}=await j.import('../src/lib/vehicle-normalization.ts');
const findings=[];
for(const s of sources.filter(r=>r.systemCode.endsWith('_TRANSMISSION')&&((r.model==='rio'&&r.engineCodeNormalized==='G4LC')||['largus','fabia','teana'].includes(r.model)))){
  const brand=mann.filter(r=>normalizeVehicleMake(r.make)===normalizeVehicleMake(s.make));
  assert.ok(brand.length,'Expected canonical brand in MANN archive');
  // Full brand ranking, never force the recorded candidate to win.
  const decision=match(s,brand);
  const contexts=samples.flatMap(f=>f.evaluations.filter(e=>e.model.toLowerCase()===s.model).flatMap(e=>e.candidates.filter(c=>c.transmissionOptions.length).map(c=>({sampleRef:f.sampleRef,variantIds:c.variantIds,context:c.vehicleContext}))));
  const links=live.filter(r=>r.sourceRequirementId===s.id);
  findings.push({sourceId:s.id,sourceHash:sha(originals.get(s.id)),effectiveSourceHash:sha(s),identityCorrection:identity.changes.get(s.id)??null,make:s.make,model:s.model,generation:s.generation,engine:s.engineCodeNormalized,engineCodes:s.engineCodesJson,yearFrom:s.yearFrom,yearTo:s.yearTo,system:s.systemCode,component:s.componentModel,decision,contexts,links:links.map(r=>({id:r.id,key:r.vehicleVariantKey,state:r.state})),
    recordedCandidateTargets:decision.targets.filter(t=>contexts.some(c=>c.variantIds.includes(t.vehicleVariantKey)))});
}
const summary={sources:findings.length,unlinked:findings.filter(f=>!f.links.length).length,withValidatedRecordedTarget:findings.filter(f=>f.recordedCandidateTargets.some(t=>t.independentlyValidated)).length};
await writeFile(resolve(dir,'transmission-source-gap-audit-v3.json'),JSON.stringify({kind:'POSTIMPORT_TRANSMISSION_SOURCE_GAPS',sourceHash:sha(sourceRaw),correctedSourcesHash:sha(sources),identityOverlay:identity.metadata,mannHash:sha(mannRaw),liveHash:sha(liveRaw),summary,findings,limitations:['Uses existing audited identity/power/fuel/engine corrections; original source rows unchanged.','Full canonical-brand ranking is matching evidence, not proof of actual gearbox or source fluid correctness.','No DB changes, no new published revisions.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({summary,findings:findings.map(f=>({model:f.model,engine:f.engine,system:f.system,status:f.decision.status,recordedTargets:f.recordedCandidateTargets,top:f.decision.topCandidates.slice(0,1).map(c=>({blockers:c.reviewBlockers,conflicts:c.hardConflicts}))}))},null,2));
