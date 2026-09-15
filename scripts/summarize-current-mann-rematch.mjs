import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy,YEAR_BLOCKER} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
const summary=JSON.parse(await readFile(resolve(dir,'summary.json'),'utf8'));assert.equal(summary.total,13296);assert.equal(summary.manifestHash,sha(manifest));
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),manifest.sourceHash);
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements'),ids=new Set(sources.map(r=>r.id));
const oldRaw=await readFile(resolve(root,'outputs/mann-identity-scoped-2026-09-14/decisions.ndjson'),'utf8');
const old=new Map(oldRaw.trim().split('\n').map(l=>{const r=JSON.parse(l);assert.equal(typeof r.match.status,'string');return[r.requirementId,r.match.status];}));
const seen=new Set(),transitions={},counts={},routes={},blockers={},findings=[];
for(const file of (await readdir(dir)).filter(f=>/^make-.*\.json$/.test(f))){
 const batch=JSON.parse(await readFile(resolve(dir,file),'utf8'));assert.equal(batch.manifestHash,sha(manifest));
 for(const f of batch.findings){
  assert.ok(ids.has(f.sourceRequirementId));assert.ok(!seen.has(f.sourceRequirementId));seen.add(f.sourceRequirementId);
  const d=f.decision,t=d.topCandidates[0],prior=old.get(f.sourceRequirementId);assert.ok(prior);
  const change=`${prior} -> ${d.status}`;transitions[change]=(transitions[change]??0)+1;counts[d.status]=(counts[d.status]??0)+1;
  for(const b of t?.reviewBlockers??[])blockers[b]=(blockers[b]??0)+1;
  let route;
  if(d.status.startsWith('CONFIRMED'))route=f.canonical.length?'MATCHED_WITH_DRAFT':'MATCHED_NEEDS_TECHNICAL_DRAFT';
  else if(d.status==='MANN_CATALOG_GAP')route=d.reviewReasons.includes('марка отсутствует в MANN snapshot')?'MAKE_ABSENT_FROM_CATALOG':'MODEL_RETRIEVAL_GAP';
  else if(d.status==='INSUFFICIENT_SOURCE_CONTEXT')route='MISSING_SOURCE_IDENTITY';
  else if(t&&!t.hardConflicts.length&&t.reviewBlockers.length===1&&t.reviewBlockers[0]===YEAR_BLOCKER)route='DATE_SCOPE_CANDIDATE';
  else if(t&&!t.hardConflicts.length&&t.reviewBlockers.length&&t.reviewBlockers.every(b=>b===YEAR_BLOCKER||b==='MANN variant не подтверждает тип или модель коробки'))route='TRANSMISSION_SCOPE_CANDIDATE';
  else if(t&&!t.hardConflicts.length&&!t.reviewBlockers.length)route='SCORE_OR_NEARBY_CANDIDATE_REVIEW';
  else if(d.status==='CONFLICT')route='IDENTITY_CONFLICT';
  else route='OTHER_SCOPE_OR_IDENTITY_REVIEW';
  const group=routes[route]??={sources:0,withDraft:0,withoutDraft:0};group.sources++;f.canonical.length?group.withDraft++:group.withoutDraft++;
  findings.push({sourceRequirementId:f.sourceRequirementId,make:batch.make,systemCode:f.systemCode,sourceUrl:f.sourceUrl,status:d.status,previousStatus:prior,route,canonicalRevisionIds:f.canonical.map(r=>r.revisionId),topScore:t?.score??null,topHardConflicts:t?.hardConflicts??[],topReviewBlockers:t?.reviewBlockers??[],batchFile:file});
 }
}
assert.equal(seen.size,sources.length);assert.deepEqual(counts,summary.counts);
const report={kind:'CURRENT_FULL_SOURCE_ACTION_GROUPS',manifestHash:sha(manifest),historicalDecisionsHash:sha(oldRaw),total:seen.size,counts,transitions,routes,topCandidateBlockers:Object.fromEntries(Object.entries(blockers).sort((a,b)=>b[1]-a[1])),findings,productionApplyAllowed:false,limitations:['Corrects historical status lookup: original batch oldStatus was omitted because it read .status instead of .match.status; current matching decisions are unchanged.','Routing uses top candidate and is prioritization, not approval or exhaustive branch expansion.','Existing scoped drafts are not invalidated by unscoped replay failures.','Snapshot coverage is complete; technical verification, missing catalog identities and VIN publication remain incomplete.']};
await writeFile(resolve(dir,'action-groups-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,findings:undefined},null,2));
