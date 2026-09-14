import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const dir=resolve(import.meta.dirname,'../outputs/mann-mercedes-transmission-list-preview-2026-09-14');
const raw=await readFile(resolve(dir,'alphard-ru-preview-supplement-v1.json'),'utf8'),s=JSON.parse(raw);
const sourceRaw=await readFile(resolve(dir,'toyota-new-pair-source-branches-v1.json'),'utf8'),source=JSON.parse(sourceRaw);assert.equal(sha(sourceRaw),s.auditHash);
const index=m=>Number(m.slice(0,4))*12+Number(m.slice(5))-1;
const key=(b,n)=>`${b.requiredMarket}:${b.engineCode}:${b.powerHp}:${n}`;
let total=0,covered=0,pending=0;
for(const revision of s.revisions){
 const origin=source.results.find(r=>r.sourceRequirementId===revision.sourceRequirementId);assert.ok(origin);
 const branches=origin.evidence.flatMap(e=>e.branches),domain=new Set();
 for(const b of branches)for(let n=b.yearFrom*12;n<(b.yearTo+1)*12;n++)domain.add(key(b,n));
 const assigned=new Set(),b=revision.provenanceJson.sourceMarketBranch,scope=revision.applicabilityJson;
 assert.equal(scope.requiredMarket,b.requiredMarket);assert.deepEqual(scope.matchedEngineScope,[b.engineCode]);
 for(let n=index(scope.window.intersection.from);n<=index(scope.window.intersection.to);n++){
  const k=key(b,n);assert.ok(domain.has(k));assert.ok(!assigned.has(k));assigned.add(k);covered++;
 }
 for(const p of s.pending.filter(r=>r.sourceRequirementId===revision.sourceRequirementId)){
  assert.equal(p.sourceHash,origin.sourceHash);assert.equal(sha(p.originalSource),p.sourceHash);
  assert.equal(p.requiredMarket,p.sourceBranch.requiredMarket);assert.deepEqual(p.matchedEngineScope,[p.sourceBranch.engineCode]);
  for(let n=index(p.window.from);n<=index(p.window.to);n++){
   const k=key(p.sourceBranch,n);assert.ok(domain.has(k));assert.ok(!assigned.has(k),'Pending overlaps covered or another pending slice');assigned.add(k);pending++;
  }
 }
 assert.deepEqual([...assigned].sort(),[...domain].sort());total+=domain.size;
}
assert.equal(s.revisions.length,3);assert.equal(total,396);assert.equal(covered,153);assert.equal(pending,243);
const report={supplementHash:sha(raw),sourceEvidenceHash:sha(sourceRaw),sources:s.revisions.length,totalBranchMonths:total,coveredBranchMonths:covered,pendingBranchMonths:pending,noGaps:true,noOverlaps:true,productionApplyAllowed:false,limitation:'Independent set partition of explicit source market/engine/power/month branches, not truth of source technical specifications.'};
await writeFile(resolve(dir,'alphard-ru-market-partition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
