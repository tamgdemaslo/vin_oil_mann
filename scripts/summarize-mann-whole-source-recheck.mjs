import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14');
// Requires the completed manifest: never interpret a partial NDJSON as a full run.
const summaryRaw=await readFile(resolve(dir,'summary.json'),'utf8'),summary=JSON.parse(summaryRaw);
const raw=await readFile(resolve(dir,'decisions.ndjson'),'utf8'),sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
assert.equal(sha(raw),summary.decisionsHash);assert.equal(sha(sql),summary.sourceHash);assert.equal(summary.processed,13296);
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r])),rows=raw.trim().split('\n').map(JSON.parse);
assert.equal(rows.length,sources.size);assert.equal(new Set(rows.map(r=>r.requirementId)).size,sources.size);
for(const r of rows){assert.equal(sha(sources.get(r.requirementId)),r.originalSourceHash);assert.equal(r.decision.requirementId,r.requirementId);assert.equal(r.publicationAllowed,false);}
const count=(rows,key)=>Object.fromEntries([...Map.groupBy(rows,key)].map(([k,v])=>[k,v.length]));
assert.deepEqual(count(rows,r=>r.decision.status),summary.statusCounts);
const pending=rows.filter(r=>r.oldCoverageStatus==='UNRESOLVED_MATCH_OR_CONDITIONS');assert.equal(pending.length,10005);
assert.deepEqual(count(pending,r=>r.decision.status),summary.oldUnresolvedStatusCounts);
const strong=pending.filter(r=>!r.identityReasons.length);
assert.equal(strong.length,summary.oldUnresolvedIdentityCandidateCount);
const batches=new Map();
for(const r of pending){
 const source=sources.get(r.requirementId),top=r.decision.topCandidates[0];
 const blockers=top?.reviewBlockers??r.decision.reviewReasons;
 const stage=!r.identityReasons.length?(top?.matchedFields.includes('точный код двигателя')?'STRONG_IDENTITY_EXACT_ENGINE_RECHECK_CONDITIONS':'STRONG_IDENTITY_WITHOUT_EXACT_ENGINE'):
  r.identityReasons.includes('MISSING_EXPLICIT_CHASSIS_IDENTITY')?'MISSING_CHASSIS_IDENTITY':
  r.identityReasons.includes('NEARBY_EXACT_ENGINE_ALTERNATIVE')?'AMBIGUOUS_EXACT_ENGINE_TARGETS':'OTHER_IDENTITY_OR_CATALOG_REVIEW';
 const key=JSON.stringify([stage,source.make,source.model,source.systemCode,[...new Set(blockers)].sort()]);
 const batch=batches.get(key)??{stage,make:source.make,model:source.model,systemCode:source.systemCode,blockers:[...new Set(blockers)].sort(),entries:[],publicationAllowed:false};
 batch.entries.push({sourceRequirementId:source.id,sourceHash:r.originalSourceHash,sourceRowId:source.sourceRowId,sourceUrl:source.sourceUrl,sourceTableKey:source.sourceTableKey,
  status:r.decision.status,identityReasons:r.identityReasons,topVariantIds:top?.variantIds??[],score:top?.score??null,matchedFields:top?.matchedFields??[],hardConflicts:top?.hardConflicts??[],currentCandidateRevisionIds:r.currentCandidateRevisionIds});
 batches.set(key,batch);
}
const sorted=[...batches.values()].sort((a,b)=>b.entries.length-a.entries.length);
const report={summaryHash:sha(summaryRaw),decisionsHash:sha(raw),sourceHash:sha(sql),verifiedRows:rows.length,verifiedUniqueSources:sources.size,oldUnresolved:pending.length,
 transitions:count(rows,r=>`${r.oldCoverageStatus} -> ${r.decision.status}`),
 strongIdentitySources:strong.length,strongIdentityWithExactEngine:strong.filter(r=>r.decision.topCandidates[0]?.matchedFields.includes('точный код двигателя')).length,
 batchCount:sorted.length,stageCounts:count(sorted.flatMap(b=>b.entries.map(()=>b.stage)),s=>s),batches:sorted,
 productionApplyAllowed:false,limitation:'Repair grouping only. Counts include nonfluid systems. Exact engine matchedField is not proof every source engine/power/month/market branch is covered. No OEM signoff or canonical mutation.'};
await writeFile(resolve(dir,'repair-batches-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,batches:undefined,transitions:undefined}));
