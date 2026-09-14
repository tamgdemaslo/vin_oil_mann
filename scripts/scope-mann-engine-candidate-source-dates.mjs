import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const raw=await readFile(resolve(dir,'engine-line-candidate-scope-replay-v1.json'),'utf8'),replay=JSON.parse(raw);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(replay.sourceHash,sha(sourceRaw));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {extractFluidSourceDateCondition:extract}=await jiti.import('../src/lib/fluid-source-date-condition.ts');
const {mannTechnicalScopeMatches:matches}=await jiti.import('../src/lib/mann-technical-applicability.ts');
const results=replay.candidates.map(candidate=>{
  const source=sources.get(candidate.requirementId);assert.ok(source);assert.equal(sha(source),candidate.sourceHash);
  const condition=extract(source.systemNameRaw??'');
  if(!condition)return {...candidate,sourceDateCondition:null,dateScopeStatus:'NO_SUPPORTED_LITERAL_DATE'};
  assert.equal(condition.status,'FULL_MONTH_SCOPE');
  const original=candidate.applicability.window.intersection;
  const from=[original.from,condition.from].filter(Boolean).sort().at(-1)??null;
  const to=[original.to,condition.to].filter(Boolean).sort()[0]??null;
  if(from&&to&&from>to)return {...candidate,sourceDateCondition:condition,applicability:null,dateScopeStatus:'NO_COMPLETE_MONTH_WITHIN_SOURCE_DATE'};
  const applicability={...candidate.applicability,window:{...candidate.applicability.window,intersection:{from,to}},sourceDateCondition:condition};
  const context={...applicability.sourceVehicleScope,engineCode:candidate.engineCode};
  for(const productionMonth of [from,to].filter(Boolean))assert.equal(matches(applicability,{...context,productionMonth}),true);
  if(condition.unresolvedBoundaryMonth)assert.equal(matches(applicability,{...context,productionMonth:condition.unresolvedBoundaryMonth}),false);
  return {...candidate,applicability,sourceDateCondition:condition,dateScopeStatus:'FULL_MONTH_DATE_SCOPED'};
});
const report={kind:'ENGINE_CANDIDATE_LITERAL_SOURCE_DATE_SCOPES',replayHash:sha(raw),sourceHash:sha(sourceRaw),
  helperHash:sha(await readFile(resolve(root,'src/lib/fluid-source-date-condition.ts'),'utf8')),productionApplyAllowed:false,
  summary:{contexts:results.length,withSourceDate:results.filter(r=>r.sourceDateCondition).length,
    sourceDateRequirements:new Set(results.filter(r=>r.sourceDateCondition).map(r=>r.requirementId)).size,
    noCompleteMonth:results.filter(r=>!r.applicability).length},
  limitation:'Boundary months require exact production date or further source verification. No publication revisions; unrecognized labels and other source conditions remain unverified.',results};
await writeFile(resolve(dir,'engine-candidate-source-date-scopes-v2.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
