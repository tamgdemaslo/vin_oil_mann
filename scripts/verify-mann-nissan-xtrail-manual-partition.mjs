import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-nissan-xtrail-cvt-preview-2026-09-14');
const [raw,sql,archive]=await Promise.all([readFile(resolve(dir,'nissan-xtrail-manual-preview-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const s=JSON.parse(raw);assert.equal(sha(sql),s.sourceHash);assert.equal(sha(archive),s.rawHash);
for(const [file,hash] of Object.entries(s.codeHashes))assert.equal(sha(await readFile(resolve(root,file),'utf8')),hash);
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r])),rows=archive.trim().split('\n').map(JSON.parse);
const {extractFluidSourceSystemContext:label}=await createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}).import('../src/lib/fluid-source-system-context.ts');
const index=m=>Number(m.slice(0,4))*12+Number(m.slice(5))-1,key=(e,type,n)=>`${e.engineCode}:${e.powerHp}:${e.hybrid}:${type}:${n}`;
let total=0,covered=0,pending=0;
assert.equal(s.revisions.length,1);
for(const revision of s.revisions){
 const original=sources.get(revision.sourceRequirementId),evidence=revision.provenanceJson.sourceEngineEvidence;
 const anchor=rows.find(r=>r.row_id===evidence.rowId),sourceRow=rows.find(r=>r.row_id===original.sourceRowId);
 assert.deepEqual(anchor,evidence.originalRow);assert.equal(sha(anchor),evidence.rowHash);assert.equal(anchor.source_url,sourceRow.source_url);assert.equal(anchor.table_index,sourceRow.table_index);
 // Independently read the two original application lines, not the builder's model parser.
 const lines=anchor.application.split('\n').filter(line=>line.startsWith('- '));assert.equal(lines.length,2);
 const engines=lines.map(line=>{
  const hybrid=/^- (MR20-RM31) Hybrid \/ (\d{4})-(\d{4})$/.exec(line);
  if(hybrid)return {engineCode:hybrid[1],powerHp:null,hybrid:true,yearFrom:+hybrid[2],yearTo:+hybrid[3],sourcePhrase:line};
  const regular=/^- (MR20DD) \/ (\d{3}) л\.с\. \/ (\d{4})-(\d{4})$/.exec(line);assert.ok(regular);
  return {engineCode:regular[1],powerHp:+regular[2],hybrid:false,yearFrom:+regular[3],yearTo:+regular[4],sourcePhrase:line};
 });
 const selected=engines.find(e=>!e.hybrid);assert.deepEqual(selected,revision.provenanceJson.sourceEngineScope);
 const metadata=label(original.systemNameRaw,original.componentModel);assert.equal(metadata.transmissionType,'manual');assert.equal(metadata.transmissionGearCount,6);assert.equal(original.componentModel,'RS6F52A');
 const required={type:'manual',model:original.componentModel,gearCount:6},type=JSON.stringify(required);
 const domain=new Set(),assigned=new Set();
 for(const e of engines)for(let n=e.yearFrom*12;n<(e.yearTo+1)*12;n++)domain.add(key(e,type,n));
 assert.deepEqual(revision.applicabilityJson.matchedEngineScope,[selected.engineCode]);assert.equal(revision.applicabilityJson.transmissionType,required.type);assert.equal(revision.applicabilityJson.transmissionGearCount,required.gearCount);assert.equal(revision.applicabilityJson.componentModel,required.model);
 const w=revision.applicabilityJson.window.intersection;for(let n=index(w.from);n<=index(w.to);n++){const k=key(selected,type,n);assert.ok(domain.has(k));assert.ok(!assigned.has(k));assigned.add(k);covered++;}
 for(const p of s.pending){
  assert.equal(p.sourceRequirementId,original.id);assert.deepEqual(p.originalSource,original);assert.equal(p.sourceHash,sha(original));assert.ok(engines.some(e=>sha(e)===sha(p.sourceEngineBranch)));assert.equal(p.publicationAllowed,false);
  assert.deepEqual(p.requiredTransmission,required);for(let n=index(p.window.from);n<=index(p.window.to);n++){const k=key(p.sourceEngineBranch,type,n);assert.ok(domain.has(k));assert.ok(!assigned.has(k));assigned.add(k);pending++;}
 }
 assert.deepEqual([...assigned].sort(),[...domain].sort());total+=domain.size;
}
assert.equal(total,216);assert.equal(covered,100);assert.equal(pending,116);assert.equal(s.pending.length,2);
const report={supplementHash:sha(raw),sourceHash:sha(sql),rawHash:sha(archive),sources:s.revisions.length,total,covered,pending,noGaps:true,noOverlaps:true,productionApplyAllowed:false};
await writeFile(resolve(dir,'nissan-xtrail-manual-partition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
