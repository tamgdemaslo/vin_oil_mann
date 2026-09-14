import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const mode=process.argv[2];assert.ok(['baseline','verify'].includes(mode));
const version=process.argv[3]??'v1';assert.match(version,/^v\d+$/);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const parserHash=sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8'));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{prepareFluidCatalog}=await j.import('../src/lib/fluid-catalog.ts');
const prepared=prepareFluidCatalog({rowsNdjson:raw,mannFiltersCsv:''});assert.equal(prepared.requirements.length,13296);
if(mode==='baseline'){
 assert.equal(parserHash,'366d7c8e06859de7bcbf3a1ae6a692474df96c87f47f8f2a8f5101ca8ded637a');
 assert.equal(sha(prepared),'d26001fe5b85e2b23092b682734df5950c4afa3aa7ab2c727333b586104ce926');
 const report={parserHash,snapshotHash:sha(raw),preparedHash:sha(prepared),rows:prepared.requirements.map(r=>({id:r.id,rowHash:sha(r),specificationsJson:r.specificationsJson}))};
 await writeFile(resolve(dir,'dot-token-before-v1.json'),JSON.stringify(report)+'\n',{flag:'wx'});console.log('Full baseline pinned: 13296 rows');
}else{
 const beforeRaw=await readFile(resolve(dir,'dot-token-before-v1.json'),'utf8'),before=JSON.parse(beforeRaw);
 assert.equal(before.preparedHash,'d26001fe5b85e2b23092b682734df5950c4afa3aa7ab2c727333b586104ce926');
 const old=new Map(before.rows.map(r=>[r.id,r])),changes=[];const afterPreparedHash=sha(prepared);
 for(const r of prepared.requirements){
  const b=old.get(r.id);assert.ok(b);
  if(sha(r)===b.rowHash)continue;
  assert.deepEqual(r.specificationsJson.filter(s=>s.type!=='DOT'),b.specificationsJson.filter(s=>s.type!=='DOT'));
  assert.equal(sha({...r,specificationsJson:b.specificationsJson}),b.rowHash);
  changes.push({id:r.id,before:b.specificationsJson,after:r.specificationsJson});
  r.specificationsJson=b.specificationsJson;
 }
 assert.equal(sha(prepared),before.preparedHash);
 assert.ok(changes.length>0);
 const report={kind:'DOT_TOKEN_ONLY_FULL_REPARSE_TRANSITION',baselineHash:sha(beforeRaw),snapshotHash:sha(raw),beforeParserHash:before.parserHash,afterParserHash:parserHash,beforePreparedHash:before.preparedHash,afterPreparedHash,checked:13296,changed:changes.length,changes,productionApplyAllowed:false};
 await writeFile(resolve(dir,`dot-token-transition-${version}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,changes:undefined}));
}
