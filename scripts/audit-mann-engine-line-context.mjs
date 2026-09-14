import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const branchRaw=await readFile(resolve(dir,'source-engine-branches-v1.json'),'utf8');
const recheckRaw=await readFile(resolve(dir,'source-engine-branch-recheck-v1.json'),'utf8');
const snapshotRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
const branches=JSON.parse(branchRaw),recheck=JSON.parse(recheckRaw);
assert.equal(recheck.branchHash,sha(branchRaw));assert.equal(branches.snapshotHash,sha(snapshotRaw));
const rows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const key=r=>[r.requirementId,r.engineCode,r.engineAnchorRowId].join(':');
const matched=new Set(recheck.results.filter(r=>r.status==='HAS_MATCH').map(key));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {extractFluidEngineLineContext:extract}=await jiti.import('../src/lib/fluid-engine-line-context.ts');
const findings=branches.results.map(branch=>{
  const row=rows.get(branch.engineAnchorRowId);assert.ok(row);assert.equal(sha(row),branch.engineAnchorRowHash);
  const context=extract(row.application??'',branch.engineCode),reasons=[...context.reasons];
  for(const line of context.matchingLines){
    if(line.powerHp.some(v=>v!==branch.scope?.powerHp))reasons.push('LINE_POWER_HP_NEEDS_SCOPE');
    if(line.powerKw.some(v=>v!==branch.scope?.powerKw))reasons.push('LINE_POWER_KW_NEEDS_SCOPE');
    if(line.yearRanges.some(v=>v.from!==branch.scope?.yearFrom||v.to!==branch.scope?.yearTo))reasons.push('LINE_YEARS_NEED_SCOPE');
    if(line.driveEvidence.length)reasons.push('LINE_DRIVE_NEEDS_SCOPE');
    if(line.marketEvidence.length)reasons.push('LINE_MARKET_NEEDS_SCOPE');
  }
  return {requirementId:branch.requirementId,engineCode:branch.engineCode,engineAnchorRowId:branch.engineAnchorRowId,
    rawRowHash:sha(row),scope:branch.scope,hasMatchCandidate:matched.has(key(branch)),context,reasons:[...new Set(reasons)],publicationAllowed:false};
});
const summarize=list=>({branches:list.length,requirements:new Set(list.map(r=>r.requirementId)).size,
  flaggedBranches:list.filter(r=>r.reasons.length).length,
  flaggedRequirements:new Set(list.filter(r=>r.reasons.length).map(r=>r.requirementId)).size,
  reasons:Object.fromEntries([...Map.groupBy(list.flatMap(r=>r.reasons),r=>r)].map(([k,v])=>[k,v.length]))});
const report={kind:'SECTION_AWARE_ENGINE_LINE_CONTEXT_AUDIT',branchHash:sha(branchRaw),recheckHash:sha(recheckRaw),snapshotHash:sha(snapshotRaw),
  helperHash:sha(await readFile(resolve(root,'src/lib/fluid-engine-line-context.ts'),'utf8')),productionApplyAllowed:false,
  summary:{all:summarize(findings),matched:summarize(findings.filter(r=>r.hasMatchCandidate))},
  limitation:'Literal evidence, not eligibility. Unassigned power alternatives are never paired with codes by position; other unparsed source conditions may remain.',findings};
await writeFile(resolve(dir,'engine-line-context-v2.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
