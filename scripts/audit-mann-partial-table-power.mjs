import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const sources=parseCopy(sql,'vehicle_fluid_requirements');assert.equal(sources.length,13296);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const rawRows=new Map(raw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const key=s=>{const r=rawRows.get(s.sourceRowId);return r?JSON.stringify([r.source_url,r.table_index]):null;};
const anchors=Map.groupBy(sources.filter(s=>s.systemCode==='ENGINE_OIL'&&s.contextConfidence==='row_engine'&&key(s)!=null),key);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),'31f8407dde303ca792f858299a5c40282a4079d65b9e8a9a8e020941e8411c5c');const plan=JSON.parse(planRaw);
const findings=[];
for(const s of sources){
 if(s.contextConfidence!=='table_engine')continue;
 const a=anchors.get(key(s))??[];if(a.length<2)continue;
 const fields=['powerHp','powerKw'].filter(f=>s[f]!=null&&a.some(x=>x[f]==null));if(!fields.length)continue;
 findings.push({sourceRequirementId:s.id,sourceHash:sha(s),originalSource:s,affectedFields:fields,engineAnchors:a.map(x=>({source:x,sourceHash:sha(x),raw:rawRows.get(x.sourceRowId)})),existingRevisionIds:plan.newRevisions.filter(r=>r.sourceRequirementId===s.id).map(r=>r.id),publicationAllowed:false});
}
assert.equal(findings.filter(f=>f.originalSource.make==='exeed'&&f.originalSource.model==='vx').length,7);
const report={kind:'PARTIAL_TABLE_POWER_INHERITANCE_AUDIT',sourceHash:sha(sql),rawHash:sha(raw),planHash:sha(planRaw),checked:sources.length,affectedSources:findings.length,affectedTables:new Set(findings.map(f=>key(f.originalSource))).size,existingDraftSources:findings.filter(f=>f.existingRevisionIds.length).length,existingDraftRevisions:findings.reduce((n,f)=>n+f.existingRevisionIds.length,0),findings,productionApplyAllowed:false,limitations:['A table scalar coexists with missing/ambiguous power in at least one engine anchor; this is not proof that every existing scoped revision is wrong.','Original row-level engine power and raw branches are preserved. No parser or source write in this audit.']};
await writeFile(resolve(dir,'partial-table-power-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined}));
