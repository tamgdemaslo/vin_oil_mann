import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const provenanceRaw=await readFile(resolve(dir,'large-engine-context-provenance-v1.json'),'utf8');
const branchesRaw=await readFile(resolve(dir,'source-engine-branches-v1.json'),'utf8');
const provenance=JSON.parse(provenanceRaw),branches=JSON.parse(branchesRaw);
assert.equal(branches.provenanceHash,sha(provenanceRaw));
const snapshotRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(snapshotRaw),branches.snapshotHash);
const rawRows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
const findings=[];
for(const branch of branches.results){
  const row=rawRows.get(branch.engineAnchorRowId);assert.ok(row);assert.equal(sha(row),branch.engineAnchorRowHash);
  const bulletLines=String(row.application??'').split(/\r?\n/).map(s=>s.trim()).filter(s=>/^[-–—]\s+/.test(s));
  const matchingLines=bulletLines.filter(line=>line.replace(/^[-–—]\s+/,'').split('/')[0].split(/[;,|]+/).map(s=>normalizeEngineCode(s.trim())).includes(branch.engineCode));
  const reasons=[];
  if(bulletLines.length&&!matchingLines.length)reasons.push('BULLET_ENGINE_NOT_RESOLVED');
  const evidence=matchingLines.map(line=>{
    const hp=[...line.matchAll(/(\d+(?:[.,]\d+)?)\s*л\.?\s*с\.?/gi)].map(m=>Number(m[1].replace(',','.')));
    const years=[...line.matchAll(/((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})/g)].map(m=>({from:Number(m[1]),to:Number(m[2])}));
    if(hp.some(v=>v!==branch.scope?.powerHp))reasons.push('LINE_POWER_NOT_REPRESENTED_IN_SCOPE');
    if(years.some(v=>v.from!==branch.scope?.yearFrom||v.to!==branch.scope?.yearTo))reasons.push('LINE_YEARS_DIFFER_FROM_SCOPE');
    if(line.split('/').length>2)reasons.push('ADDITIONAL_LINE_CONTEXT_REQUIRES_PARSING');
    return {line,powerHp:hp,yearRanges:years};
  });
  if(matchingLines.length>1)reasons.push('MULTIPLE_LINES_FOR_SAME_ENGINE');
  findings.push({requirementId:branch.requirementId,engineCode:branch.engineCode,engineAnchorRowId:branch.engineAnchorRowId,
    scope:branch.scope,bulletLineCount:bulletLines.length,evidence,reasons:[...new Set(reasons)],publicationAllowed:false});
}
const flagged=findings.filter(f=>f.reasons.length);
const report={kind:'ENGINE_ANCHOR_LITERAL_LINE_AUDIT',provenanceHash:sha(provenanceRaw),branchHash:sha(branchesRaw),snapshotHash:sha(snapshotRaw),
  productionApplyAllowed:false,summary:{branches:findings.length,branchesWithBullets:findings.filter(f=>f.bulletLineCount).length,
    flaggedBranches:flagged.length,flaggedRequirements:new Set(flagged.map(f=>f.requirementId)).size,
    reasons:Object.fromEntries([...Map.groupBy(flagged.flatMap(f=>f.reasons),r=>r)].map(([k,v])=>[k,v.length]))},
  limitation:'Conservative literal-line diagnostics only. No flags is not proof that all source conditions have been parsed; no source data or publication eligibility is changed.',findings};
await writeFile(resolve(dir,'engine-anchor-line-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
