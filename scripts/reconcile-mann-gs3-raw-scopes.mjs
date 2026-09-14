import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
import {sourceMarketBranches} from './lib/mann-source-market-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const input=await readFile(resolve(dir,'gac-gs3-online-gap-evidence-v1.json'),'utf8'),evidence=JSON.parse(input);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const rows=raw.trim().split('\n').map(JSON.parse),byId=new Map(rows.map(r=>[r.row_id,r]));
const findings=evidence.findings.map(f=>{
 const s=f.originalSource;assert.equal(sha(s),f.sourceHash);
 const r=byId.get(s.sourceRowId);assert.ok(r);assert.equal(r.source_url,s.sourceUrl);
 const anchors=rows.filter(a=>a.source_url===r.source_url&&a.table_index===r.table_index&&a.system_name==='МАСЛО в ДВИГАТЕЛЬ');
 assert.equal(anchors.length,1);const anchor=anchors[0],branches=sourceMarketBranches(anchor.model,anchor.production_years);assert.ok(branches);
 if(s.generation==='I'){
  assert.equal(branches.length,1);assert.equal(branches[0].market,'CN');
  assert.equal(branches[0].engineCode,s.engineCodeNormalized);assert.deepEqual(branches[0].powerHp,[s.powerHp]);
  assert.ok(f.onlineApplication);assert.equal(branches[0].window.from,f.onlineApplication.manufactureMonths.from);
 }else {assert.equal(s.generation,'II');assert.equal(branches.length,2);assert.equal(f.onlineApplication,null);}
 return {sourceRequirementId:s.id,sourceHash:f.sourceHash,rawRow:r,rawRowHash:sha(r),rawAnchor:anchor,anchorHash:sha(anchor),branches,systemCode:s.systemCode,onlineApplication:f.onlineApplication,publicationAllowed:false};
});
const systemCounts=Object.fromEntries([...Map.groupBy(findings,f=>f.systemCode)].map(([k,v])=>[k,v.length]));
const result={kind:'GAC_GS3_RAW_TABLE_SCOPES',parentHash:sha(input),rawHash:sha(raw),checked:findings.length,systemCounts,findings,productionApplyAllowed:false,limitations:['Source assertions, not independently verified OEM truth.','All 31 rows include tires, battery, fuel-tank and EPS records: they are not 31 liquid requirements.','Raw engine anchor applies only within the same source URL and exact table index. Source monthly end dates override broader SQL year envelopes; no Russian-market reuse of CN first-generation branches.']};
assert.equal(result.checked,31);
await writeFile(resolve(dir,'gac-gs3-raw-scopes-v1.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...result,findings:undefined}));
