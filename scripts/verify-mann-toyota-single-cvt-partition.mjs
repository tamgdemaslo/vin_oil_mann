import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {toyotaExplicitEngineBranches} from './lib/mann-toyota-explicit-engine-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-corolla-cvt-preview-2026-09-14');
const raw=await readFile(resolve(dir,'toyota-single-engine-cvt-preview-v1.json'),'utf8'),s=JSON.parse(raw),sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),s.sourceHash);
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const {parseConditionalFluidCapacities:parse}=await createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}).import('../src/lib/fluid-capacity-conditions.ts');
const index=m=>Number(m.slice(0,4))*12+Number(m.slice(5))-1,key=(type,n)=>`${type}:${n}`;let total=0,covered=0,pending=0;
for(const revision of s.revisions){
 const original=sources.get(revision.sourceRequirementId),evidence=revision.provenanceJson.sourceEngineEvidence;assert.equal(sha(evidence.originalRow),evidence.rowHash);
 const engine=toyotaExplicitEngineBranches(evidence.originalRow.model);assert.deepEqual(engine,[revision.provenanceJson.sourceEngineBranch]);
 const parsed=parse(original.fillVolumeText,original.systemCode,original.engineCodesJson);assert.equal(parsed.status,'structured');
 const domain=new Set(),assigned=new Set();
 for(const b of parsed.branches)for(let n=original.yearFrom*12;n<(original.yearTo+1)*12;n++)domain.add(key(b.condition.value,n));
 for(const b of revision.technicalDataJson.capacityBranches){assert.deepEqual(b.applicabilityJson.matchedEngineScope,[engine[0].engineCode]);assert.ok(parsed.branches.some(p=>p.sourceSegment===b.sourceSegment&&sha(p.condition)===sha(b.condition)));
  const w=b.applicabilityJson.window.intersection;for(let n=index(w.from);n<=index(w.to);n++){const k=key(b.condition.value,n);assert.ok(domain.has(k));assert.ok(!assigned.has(k));assigned.add(k);covered++;}}
 for(const p of s.pending.filter(p=>p.sourceRequirementId===original.id)){assert.deepEqual(p.originalSource,original);assert.equal(p.sourceHash,sha(original));assert.deepEqual(p.sourceEngineBranch,engine[0]);for(let n=index(p.window.from);n<=index(p.window.to);n++){const k=key(p.condition.value,n);assert.ok(domain.has(k));assert.ok(!assigned.has(k));assigned.add(k);pending++;}}
 assert.deepEqual([...assigned].sort(),[...domain].sort());total+=domain.size;
}
assert.equal(total,240);assert.equal(covered,192);assert.equal(pending,48);
const report={supplementHash:sha(raw),sourceHash:sha(sql),sources:s.revisions.length,total,covered,pending,noGaps:true,noOverlaps:true,productionApplyAllowed:false};
await writeFile(resolve(dir,'toyota-single-engine-cvt-partition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
