import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {conditionalVehicleIdentityReasons} from './lib/mann-conditional-vehicle-identity.mjs';
assert.ok(process.argv.length<=4&&(!process.argv[3]||process.argv[3]==='non-ru'));
const nonRu=process.argv[3]==='non-ru';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,process.argv[2]??'outputs/mann-market-power-held-preview-2026-09-14');
const [raw,sql,mannRaw,auditRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,nonRu?'source-market-target-scope-audit-v2.json':'source-market-target-scope-audit-v1.json'),'utf8')]);
const plan=JSON.parse(raw),audit=JSON.parse(auditRaw);assert.equal(audit.planHash,sha(raw));assert.equal(audit.mannHash,sha(mannRaw));
for(const [file,hash]of Object.entries(audit.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const overlay=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json')),sources=new Map(overlay.requirements.map(r=>[r.id,r])),revisions=new Map(plan.newRevisions.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const rows=parseCopy(mannRaw,'mann_filter_applications'),byMake=new Map(),cache=new Map(),findings=[];
for(const f of audit.findings.filter(f=>f.statuses.length===1&&f.statuses[0]===(nonRu?'NON_RU_GUARD_MISSING_EXACT_POWER_DATES_SUPPORTED':'RU_GUARD_MISSING_EXACT_POWER_DATES_SUPPORTED'))){
 const revision=revisions.get(f.revisionId),source=sources.get(f.sourceRequirementId);assert.equal(sha(revision),f.revisionHash);
 if(!byMake.has(source.make)){const forms=new Set(mannMakeFormsForTest(source.make));byMake.set(source.make,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
 const attempts=[];
 for(const check of [...new Map(f.checks.map(c=>[sha({scope:c.scopeIndex,engine:c.engine,hp:c.powerHp,window:c.currentWindow}),c])).values()]){
  assert.equal(check.markets.length,1);assert.ok(nonRu?check.markets[0]!=='RU':check.markets[0]==='RU');
  assert.ok(check.overlaps.some(b=>b.market===check.markets[0]&&b.powerHp.includes(check.powerHp)));
  const scoped={...source,engineCodesJson:[check.engine],engineCodeNormalized:check.engine,powerHp:check.powerHp,yearFrom:check.currentWindow.from?Number(check.currentWindow.from.slice(0,4)):null,yearTo:check.currentWindow.to?Number(check.currentWindow.to.slice(0,4)):null};
  const key=sha(scoped);if(!cache.has(key))cache.set(key,match(scoped,byMake.get(source.make)));
  const decision=cache.get(key),candidate=decision.topCandidates.find(c=>c.variantIds.includes(revision.vehicleVariantKey));
  const reasons=conditionalVehicleIdentityReasons(scoped,candidate);
  if(!candidate)reasons.push('TARGET_NOT_IN_FULL_MAKE_TOP_CANDIDATES');
  else {
   if(candidate.variantIds.length!==1||decision.topCandidates[0]!==candidate||candidate.score<80)reasons.push('NOT_UNIQUE_STRONG_TOP_TARGET');
   reasons.push(...candidate.hardConflicts);
   if(decision.topCandidates.some(c=>c!==candidate&&!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=candidate.score-10))reasons.push('NEARBY_EXACT_ENGINE_ALTERNATIVE');
  }
  attempts.push({scopeIndex:check.scopeIndex,engine:check.engine,powerHp:check.powerHp,window:check.currentWindow,sourceImportedPowerHp:source.powerHp,sourceIdentity:{generation:source.generation,bodyCodes:source.bodyCodesJson},candidate:candidate??null,topCandidates:decision.topCandidates.map(c=>({variantIds:c.variantIds,score:c.score,matchedFields:c.matchedFields,hardConflicts:c.hardConflicts,reviewBlockers:c.reviewBlockers})),identityReasons:[...new Set(reasons)]});
 }
 findings.push({revisionId:revision.id,revisionHash:sha(revision),sourceRequirementId:source.id,sourceHash:sha(overlay.originalById.get(source.id)),vehicleVariantKey:revision.vehicleVariantKey,attempts,reasons:[...new Set(attempts.flatMap(a=>a.identityReasons))],publicationAllowed:false});
}
assert.equal(findings.length,nonRu?95:283);
const summary={revisions:findings.length,uniqueFullMakeRechecks:cache.size,identityChecksPassed:findings.filter(f=>!f.reasons.length).length,requiresIdentityReview:findings.filter(f=>f.reasons.length).length,reasonCounts:Object.fromEntries([...Map.groupBy(findings.flatMap(f=>f.reasons.map(reason=>({reason}))),x=>x.reason)].map(([k,v])=>[k,v.length]))};
const codeFiles=['scripts/recheck-mann-ru-market-identities.mjs','scripts/lib/mann-conditional-vehicle-identity.mjs','scripts/lib/mann-source-identity-overlay.mjs','src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-engine-code-list.ts'];
const codeHashes=Object.fromEntries(await Promise.all(codeFiles.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))])));
await writeFile(resolve(dir,nonRu?'non-ru-market-identity-recheck-v1.json':'ru-market-identity-recheck-v1.json'),JSON.stringify({planHash:sha(raw),sourceHash:sha(sql),mannHash:sha(mannRaw),marketAuditHash:sha(auditRaw),codeHashes,summary,findings,productionApplyAllowed:false,limitation:'Full-make ranking and independent chassis/model identity only. Other candidate review blockers remain explicitly recorded; not a technical-payload publication approval. Power taken only from exact source branch matching actual target row, never rounded.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary,null,2));
