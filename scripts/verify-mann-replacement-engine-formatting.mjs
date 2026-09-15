import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'replacement-scope-exclusion-evidence-v1.json'),'utf8'),evidence=JSON.parse(raw);
const transitionsRaw=await readFile(resolve(dir,'replacement-scope-transition-v1.json'),'utf8');assert.equal(sha(transitionsRaw),evidence.auditHash);
const transitions=new Map(JSON.parse(transitionsRaw).findings.map(f=>[f.revisionId,f]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeEngineCode:normalize}=await j.import('../src/lib/vehicle-normalization.ts');
const {mannTechnicalScopeMatches:matches}=await j.import('../src/lib/mann-technical-applicability.ts');
let runtimeChecks=0;
const findings=evidence.findings.filter(f=>f.engineReasons.length).map(f=>{
 const codes=transitions.get(f.revisionId).newEngineTokens,accepted=new Set(codes.map(normalize)),mannCodes=new Set(f.mannEngineTokens.map(normalize));
 const reasons=f.engineReasons.map(e=>{
  const parts=e.expandedParts.map(part=>{
   const normalized=normalize(part),retained=accepted.has(normalized);
   assert.equal(matches({matchedEngineScope:codes},{engineCode:part}),retained);runtimeChecks++;
   return {raw:part,normalized,retainedByRuntime:retained,listedByMann:mannCodes.has(normalized)};
  });
  return {originalToken:e.token,parts,status:parts.every(p=>p.retainedByRuntime)?'FORMAT_ONLY_NO_ENGINE_LOSS':parts.some(p=>!p.retainedByRuntime&&p.listedByMann)?'SOURCE_SCOPE_REVIEW':'OUTSIDE_SELECTED_MANN_ENGINE_LIST'};
 });
 return {revisionId:f.revisionId,sourceRequirementId:f.sourceRequirementId,newEngineTokens:codes,reasons};
});
const summary={literalDifferenceRows:findings.length,allDifferencesFormatOnly:findings.filter(f=>f.reasons.every(r=>r.status==='FORMAT_ONLY_NO_ENGINE_LOSS')).length,sourceScopeReviewRows:findings.filter(f=>f.reasons.some(r=>r.status==='SOURCE_SCOPE_REVIEW')).length,outsideMannRows:findings.filter(f=>f.reasons.some(r=>r.status==='OUTSIDE_SELECTED_MANN_ENGINE_LIST')).length,runtimeChecks};
const report={kind:'REPLACEMENT_ENGINE_FORMAT_RUNTIME_VERIFICATION',evidenceHash:sha(raw),normalizerHash:sha(await readFile(resolve(root,'src/lib/vehicle-normalization.ts'),'utf8')),scopeMatcherHash:sha(await readFile(resolve(root,'src/lib/mann-technical-applicability.ts'),'utf8')),summary,findings,productionApplyAllowed:false,limitations:['Checks actual existing engine normalization and isolated engine condition; no new alias or matching rule.','Other applicability dimensions are not removed from actual revisions; isolation exists only in these tests.','MANN engine-list absence is not proof of fluid suitability elsewhere.']};
await writeFile(resolve(dir,'replacement-engine-format-verification-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
