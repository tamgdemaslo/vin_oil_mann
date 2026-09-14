import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const sources=parseCopy(sql,'vehicle_fluid_requirements');assert.equal(sources.length,13296);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const rows=raw.trim().split('\n').map(JSON.parse),byId=new Map(rows.map(r=>[r.row_id,r]));
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);
assert.equal(sha(planRaw),'f22d1056d9af7913ee5b2521254b12763bb4e2e3d488267fbb7e28aa333be90a');
const key=r=>JSON.stringify([r.source_url,r.table_index]);
// Strict discovery only: numeric Mercedes identifiers in the dedicated engine model cell.
// Do not interpret displacement, production years, gearbox codes or numeric prose as engines.
const anchors=sources.flatMap(s=>{
 const r=byId.get(s.sourceRowId);if(!r||s.make!=='mercedes'||s.systemCode!=='ENGINE_OIL'||s.contextConfidence!=='row_engine')return [];
 const model=r.model.trim();if(!/^\d{3}\.\d{3}(?:\s*[,/]\s*\d{3}\.\d{3})*$/.test(model))return [];
 const rawCodes=model.split(/\s*[,/]\s*/);const missingCodes=rawCodes.filter(c=>!s.engineCodesJson.includes(c));if(!missingCodes.length)return [];
 return [{sourceRequirementId:s.id,sourceHash:sha(s),sourceRowId:r.row_id,tableKey:key(r),rawCodes,missingCodes,importedEngineCodes:s.engineCodesJson,rawModel:r.model,rawPower:r.power,rawYears:r.production_years,sourceUrl:r.source_url}];
});
const tables=Map.groupBy(anchors,a=>a.tableKey);
const affected=sources.flatMap(s=>{
 const r=byId.get(s.sourceRowId);if(!r||!tables.has(key(r)))return [];
 if(s.contextConfidence!=='table_engine'&&!anchors.some(a=>a.sourceRequirementId===s.id))return [];
 return [{sourceRequirementId:s.id,sourceHash:sha(s),systemCode:s.systemCode,contextConfidence:s.contextConfidence,tableKey:key(r),importedEngineCodes:s.engineCodesJson,anchorIds:tables.get(key(r)).map(a=>a.sourceRequirementId),localRevisions:plan.newRevisions.filter(x=>x.sourceRequirementId===s.id).map(x=>({revisionId:x.id,matchedEngineScope:x.applicabilityJson.matchedEngineScope,withheld:!!x.provenanceJson.sourcePowerReviewHold})),publicationAllowed:false}];
});
assert.ok(anchors.some(a=>a.sourceRowId==='bde3abb5d7dd66618f75711b84a46bfc54e5a0167f84f836469e8a76f7fa53ae'&&a.missingCodes.includes('272.971')));
const report={kind:'WHOLE_SOURCE_NUMERIC_ENGINE_LOSS_DISCOVERY',sourceHash:sha(sql),rawHash:sha(raw),planHash:sha(planRaw),checked:sources.length,anchorCount:anchors.length,tableCount:tables.size,affectedSourceCount:affected.length,localRevisionCount:affected.reduce((n,s)=>n+s.localRevisions.length,0),anchors,affected,productionApplyAllowed:false,limitations:['Discovery from exact source model cells, not manufacturer validation or automatic code-prefix equivalence.','Shared-table records still require engine/power/date attribution; discovering codes is not authorization to assign every engine to every fluid.','Scope detects Mercedes numeric-only model cells; mixed-format and other makes are not claimed covered.']};
await writeFile(resolve(dir,'numeric-engine-loss-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,anchors:undefined,affected:undefined}));
