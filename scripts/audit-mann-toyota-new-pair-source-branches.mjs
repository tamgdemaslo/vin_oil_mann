import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {toyotaExplicitEngineBranches as parseBranches} from './lib/mann-toyota-explicit-engine-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-transmission-list-preview-2026-09-14');
const [sql,mannRaw,rawText,replayRaw]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8'),readFile(resolve(dir,'toyota-az-fix-replay-v1.json'),'utf8')]);
const replay=JSON.parse(replayRaw);assert.equal(replay.sourceHash,sha(sql));assert.equal(replay.mannHash,sha(mannRaw));
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r])),mann=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const rows=rawText.trim().split('\n').map(JSON.parse),byId=new Map(rows.map(r=>[r.row_id,r])),tables=Map.groupBy(rows,r=>JSON.stringify([r.source_url,r.table_index]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseFluidCapacities}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {splitMannEngineCodeList:split}=await jiti.import('../src/lib/mann-engine-code-list.ts');
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const results=[];
for(const item of replay.results.filter(r=>r.newTargetKeys.length)){
 const source=sources.get(item.sourceRequirementId);assert.equal(sha(source),item.sourceHash);
 const raw=byId.get(source.sourceRowId);assert.ok(raw);assert.equal(raw.source_url,source.sourceUrl);
 const anchors=tables.get(JSON.stringify([raw.source_url,raw.table_index])).filter(r=>/МАСЛО\s+в\s+ДВИГАТЕЛЬ/iu.test(r.application));
 const relevant=source.systemCode==='ENGINE_OIL'?anchors.filter(r=>r.row_id===raw.row_id):anchors;
 const evidence=relevant.map(r=>({rowId:r.row_id,rowHash:sha(r),model:r.model,years:r.production_years,branches:parseBranches(r.model)}));
 for(const key of item.newTargetKeys){
  const target=mann.get(key);assert.ok(target?.length);
  const reasons=[],windows=target.map(r=>applicabilityWindow(source,r)),capacity=parseFluidCapacities(source.fillVolumeText,source.systemCode);
  if(windows.some(w=>!w)||new Set(windows.map(sha)).size!==1)reasons.push('MANN_MONTH_SCOPE_MISSING_OR_INCONSISTENT');
  if(!evidence.length||evidence.some(e=>!e.branches))reasons.push('SOURCE_ENGINE_BRANCH_TEXT_REQUIRES_REVIEW');
  const branches=evidence.flatMap(e=>(e.branches??[]).map(b=>({...b,anchorRowId:e.rowId})));
  const matching=branches.filter(b=>target.every(r=>split(r.engineCode).map(norm).includes(norm(b.engineCode))&&String(r.hp??'').trim()===String(b.powerHp)));
  if(!matching.length)reasons.push('NO_EXACT_ENGINE_POWER_BRANCH');
  if(branches.some(b=>b.requiredMarket))reasons.push('EXPLICIT_SOURCE_MARKET_BRANCH_REQUIRED');
  if(capacity.needsReview||!capacity.capacities.length)reasons.push('CAPACITY_REQUIRES_REVIEW');
  if(branches.length>1)reasons.push('SOURCE_BRANCH_SCOPE_REQUIRED');
  results.push({sourceRequirementId:source.id,sourceHash:sha(source),vehicleVariantKey:key,systemCode:source.systemCode,originalSource:source,evidence,matchingBranches:matching,targetPower:[...new Set(target.map(r=>r.hp))],windows,capacity,reasons,publicationAllowed:false});
 }
}
assert.equal(results.length,9);
const report={sourceHash:sha(sql),rawHash:sha(rawText),mannHash:sha(mannRaw),replayHash:sha(replayRaw),helperHash:sha(await readFile(resolve(root,'scripts/lib/mann-toyota-explicit-engine-branches.mjs'),'utf8')),summary:{pairs:results.length,sourceRequirements:new Set(results.map(r=>r.sourceRequirementId)).size,withExactEnginePowerBranch:results.filter(r=>r.matchingBranches.length).length,unrestrictedReady:results.filter(r=>!r.reasons.length).length,reasons:Object.fromEntries([...Map.groupBy(results.flatMap(r=>r.reasons),r=>r)].map(([k,v])=>[k,v.length]))},results,productionApplyAllowed:false,limitation:'Explicit raw source branch extraction, not applicability approval. Market/power/year branches and capacity alternatives must be rechecked separately. No missing dates inferred.'};
await writeFile(resolve(dir,'toyota-new-pair-source-branches-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
