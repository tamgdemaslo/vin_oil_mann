import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {sourceMarketBranches} from './lib/mann-source-market-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-non-ru-market-guarded-preview-2026-09-14');
const [planRaw,partitionRaw,sql,archive]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'source-market-month-partition-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const plan=JSON.parse(planRaw),partition=JSON.parse(partitionRaw);assert.equal(partition.planHash,sha(planRaw));assert.equal(sha(sql),plan.inputHashes.source);
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r])),rows=archive.trim().split('\n').map(JSON.parse),byId=new Map(rows.map(r=>[r.row_id,r])),byHash=new Map(rows.map(r=>[sha(r),r]));
const index=m=>Number(m.slice(0,4))*12+Number(m.slice(5))-1;
const inside=(w,n)=>(w.from===null||index(w.from)<=n)&&(w.to===null||index(w.to)>=n);
let monthChecks=0;const findings=[];
for(const f of partition.findings){
 const source=sources.get(f.sourceRequirementId),raw=byId.get(source.sourceRowId),anchor=byHash.get(f.anchorHash);assert.ok(anchor&&raw);assert.equal(anchor.source_url,raw.source_url);assert.equal(anchor.table_index,raw.table_index);assert.equal(anchor.system_name,'МАСЛО в ДВИГАТЕЛЬ');
 const parsed=sourceMarketBranches(anchor.model,anchor.production_years);assert.ok(parsed);
 const expected=parsed.flatMap(b=>b.powerHp.map(powerHp=>({engineCode:b.engineCode,powerHp,requiredMarket:b.market,sourceWindow:b.window,sourcePhrase:b.sourcePhrase})));
 assert.deepEqual(f.partition.map(({candidateWindows,pendingWindows,publicationAllowed,...b})=>b),expected);
 let checked=0;
 for(const branch of f.partition){
  // Exhaustive month truth table across the entire application-supported year domain.
  // Direct membership checks are independent of the interval subtraction implementation.
  for(let n=1886*12;n<2101*12;n++){
   const supported=inside(branch.sourceWindow,n),candidate=branch.candidateWindows.filter(w=>inside(w,n)).length,pending=branch.pendingWindows.filter(w=>inside(w,n)).length;
   assert.equal(candidate+pending,supported?1:0,`${f.revisionId} ${branch.engineCode}/${branch.powerHp}/${branch.requiredMarket} month ${n}`);checked++;
  }
 }
 monthChecks+=checked;findings.push({revisionId:f.revisionId,sourceRequirementId:source.id,sourceHash:sha(source),anchorHash:f.anchorHash,branches:expected.length,monthChecks:checked,publicationAllowed:false});
}
const summary={revisions:findings.length,monthChecks,noSourceBranchesLost:true,noMonthGapsOrOverlaps:true};
await writeFile(resolve(dir,'source-market-month-partition-verification-v1.json'),JSON.stringify({planHash:sha(planRaw),partitionHash:sha(partitionRaw),sourceHash:sha(sql),rawHash:sha(archive),summary,findings,productionApplyAllowed:false,limitation:'Independent original raw source branch and exhaustive 1886–2100 month partition verification. Candidate windows are not approved matches. Unbounded tail algebra separately covered by interval tests; does not establish vehicle identity or technical facts.'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
