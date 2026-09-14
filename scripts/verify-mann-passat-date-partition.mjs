import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-disputed-year-preview-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--specific-body'));
const version=process.argv[2]==='--specific-body'?2:1;
const [raw,sourceRaw,scopeRaw]=await Promise.all([readFile(resolve(dir,`passat-date-preview-supplement-v${version}.json`),'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile(resolve(dir,`passat-date-final-scopes-v${version}.json`),'utf8')]);
const report=JSON.parse(raw),scopes=JSON.parse(scopeRaw);
assert.equal(report.inputs.source,sha(sourceRaw));assert.equal(report.inputs.run,sha(scopeRaw));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
let months=0,coveredMonths=0,pendingMonths=0;
const ids=new Set(scopes.results.map(r=>r.requirementId));
for(const item of report.pendingSourceScopes){
  assert.ok(ids.has(item.requirementId));assert.deepEqual(item.originalSource,sources.get(item.requirementId));
  assert.equal(item.sourceHash,sha(item.originalSource));assert.equal(item.publicationAllowed,false);
  assert.ok(item.window.from<=item.window.to);
}
for(const id of ids){
  const source=sources.get(id),engineCodes=[...new Set([source.engineCodeNormalized,...source.engineCodesJson].map(normalizeEngineCode).filter(Boolean))];
  for(const engine of engineCodes){
    const accepted=report.revisions.filter(r=>r.sourceRequirementId===id&&r.applicabilityJson.matchedEngineScope.includes(engine));
    const pending=report.pendingSourceScopes.filter(r=>r.requirementId===id&&r.matchedEngineScope.includes(engine));
    for(const item of [...accepted.map(r=>r.applicabilityJson.window.intersection),...pending.map(r=>r.window)]){
      assert.ok(item.from>=`${source.yearFrom}-01`&&item.to<=`${source.yearTo}-12`);
    }
    for(let year=source.yearFrom;year<=source.yearTo;year++)for(let month=1;month<=12;month++){
      const stamp=`${year}-${String(month).padStart(2,'0')}`,inside=w=>w.from<=stamp&&stamp<=w.to;
      const covered=accepted.some(r=>inside(r.applicabilityJson.window.intersection));
      const awaiting=pending.filter(r=>inside(r.window)).length;
      assert.equal(awaiting,covered?0:1,`${id}/${engine}/${stamp}: omitted, duplicated or wrongly held month`);
      months++;if(covered)coveredMonths++;else pendingMonths++;
    }
  }
}
const result={supplementHash:sha(raw),sourceRequirements:ids.size,revisions:report.revisions.length,
  pendingScopes:report.pendingSourceScopes.length,months,coveredMonths,pendingMonths,productionApplyAllowed:false,
  limitation:'Exact source-engine-month accounting only; unrepresented intervals remain pending, not disproved or approved.'};
await writeFile(resolve(dir,`passat-date-partition-verification-v${version}.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result,null,2));
