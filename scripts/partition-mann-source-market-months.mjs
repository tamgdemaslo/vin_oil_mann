import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
import {intersectMonths,unionMonths,subtractMonths} from './lib/mann-month-intervals.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-non-ru-market-guarded-preview-2026-09-14');
const [raw,auditRaw]=await Promise.all(['plan.json','source-market-target-scope-audit-v2.json'].map(f=>readFile(resolve(dir,f),'utf8'))),plan=JSON.parse(raw),audit=JSON.parse(auditRaw);assert.equal(audit.planHash,sha(raw));
for(const[file,hash]of Object.entries(audit.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const records=new Map(plan.newRevisions.map(r=>[r.id,r])),findings=[];
for(const f of audit.findings.filter(f=>f.statuses.some(s=>['MULTIPLE_MARKETS_REQUIRE_PARTITION','SOURCE_BRANCH_DATE_NARROWING_REQUIRED'].includes(s)))){
 const revision=records.get(f.revisionId);assert.equal(sha(revision),f.revisionHash);const proposals=new Map(),unmatchedChecks=[];
 for(const check of f.checks){
  if(!check.matches?.length){unmatchedChecks.push(check);continue;}
  assert.ok(check.currentWindow&&check.targetWindow);
  for(const branch of check.matches){
   assert.notEqual(branch.sourceQualifier,'Hybrid');
   const sourceTarget=intersectMonths(branch.window,check.targetWindow),window=sourceTarget&&intersectMonths(sourceTarget,check.currentWindow);if(!window)continue;
   const proposal={scopeIndex:check.scopeIndex,engineCode:check.engine,powerHp:check.powerHp,requiredMarket:branch.market,window,sourceBranchWindow:branch.window,sourcePhrase:branch.sourcePhrase};
   const key=sha(proposal),existing=proposals.get(key);if(existing)existing.targetRowIds.push(check.targetRowId);else proposals.set(key,{...proposal,targetRowIds:[check.targetRowId]});
  }
 }
 const candidateBranches=[...proposals.values()],partition=[];
 for(const branch of f.branches)for(const powerHp of branch.powerHp){
  const matching=candidateBranches.filter(p=>norm(p.engineCode)===norm(branch.engineCode)&&p.powerHp===powerHp&&p.requiredMarket===branch.market);
  const candidateWindows=unionMonths(matching.map(p=>intersectMonths(p.window,branch.window)).filter(Boolean)),pendingWindows=subtractMonths(branch.window,candidateWindows);
  assert.deepEqual(unionMonths([...candidateWindows,...pendingWindows]),[branch.window]);
  for(const a of candidateWindows)for(const b of pendingWindows)assert.equal(intersectMonths(a,b),null);
  partition.push({engineCode:branch.engineCode,powerHp,requiredMarket:branch.market,sourceWindow:branch.window,sourcePhrase:branch.sourcePhrase,candidateWindows,pendingWindows,publicationAllowed:false});
 }
 findings.push({revisionId:revision.id,revisionHash:sha(revision),sourceRequirementId:revision.sourceRequirementId,vehicleVariantKey:revision.vehicleVariantKey,make:f.make,model:f.model,anchorHash:f.anchorHash,originalStatuses:f.statuses,candidateBranches,unmatchedChecks,partition,publicationAllowed:false});
}
assert.equal(findings.length,103);
const summary={revisions:findings.length,branchProposals:findings.reduce((n,f)=>n+f.candidateBranches.length,0),sourceEnginePowerMarketBranches:findings.reduce((n,f)=>n+f.partition.length,0),pendingIntervals:findings.reduce((n,f)=>n+f.partition.reduce((k,p)=>k+p.pendingWindows.length,0),0),withUnmatchedEnginePower:findings.filter(f=>f.unmatchedChecks.length).length};
await writeFile(resolve(dir,'source-market-month-partition-v1.json'),JSON.stringify({planHash:sha(raw),marketAuditHash:sha(auditRaw),codeHashes:{...audit.codeHashes,'scripts/lib/mann-month-intervals.mjs':sha(await readFile(resolve(root,'scripts/lib/mann-month-intervals.mjs'),'utf8'))},summary,findings,productionApplyAllowed:false,limitation:'Exact source engine/power/market/month partition into candidate intersections and retained pending windows. Candidate branches are proposals, not approved coverage; full-make identity replay and technical-condition validation still required. No canonical changes.'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
