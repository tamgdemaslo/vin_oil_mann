import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {mercedesSourceEngineEvidence} from './lib/mann-mercedes-source-engine.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-compressed-preview-2026-09-14');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
const rawText=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
const rows=rawText.trim().split('\n').map(JSON.parse),byId=new Map(rows.map(r=>[r.row_id,r]));
const tables=Map.groupBy(rows,r=>JSON.stringify([r.source_url,r.table_index]));
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements').filter(r=>r.make==='mercedes');assert.equal(sources.length,523);
const results=sources.map(source=>{
 const raw=byId.get(source.sourceRowId);assert.ok(raw);assert.equal(raw.source_url,source.sourceUrl);
 const anchors=tables.get(JSON.stringify([raw.source_url,raw.table_index])).filter(r=>/МАСЛО\s+в\s+ДВИГАТЕЛЬ/iu.test(r.application));
 const evidence=anchors.flatMap(a=>mercedesSourceEngineEvidence(a.model).map(e=>({...e,rowId:a.row_id,rowHash:sha(a),application:a.application,years:a.production_years,power:a.power,fuel:a.fuel_type})));
 const codes=[...new Set(evidence.map(r=>r.code))],stored=[...new Set([source.engineCodeNormalized,...source.engineCodesJson].filter(Boolean))];
 return {sourceRequirementId:source.id,sourceHash:sha(source),systemCode:source.systemCode,sourceUrl:source.sourceUrl,tableIndex:raw.table_index,storedCodes:stored,recoveredCodes:codes,evidence,
   status:codes.length&&!stored.length?'FULL_SOURCE_CODE_MISSING_FROM_IMPORT':codes.some(c=>!stored.includes(c))?'SOURCE_CODE_DIFFERS_FROM_IMPORT':'NO_MISSING_CODE_DETECTED',publicationAllowed:false};
});
const missing=results.filter(r=>r.status==='FULL_SOURCE_CODE_MISSING_FROM_IMPORT');
const report={sourceHash:sha(sourceRaw),rawHash:sha(rawText),helperHash:sha(await readFile(resolve(root,'scripts/lib/mann-mercedes-source-engine.mjs'),'utf8')),
 summary:{sources:results.length,missing:missing.length,bySystem:Object.fromEntries([...Map.groupBy(missing,r=>r.systemCode)].map(([k,v])=>[k,v.length]))},results,productionApplyAllowed:false,
 limitation:'Same-table explicit source code evidence, not applicability approval. Multiple engine rows require engine-specific power/fuel/year conditions; transmission/equipment conditions unchanged and unresolved.'};
await writeFile(resolve(dir,'mercedes-source-code-loss-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary,null,2));
