import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
import {toyotaExplicitEngineBranches} from './lib/mann-toyota-explicit-engine-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-alphard-ru-preview-2026-09-14');
const raw=await readFile(resolve(dir,'corolla-cvt-coolant-preview-v1.json'),'utf8'),s=JSON.parse(raw);
const rawText=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(rawText),s.rawHash);
const rawRows=new Map(rawText.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const evidence=s.revisions[0].provenanceJson.sourceEngineEvidence,anchor=rawRows.get(evidence.rowId);assert.equal(sha(anchor),evidence.rowHash);
const engines=toyotaExplicitEngineBranches(anchor.model);assert.deepEqual(engines,s.engineBranches);
const {parseConditionalFluidCapacities:parse}=await createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}).import('../src/lib/fluid-capacity-conditions.ts');
const capacities=parse(s.originalSource.fillVolumeText,s.originalSource.systemCode,s.originalSource.engineCodesJson);assert.equal(capacities.status,'structured');
const domain=new Set(),assigned=new Set(),key=(engine,power,type,n)=>`${engine}:${power}:${type}:${n}`,index=m=>Number(m.slice(0,4))*12+Number(m.slice(5))-1;
for(const engine of engines)for(const capacity of capacities.branches){assert.equal(capacity.condition.kind,'transmission');for(let n=s.originalSource.yearFrom*12;n<(s.originalSource.yearTo+1)*12;n++)domain.add(key(engine.engineCode,engine.powerHp,capacity.condition.value,n));}
for(const revision of s.revisions){
 const engine=revision.provenanceJson.sourceEngineBranch;assert.ok(engines.some(e=>e.engineCode===engine.engineCode&&e.powerHp===engine.powerHp));
 for(const branch of revision.technicalDataJson.capacityBranches){
  assert.deepEqual(branch.applicabilityJson.matchedEngineScope,[engine.engineCode]);
  const original=capacities.branches.find(c=>c.condition.value===branch.condition.value);assert.ok(original);assert.equal(original.sourceSegment,branch.sourceSegment);
  const w=branch.applicabilityJson.window.intersection;
  for(let n=index(w.from);n<=index(w.to);n++){const k=key(engine.engineCode,engine.powerHp,branch.condition.value,n);assert.ok(domain.has(k));assert.ok(!assigned.has(k));assigned.add(k);}
 }
}
const pending=[...domain].filter(k=>!assigned.has(k));assert.equal(domain.size,192);assert.equal(pending.length,0);
const report={supplementHash:sha(raw),rawHash:sha(rawText),sourceRequirementId:s.originalSource.id,totalEnginePowerTransmissionMonths:domain.size,covered:assigned.size,pending,noOverlaps:true,productionApplyAllowed:false,limitation:'Exact source table branch partition only; not OEM validity or proof of installed transmission.'};
await writeFile(resolve(dir,'corolla-cvt-partition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
