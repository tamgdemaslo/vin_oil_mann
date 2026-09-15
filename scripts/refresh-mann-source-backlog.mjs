import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const oldRaw=await readFile(resolve(dir,'action-groups-v1.json'),'utf8'),old=JSON.parse(oldRaw);
const planRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8'),plan=JSON.parse(planRaw);
assert.equal(sha(planRaw),'48c9b898379db5afb9f2368b2929d8722bc46c3c4c66ca81fdb21ebe4d7aeaf1');
const bySource=Map.groupBy(plan.newRevisions,r=>r.sourceRequirementId),seen=new Set(),routes={},findings=[];
for(const f of old.findings){
 assert.ok(!seen.has(f.sourceRequirementId));seen.add(f.sourceRequirementId);
 const revisions=bySource.get(f.sourceRequirementId)??[];
 const route=f.status.startsWith('CONFIRMED')?(revisions.length?'MATCHED_WITH_DRAFT':'MATCHED_NEEDS_TECHNICAL_DRAFT'):f.route;
 const group=routes[route]??={sources:0,withDraft:0,withoutDraft:0};group.sources++;revisions.length?group.withDraft++:group.withoutDraft++;
 findings.push({...f,route,canonicalRevisionIds:revisions.map(r=>r.id),scopedDraftPresenceOnly:!!revisions.length});
}
assert.equal(seen.size,13296);assert.ok([...bySource.keys()].every(id=>seen.has(id)));
const prioritized=findings.filter(f=>!f.canonicalRevisionIds.length);
const groups=[...Map.groupBy(prioritized,f=>`${f.route}|${f.make}|${f.systemCode}`)].map(([key,rows])=>({key,sources:rows.length,sourceRequirementIds:rows.map(r=>r.sourceRequirementId)})).sort((a,b)=>b.sources-a.sources);
const resolved=old.findings.filter(f=>!f.canonicalRevisionIds.length&&bySource.has(f.sourceRequirementId)).map(f=>f.sourceRequirementId);
const result={kind:'CURRENT_CANONICAL_SOURCE_BACKLOG',planHash:sha(planRaw),fullReplayActionGroupsHash:sha(oldRaw),total:seen.size,canonicalRevisions:plan.newRevisions.length,sourcesWithScopedDraft:bySource.size,sourcesWithoutDraft:seen.size-bySource.size,newSourcesWithDraftSinceReplay:resolved.length,routes,priorityGroups:groups,findings,productionApplyAllowed:false,limitations:['Draft presence is not complete technical/VIN coverage; one source may still have held months/markets/equipment.','Matching decisions reuse the completed full replay; this refresh updates draft membership, not matcher evidence.','No evidence gaps have been turned into guessed approvals.']};
await writeFile(resolve(dir,'action-groups-current-plan-v2.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...result,findings:undefined,priorityGroups:groups.slice(0,8).map(({key,sources})=>({key,sources}))},null,2));
