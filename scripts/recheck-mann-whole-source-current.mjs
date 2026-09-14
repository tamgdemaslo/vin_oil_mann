import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {conditionalVehicleIdentityReasons} from './lib/mann-conditional-vehicle-identity.mjs';
const mode=process.argv[2];assert.ok(mode===undefined||mode==='compound-headings','Unknown replay mode');
const compoundHeadings=mode==='compound-headings';
const root=resolve(import.meta.dirname,'..'),parentDir=resolve(root,compoundHeadings?'outputs/mann-type-count-added-preview-2026-09-14':'outputs/mann-specification-role-scoped-preview-2026-09-14');
const [planRaw,sourceRaw,mannRaw,coverageRaw]=await Promise.all([readFile(resolve(parentDir,'plan.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(parentDir,'full-source-coverage.json'),'utf8')]);
assert.equal(sha(planRaw),compoundHeadings?'5d860f8615a07175105a0b3a8c2a0a30d92abe72523925bb2921efc1754c0221':'711a88e19895736d82713535038e69c10a4c7f5ec1381d81bfba8d2645dd9221');
const plan=JSON.parse(planRaw),coverage=JSON.parse(coverageRaw);assert.equal(coverage.planHash,sha(planRaw));assert.equal(sha(sourceRaw),plan.inputHashes.source);
assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const allRows=parseCopy(mannRaw,'mann_filter_applications'),byMake=new Map();
const oldCoverage=new Map((coverage.rows??coverage.findings??[]).map(r=>[r.requirementId,r.status]));
assert.equal(oldCoverage.size,13296,'Whole source coverage rows must be bound');
const out=resolve(root,compoundHeadings?'outputs/mann-compound-headings-recheck-2026-09-14':'outputs/mann-whole-source-current-recheck-2026-09-14');await mkdir(out);
const codeFiles=['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/fluid-catalog.ts','src/lib/mann-engine-code-list.ts','scripts/lib/mann-source-identity-overlay.mjs','scripts/lib/mann-conditional-vehicle-identity.mjs','scripts/recheck-mann-whole-source-current.mjs'];
const codeHashes=Object.fromEntries(await Promise.all(codeFiles.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))])));
const manifest={planPath:resolve(parentDir,'plan.json'),planHash:sha(planRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),coverageHash:sha(coverageRaw),identityOverlay:overlay.metadata,codeHashes,expectedSources:overlay.requirements.length,productionApplyAllowed:false};
await writeFile(resolve(out,'input-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
const stream=await open(resolve(out,'decisions.ndjson'),'wx'),statusCounts={},oldUnresolvedStatusCounts={},reasonCounts={},identityCandidates=[];let count=0;
try{
 for(const source of overlay.requirements){
  if(!byMake.has(source.make)){const forms=new Set(mannMakeFormsForTest(source.make));byMake.set(source.make,allRows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
  const decision=match(source,byMake.get(source.make)),top=decision.topCandidates[0];
  const identityReasons=conditionalVehicleIdentityReasons(source,top);
  if(!top||top.variantIds.length!==1||top.score<80)identityReasons.push('NOT_UNIQUE_STRONG_TOP_TARGET');
  if(top){identityReasons.push(...top.hardConflicts);if(decision.topCandidates.some(c=>c!==top&&!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=top.score-10))identityReasons.push('NEARBY_EXACT_ENGINE_ALTERNATIVE');}
  const oldStatus=oldCoverage.get(source.id);assert.ok(oldStatus);
  const finding={requirementId:source.id,originalSourceHash:sha(overlay.originalById.get(source.id)),effectiveSourceHash:sha(source),oldCoverageStatus:oldStatus,
   currentCandidateRevisionIds:plan.newRevisions.filter(r=>r.sourceRequirementId===source.id).map(r=>r.id),decision,identityReasons:[...new Set(identityReasons)],publicationAllowed:false};
  await stream.write(JSON.stringify(finding)+'\n');count++;
  statusCounts[decision.status]=(statusCounts[decision.status]??0)+1;
  if(oldStatus==='UNRESOLVED_MATCH_OR_CONDITIONS'){
   oldUnresolvedStatusCounts[decision.status]=(oldUnresolvedStatusCounts[decision.status]??0)+1;
   for(const reason of finding.identityReasons)reasonCounts[reason]=(reasonCounts[reason]??0)+1;
   if(!identityReasons.length)identityCandidates.push({requirementId:source.id,systemCode:source.systemCode,make:source.make,model:source.model,variantIds:top.variantIds,score:top.score,matchedFields:top.matchedFields,reviewBlockers:top.reviewBlockers,decisionStatus:decision.status,sourceHash:finding.originalSourceHash,publicationAllowed:false});
  }
  if(count%250===0)console.log(JSON.stringify({processed:count,total:overlay.requirements.length,statusCounts,oldUnresolvedIdentityCandidates:identityCandidates.length}));
 }
}finally{await stream.close();}
assert.equal(count,13296);
for(const [file,hash]of Object.entries(codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')),'Code changed during full replay');
assert.equal(sha(await readFile(resolve(parentDir,'plan.json'),'utf8')),sha(planRaw));
const report={...manifest,processed:count,decisionsHash:sha(await readFile(resolve(out,'decisions.ndjson'),'utf8')),statusCounts,oldUnresolvedStatusCounts,oldUnresolvedIdentityCandidateCount:identityCandidates.length,reasonCounts,identityCandidates,productionApplyAllowed:false,canonicalPlanChanged:false,limitations:['Current full-make replay of original sources plus identity overlay only.','Strong top identity is triage, not publication eligibility; exact source engine/power/market/month partition and technical source-role quality still required.','Existing scoped candidates may improve on raw multi-engine source decisions; not an instruction to replace them.','Matcher CONFIRMED does not mean OEM technical validation or production authorization.']};
await writeFile(resolve(out,'summary.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,identityCandidates:undefined,codeHashes:undefined,identityOverlay:undefined}));
