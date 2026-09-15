import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const coverageRaw=await readFile(resolve(dir,'literal-engine-application-coverage-v1.json'),'utf8'),coverage=JSON.parse(coverageRaw);
assert.equal(sha(await readFile(resolve(root,'scripts/lib/mann-literal-engine-application.mjs'),'utf8')),coverage.parserHash);
const preRaw=await readFile(resolve(dir,'unplanned-matches-preflight-v2.json'),'utf8');assert.equal(sha(preRaw),coverage.preflightHash);const pre=JSON.parse(preRaw);
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey),byAnchor=new Map(coverage.findings.map(f=>[f.rowId,f]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts');
const results=[];
for(const source of pre.findings){
 const anchors=source.anchorEvidence.map(a=>{const parsed=byAnchor.get(a.rowId);assert.equal(parsed.rowHash,a.rowHash);return parsed;});
 for(const pair of source.pairs){
  const rows=variants.get(pair.vehicleVariantKey);assert.ok(rows?.length);
  if(!anchors.length||anchors.some(a=>!a.result)){results.push({sourceRequirementId:source.sourceRequirementId,vehicleVariantKey:pair.vehicleVariantKey,status:'UNPARSED_APPLICATION',reasons:pair.reasons,publicationAllowed:false});continue;}
  const branches=anchors.flatMap(a=>a.result.branches.map(b=>({anchorRowId:a.rowId,anchorHash:a.rowHash,...b}))).filter(b=>rows.every(r=>norm(r.engineCode)===norm(b.engineCode)));
  if(!branches.length){results.push({sourceRequirementId:source.sourceRequirementId,vehicleVariantKey:pair.vehicleVariantKey,status:'NO_EXACT_ENGINE_BRANCH',reasons:pair.reasons,publicationAllowed:false});continue;}
  for(const branch of branches){
   const w=pair.window?.intersection,from=[w?.from,branch.effectiveDates.from].filter(Boolean).sort().at(-1),to=[w?.to,branch.effectiveDates.to].filter(Boolean).sort()[0]??null;
   const reasons=[];
   if(!w||!from||!to||from>to)reasons.push('NO_BOUNDED_DATE_INTERSECTION');
   if(!rows.every(r=>r.hp!=null&&branch.powerHp.includes(Number(r.hp))))reasons.push('EXACT_BRANCH_POWER_NOT_CONFIRMED');
   if(branch.driveCondition)reasons.push('DRIVE_CONDITION_REQUIRES_SUPPORT');
   const remaining=pair.reasons.filter(r=>!['ENGINE_BRANCH_SCOPE_REQUIRES_PARSE','EXACT_SINGLE_ENGINE_SCOPE_NOT_PROVEN','SOURCE_ENGINE_ANCHOR_DATE_SCOPE'].includes(r));
   // A market branch is retained as an explicit request requirement, never
   // used as evidence that the selected vehicle was sold in that market.
   results.push({sourceRequirementId:source.sourceRequirementId,vehicleVariantKey:pair.vehicleVariantKey,originalSourceHash:source.sourceHash,originalAssociationFingerprint:pair.originalAssociationFingerprint,branch,proposedScope:{matchedEngineScope:[norm(branch.engineCode)],window:{intersection:{from,to}},...(branch.requiredMarket?{requiredMarket:branch.requiredMarket}:{})},status:reasons.length?'BRANCH_IDENTITY_REVIEW':'BRANCH_SCOPED_REMATCH_REQUIRED',branchReasons:reasons,remainingTechnicalOrPredecessorReasons:remaining,originalReasons:pair.reasons,publicationAllowed:false});
  }
 }
}
const summary={sources:pre.findings.length,originalTargetPairs:pre.findings.flatMap(f=>f.pairs).length,branchResults:results.length,statuses:Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length])),scopedWithExplicitMarket:results.filter(r=>r.status==='BRANCH_SCOPED_REMATCH_REQUIRED'&&r.proposedScope.requiredMarket).length};
await writeFile(resolve(dir,'unplanned-literal-branch-scopes-v2.json'),JSON.stringify({kind:'LITERAL_BRANCH_SCOPES_FOR_UNPLANNED_MATCHES',coverageHash:sha(coverageRaw),preflightHash:sha(preRaw),mannHash:sha(mannRaw),summary,results,productionApplyAllowed:false,limitations:['Rematch is still required with narrowed source power and dates; no approval or canonical insertion.','Original capacity, drive, equipment, denylist and predecessor obligations remain.','Source-row market review remains even when engine anchor has a parsed market.','Explicit market is a future user-confirmed scope gate, not a confirmed vehicle market.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
