import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
import {sourceMarketBranches as current} from './lib/mann-source-market-branches.mjs';
const root=resolve(import.meta.dirname,'..');
const file='scripts/lib/mann-source-market-branches.mjs';
const oldCode=execFileSync('git',['show',`HEAD:${file}`],{cwd:root,encoding:'utf8'});
const {sourceMarketBranches:previous}=await import(`data:text/javascript;base64,${Buffer.from(oldCode).toString('base64')}`);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const rows=raw.trim().split('\n').map(JSON.parse);assert.equal(rows.length,13287);
const recovered=[];let preserved=0;
for(const r of rows){
 const before=previous(r.model,r.production_years),after=current(r.model,r.production_years);
 if(before!==null){assert.deepEqual(after,before,r.row_id);preserved++;}
 else if(after!==null){
  assert.ok(r.model.includes('Китай')||/\d{2}\.\d{4}\s*-\s*н\.в\./.test(`${r.model} ${r.production_years}`));
  recovered.push({rowId:r.row_id,sourceUrl:r.source_url,rawHash:sha(r),raw:r,branches:after});
 }
}
const gs3=recovered.filter(r=>r.raw.brand_slug==='gac'&&r.raw.model_slug==='gs3');assert.equal(gs3.length,3);
const report={kind:'CN_AND_OPEN_MONTH_MARKET_PARSER_TRANSITION',rawHash:sha(raw),beforeCodeHash:sha(oldCode),afterCodeHash:sha(await readFile(resolve(root,file),'utf8')),checked:rows.length,previouslyParsedPreserved:preserved,newlyParsed:recovered.length,gs3Anchors:gs3.length,recovered,productionApplyAllowed:false,limitations:['Offline source-scope parser only; no source/plan/runtime publication.','Previously parsed outputs must remain byte-equivalent. Newly recognized scopes require downstream identity and OEM checks.']};
await writeFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/cn-market-parser-transition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,recovered:undefined}));
