import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-transmission-chassis-held-preview-2026-09-14');
const [raw,sql,archive]=await Promise.all([readFile(resolve(dir,'solaris-ru-restoration-drafts-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const report=JSON.parse(raw);assert.equal(report.sourceHash,sha(sql));assert.equal(report.rawHash,sha(archive));const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r])),rows=archive.trim().split('\n').map(JSON.parse);
const index=m=>Number(m.slice(0,4))*12+Number(m.slice(5))-1;let total=0,covered=0,pending=0;
for(const r of report.revisions){
 const source=sources.get(r.sourceRequirementId),sourceRow=rows.find(a=>a.row_id===source.sourceRowId),e=r.provenanceJson.sourceMarketEvidence,anchor=rows.find(a=>a.row_id===e.rowId);assert.deepEqual(anchor,e.originalRow);assert.equal(e.rowHash,sha(anchor));assert.equal(anchor.source_url,sourceRow.source_url);assert.equal(anchor.table_index,sourceRow.table_index);
 const lines=anchor.application.split('\n').filter(l=>l.startsWith('- '));assert.deepEqual(lines,['- G4FA / 107 л.с. / Россия']);assert.equal(anchor.production_years,'2010 - 2017');
 const branch={engineCode:'G4FA',powerHp:107,requiredMarket:'RU',yearFrom:2010,yearTo:2017},scope=r.applicabilityJson;assert.equal(scope.requiredMarket,'RU');assert.deepEqual(scope.matchedEngineScope,['G4FA']);
 const required={type:source.transmissionType,...(source.componentModel?{model:source.componentModel}:{}),gearCount:source.systemCode==='AUTOMATIC_TRANSMISSION'?4:5};assert.equal(scope.transmissionType,required.type);assert.equal(scope.transmissionGearCount,required.gearCount);assert.equal(scope.componentModel,source.componentModel);
 const domain=new Set(Array.from({length:96},(_,i)=>2010*12+i)),assigned=new Set(),w=scope.window.intersection;
 for(let n=index(w.from);n<=index(w.to);n++){assert.ok(domain.has(n));assert.ok(!assigned.has(n));assigned.add(n);covered++;}
 const obligations=report.pending.filter(p=>p.sourceRequirementId===source.id);assert.equal(obligations.length,1);
 for(const p of obligations){assert.deepEqual(p.originalSource,source);assert.equal(p.sourceHash,sha(source));assert.deepEqual(p.sourceEngineBranch,branch);assert.deepEqual(p.requiredTransmission,required);assert.equal(p.publicationAllowed,false);for(let n=index(p.window.from);n<=index(p.window.to);n++){assert.ok(domain.has(n));assert.ok(!assigned.has(n));assigned.add(n);pending++;}}
 assert.deepEqual([...assigned].sort(),[...domain].sort());total+=domain.size;
}
assert.equal(report.revisions.length,2);assert.equal(total,192);assert.equal(covered,166);assert.equal(pending,26);
const proof={draftHash:sha(raw),sourceHash:sha(sql),rawHash:sha(archive),total,covered,pending,noGaps:true,noOverlaps:true,productionApplyAllowed:false};await writeFile(resolve(dir,'solaris-ru-restoration-partition-v1.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(proof));
