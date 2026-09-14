import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {intersectMonths,subtractMonths} from './lib/mann-month-intervals.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14');
const planPath=resolve(root,'outputs/mann-equipment-drive-added-preview-2026-09-14/plan.json'),planRaw=await readFile(planPath,'utf8');
assert.equal(sha(planRaw),'495618bdc0fd222732fe13c6d972c3d713e1cab35e4952702c8b93b5b42ece34');
const preRaw=await readFile(resolve(dir,'strong-source-conditions-v1.json'),'utf8'),pre=JSON.parse(preRaw),sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{explicitMannTransmissionModelYears:parse}=await j.import('../src/lib/mann-transmission-model-list.ts');
const ids=['f2493f4dde9d88d05e6c4f04dc6f631cdff899651411898f3326eb28bad1da0b','50dbaa06bd33e7d2ebe3cd8e8edf77059c8d8aea5e6fffcb149ab1f71c21bad8'];
let checks=0;const entries=ids.map(id=>{
 const f=pre.findings.find(f=>f.sourceRequirementId===id),s=sources.get(id);assert.deepEqual(s,f.originalSource);assert.equal(sha(s),f.sourceHash);
 const range=parse(s.componentModel);assert.ok(range);
 const componentWindow={from:`${range.yearFrom}-01`,to:`${range.yearTo}-12`},qualifiedSource=intersectMonths(f.window.source,componentWindow);assert.ok(qualifiedSource);
 const candidateWindow=intersectMonths(qualifiedSource,f.window.mann);assert.ok(candidateWindow);
 const pendingWindows=subtractMonths(qualifiedSource,[candidateWindow]),excludedBySourceCondition=subtractMonths(f.window.source,[qualifiedSource]);
 const contains=(w,m)=>w.from<=m&&m<=w.to;
 for(let y=s.yearFrom-1;y<=s.yearTo+1;y++)for(let month=1;month<=12;month++){
  const m=`${y}-${String(month).padStart(2,'0')}`;
  assert.equal(Number(contains(candidateWindow,m))+pendingWindows.filter(w=>contains(w,m)).length+excludedBySourceCondition.filter(w=>contains(w,m)).length,Number(contains(f.window.source,m)));checks++;
 }
 return {sourceRequirementId:id,originalSource:s,sourceHash:sha(s),targetId:f.targetId,componentModel:s.componentModel,parsedModelYearRange:range,originalSourceWindow:f.window.source,componentWindow,qualifiedSourceWindow:qualifiedSource,candidateWindow,pendingWindows,excludedBySourceCondition,publicationAllowed:false};
});
const report={planPath,planHash:sha(planRaw),preflightHash:sha(preRaw),sourceHash:sha(sql),entries,monthlyPartitionChecks:checks,productionApplyAllowed:false,limitation:'Source qualifier interpretation only; no OEM verification, installed gearbox inference, or merged draft. Outside component years is explicitly excluded, not silently lost or claimed as missing coverage.'};
await writeFile(resolve(dir,'qualified-gearbox-year-scopes-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({checks,scopes:entries.map(e=>({model:e.parsedModelYearRange.model,candidateWindow:e.candidateWindow,pendingWindows:e.pendingWindows,excluded:e.excludedBySourceCondition}))}));
