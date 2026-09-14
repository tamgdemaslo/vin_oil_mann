import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {conditionalVehicleIdentityReasons} from './lib/mann-conditional-vehicle-identity.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-non-ru-market-guarded-preview-2026-09-14');
const [raw,partitionRaw,sql,mannRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'source-market-month-partition-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8')]);
const plan=JSON.parse(raw),partition=JSON.parse(partitionRaw);assert.equal(partition.planHash,sha(raw));
for(const[file,hash]of Object.entries(partition.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
assert.equal(sha(sql),plan.inputHashes.source);assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const overlay=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json')),sources=new Map(overlay.requirements.map(r=>[r.id,r])),revisions=new Map(plan.newRevisions.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const rows=parseCopy(mannRaw,'mann_filter_applications'),byMake=new Map(),cache=new Map(),findings=[];
for(const f of partition.findings){
 const revision=revisions.get(f.revisionId),source=sources.get(f.sourceRequirementId);assert.equal(sha(revision),f.revisionHash);
 if(!byMake.has(source.make)){const forms=new Set(mannMakeFormsForTest(source.make));byMake.set(source.make,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
 const branches=[];
 for(const branch of f.candidateBranches){
  const effective={...source,engineCodesJson:[branch.engineCode],engineCodeNormalized:branch.engineCode,powerHp:branch.powerHp,yearFrom:branch.window.from?Number(branch.window.from.slice(0,4)):null,yearTo:branch.window.to?Number(branch.window.to.slice(0,4)):null};
  const key=sha(effective);if(!cache.has(key))cache.set(key,match(effective,byMake.get(source.make)));
  const decision=cache.get(key),candidate=decision.topCandidates.find(c=>c.variantIds.includes(revision.vehicleVariantKey)),reasons=conditionalVehicleIdentityReasons(effective,candidate);
  if(!candidate)reasons.push('TARGET_NOT_IN_FULL_MAKE_TOP_CANDIDATES');
  else {
   if(candidate.variantIds.length!==1||decision.topCandidates[0]!==candidate||candidate.score<80)reasons.push('NOT_UNIQUE_STRONG_TOP_TARGET');
   reasons.push(...candidate.hardConflicts);
   if(decision.topCandidates.some(c=>c!==candidate&&!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=candidate.score-10))reasons.push('NEARBY_EXACT_ENGINE_ALTERNATIVE');
  }
  branches.push({proposalHash:sha(branch),proposal:branch,candidate:candidate??null,identityReasons:[...new Set(reasons)],topCandidates:decision.topCandidates.map(c=>({variantIds:c.variantIds,score:c.score,matchedFields:c.matchedFields,hardConflicts:c.hardConflicts,reviewBlockers:c.reviewBlockers})),publicationAllowed:false});
 }
 findings.push({revisionId:revision.id,revisionHash:sha(revision),sourceRequirementId:source.id,sourceHash:sha(overlay.originalById.get(source.id)),vehicleVariantKey:revision.vehicleVariantKey,branches,unmatchedEnginePowerChecks:f.unmatchedChecks,sourcePartition:f.partition,publicationAllowed:false});
}
const all=findings.flatMap(f=>f.branches),summary={revisions:findings.length,branches:all.length,uniqueFullMakeRechecks:cache.size,identityPassedBranches:all.filter(b=>!b.identityReasons.length).length,identityReviewBranches:all.filter(b=>b.identityReasons.length).length,revisionsWithAllProposalsPassing:findings.filter(f=>f.branches.length&&f.branches.every(b=>!b.identityReasons.length)).length,reasonCounts:Object.fromEntries([...Map.groupBy(all.flatMap(b=>b.identityReasons.map(reason=>({reason}))),x=>x.reason)].map(([k,v])=>[k,v.length]))};
const files=['scripts/recheck-mann-market-month-branches.mjs','scripts/lib/mann-conditional-vehicle-identity.mjs','scripts/lib/mann-source-identity-overlay.mjs','src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts'];
const codeHashes={...partition.codeHashes,...Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))])))};
await writeFile(resolve(dir,'source-market-month-identity-recheck-v1.json'),JSON.stringify({planHash:sha(raw),partitionHash:sha(partitionRaw),sourceHash:sha(sql),mannHash:sha(mannRaw),codeHashes,summary,findings,productionApplyAllowed:false,limitation:'Full-make identity/ranking for each exact market-engine-power interval proposal. Matcher reranks using enclosing years; exact month bounds remain in proposal and must be enforced by runtime. Other system/technical review blockers still need policy-specific checking; no publication approval or canonical changes.'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary,null,2));
