import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='type-count'));const typeCountMode=process.argv[2]==='type-count',expectedCount=typeCountMode?22:328,readyCount=typeCountMode?2:75;
const [raw,batchRaw,sql]=await Promise.all([readFile(resolve(dir,typeCountMode?'source-type-count-preflight-v1.json':'strong-source-conditions-v1.json'),'utf8'),readFile(resolve(dir,typeCountMode?'source-type-count-audit-v1.json':'repair-batches-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8')]);
const report=JSON.parse(raw),batches=JSON.parse(batchRaw),sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
assert.equal(report.sourceHash,sha(sql));assert.equal(report.checked,expectedCount);
if(typeCountMode){assert.equal(report.inventoryHash,sha(batchRaw));assert.equal(report.planHash,sha(await readFile(report.planPath,'utf8')));for(const [file,hash]of Object.entries(report.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));}
const expected=new Set(typeCountMode?batches.entries.map(e=>e.sourceRequirementId):batches.batches.filter(b=>b.stage==='STRONG_IDENTITY_EXACT_ENGINE_RECHECK_CONDITIONS').flatMap(b=>b.entries.map(e=>e.sourceRequirementId))),seen=new Set();
for(const f of report.findings){
 assert.ok(expected.has(f.sourceRequirementId));assert.ok(!seen.has(f.sourceRequirementId));seen.add(f.sourceRequirementId);
 assert.deepEqual(f.originalSource,sources.get(f.sourceRequirementId));assert.equal(sha(f.originalSource),f.sourceHash);assert.equal(f.publicationAllowed,false);
 if(f.reasons.length)continue;
 assert.ok(f.engineCodes.length);assert.equal(f.sourceEngineResiduals.length,0);assert.ok(f.window);
 assert.ok(f.powerChecks.length);assert.ok(f.powerChecks.every(p=>p.exact));assert.equal(f.marketBranches.length,0);assert.equal(f.cautions.length,0);assert.equal(f.parsedCapacity.needsReview,false);
 const top=f.clippedDecision.topCandidates[0];assert.deepEqual(top.variantIds,[f.targetId]);assert.ok(top.score>=80);assert.deepEqual(top.hardConflicts,[]);
}
assert.equal(seen.size,expectedCount);assert.equal(report.findings.filter(f=>!f.reasons.length).length,readyCount);
const files=['scripts/recheck-mann-strong-source-conditions.mjs','scripts/verify-mann-strong-source-preflight.mjs','scripts/lib/mann-offline-scope.mjs','scripts/lib/mann-source-market-branches.mjs','scripts/lib/mann-gearbox-source-quality.mjs','scripts/lib/mann-specification-sections.mjs','scripts/lib/mann-specification-sections-v2.mjs','src/lib/fluid-capacity-parser.ts','src/lib/fluid-source-system-context.ts','src/lib/mann-transmission-component.ts','src/lib/vehicle-normalization.ts'];
const result={reportHash:sha(raw),batchesHash:sha(batchRaw),sourceHash:sha(sql),checked:expectedCount,nextDraftReviewSources:readyCount,codeHashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),productionApplyAllowed:false,limitation:'Integrity and preflight consistency only; not independent OEM approval or runtime draft verification.'};
await writeFile(resolve(dir,typeCountMode?'source-type-count-preflight-verification-v1.json':'strong-source-preflight-verification-v1.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({checked:expectedCount,nextDraftReviewSources:readyCount,reportHash:result.reportHash}));
