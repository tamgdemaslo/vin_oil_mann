import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-combined-preview-plan-2026-09-13');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {normalizeVehicleModel}=await jiti.import('../src/lib/vehicle-normalization.ts');
const [sourceRaw,mannRaw,correctionsRaw]=await Promise.all([
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'source-reparse-identity-v4.json'),'utf8')]);
const corrections=JSON.parse(correctionsRaw);
assert.equal(corrections.hashes.source,sha(sourceRaw));
assert.equal(corrections.hashes.parser,sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8')));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const mann=parseCopy(mannRaw,'mann_filter_applications').filter(r=>r.makeNormalized==='OPEL');
assert.ok(mann.length);
const variants=Map.groupBy(mann,r=>r.vehicleVariantKey);
const findings=[];
for(const change of corrections.changes.filter(r=>r.sourceUrl.includes('/opel/'))){
  const original=sources.get(change.requirementId);assert.ok(original);
  const source={...original,...change.after};
  const before=matchFluidRequirementToMann(original,mann),after=matchFluidRequirementToMann(source,mann);
  for(const target of after.targets){
    assert.ok(target.independentlyValidated);
    for(const row of variants.get(target.vehicleVariantKey))assert.equal(normalizeVehicleModel(row.model,'OPEL').generation,source.generation,'Cross-generation target');
  }
  findings.push({requirementId:source.id,sourceUrl:source.sourceUrl,systemCode:source.systemCode,generation:source.generation,
    beforeStatus:before.status,afterStatus:after.status,targets:after.targets.map(t=>t.vehicleVariantKey),
    candidates:after.topCandidates.map(c=>({hardConflicts:c.hardConflicts,reviewBlockers:c.reviewBlockers}))});
}
const count=key=>Object.fromEntries([...Map.groupBy(findings,r=>r[key])].map(([key,rows])=>[key,rows.length]));
const report={kind:'FULL_MAKE_OPEL_GENERATION_RECHECK',productionApplyAllowed:false,
  limitation:'Full source year ranges, not month-scoped proposals. Checks matcher generation separation, not source fluid accuracy or production output.',
  hashes:{source:sha(sourceRaw),mann:sha(mannRaw),corrections:sha(correctionsRaw),
    matcher:sha(await readFile(resolve(root,'src/lib/mann-fluid-matcher-v2.ts'),'utf8')),
    resolver:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8'))},
  requirements:findings.length,mannRows:mann.length,before:count('beforeStatus'),after:count('afterStatus'),
  confirmedTargets:findings.reduce((n,r)=>n+r.targets.length,0),crossGenerationTargets:0,findings};
await writeFile(resolve(dir,'opel-generation-recheck.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,findings:undefined},null,2));
