import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
const coverageRaw=await readFile(resolve(root,'outputs/mann-equipment-inclusive-preview-2026-09-14/full-source-coverage.json'),'utf8'),coverage=JSON.parse(coverageRaw);
assert.equal(coverage.sourceHash,sha(sourceRaw));
const unresolved=new Set(coverage.rows.filter(r=>r.status!=='IN_LOCAL_PREVIEW_PLAN').map(r=>r.requirementId));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(dir,'source-identity-corrections.json'));
const rows=parseCopy(mannRaw,'mann_filter_applications'),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {parseFluidCapacities}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const eligible=overlay.requirements.filter(r=>unresolved.has(r.id)&&['ENGINE_OIL','ENGINE_COOLANT','BRAKE_FLUID'].includes(r.systemCode)&&(normalize(r)?.sourceExactEngineCodes.length??0)>=5);
const makeCache=new Map(),results=[];
let attempts=0;
for(const source of eligible){
  const identity=normalize(source),codes=identity.sourceExactEngineCodes;
  if(!makeCache.has(identity.canonicalMake)){
    const forms=new Set(mannMakeFormsForTest(identity.canonicalMake));makeCache.set(identity.canonicalMake,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));
  }
  const catalog=makeCache.get(identity.canonicalMake),capacity=parseFluidCapacities(source.fillVolumeText,source.systemCode),blocked=[];
  if(capacity.needsReview)blocked.push('CAPACITY_REQUIRES_REVIEW');
  if(!source.specificationText?.trim()&&!source.specificationsJson?.length)blocked.push('MISSING_SPECIFICATION');
  if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)blocked.push('SOURCE_IDENTITY_CONFLICT');
  const outcomes=[],cache=new Map();
  for(const code of codes){
    const targets=[...new Set(catalog.filter(r=>String(r.engineCode??'').split(/[;,/|]+/).map(normalizeEngineCode).includes(code)).map(r=>r.vehicleVariantKey))];
    if(!targets.length){outcomes.push({engineCode:code,status:'EXACT_ENGINE_ABSENT_FROM_MANN'});continue;}
    let tested=0;
    for(const key of targets){
      const target=variants.get(key),windows=target.map(r=>applicabilityWindow(source,r)),window=windows[0];
      if(!window||windows.some(w=>!w)||new Set(windows.map(sha)).size!==1)continue;
      if(!target.every(r=>String(r.engineCode??'').split(/[;,/|]+/).map(normalizeEngineCode).includes(code)))continue;
      const cacheKey=sha({code,years:window.narrowedYears});
      if(!cache.has(cacheKey)){
        cache.set(cacheKey,match({...source,...window.narrowedYears,engineCodeNormalized:code,engineCodesJson:[code]},catalog));attempts++;
      }
      const decision=cache.get(cacheKey),candidate=decision.topCandidates.find(c=>c.variantIds.includes(key));
      const accepted=decision.targets.find(t=>t.vehicleVariantKey===key&&t.independentlyValidated&&!t.hardConflicts.length&&!t.reviewBlockers.length&&t.matchedFields.includes('точный код двигателя'));
      const fingerprint=originalAssociationFingerprint(key,overlay.originalById.get(source.id),capacity);
      const reasons=[...blocked];if(denied.has(fingerprint))reasons.push('PREVIOUSLY_REJECTED_ASSOCIATION');
      outcomes.push({engineCode:code,vehicleVariantKey:key,window,status:accepted&&!reasons.length?'SINGLE_ENGINE_MATCH_DIAGNOSTIC':'REVIEW',reasons,
        matchStatus:decision.status,validation:accepted??null,topCandidate:candidate?{score:candidate.score,hardConflicts:candidate.hardConflicts,reviewBlockers:candidate.reviewBlockers}:null,
        originalAssociationFingerprint:fingerprint});tested++;
    }
    if(!tested)outcomes.push({engineCode:code,status:'NO_CONSISTENT_DATE_AND_ENGINE_SCOPE'});
  }
  results.push({requirementId:source.id,sourceUrl:source.sourceUrl,systemCode:source.systemCode,originalEngineCodes:codes,sourceHash:sha(overlay.originalById.get(source.id)),
    sourceVehicleScope:{make:source.make,model:source.model,generation:source.generation},outcomes,publicationAllowed:false});
  if(results.length%25===0)console.log(JSON.stringify({processed:results.length,total:eligible.length,attempts}));
}
const outcomes=results.flatMap(r=>r.outcomes),matches=outcomes.filter(r=>r.status==='SINGLE_ENGINE_MATCH_DIAGNOSTIC');
const report={kind:'LARGE_SOURCE_ENGINE_LIST_DIAGNOSTIC',sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),coverageHash:sha(coverageRaw),identityCorrections:overlay.metadata,
  summary:{sourceRequirements:results.length,fullMakeAttempts:attempts,engineTargetMatches:matches.length,requirementsWithMatches:results.filter(r=>r.outcomes.some(o=>o.status==='SINGLE_ENGINE_MATCH_DIAGNOSTIC')).length,
    outcomes:Object.fromEntries([...Map.groupBy(outcomes,r=>r.status)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false,
  limitation:'Diagnostic splitting of explicit source engine lists only; original large-list gate unchanged. Raw source list provenance and conditional technical scope need verification before proposals.',results};
await writeFile(resolve(dir,'large-engine-list-diagnostic-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
