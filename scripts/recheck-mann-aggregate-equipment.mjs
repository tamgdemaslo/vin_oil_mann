import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const auditRaw=await readFile(resolve(dir,'aggregate-source-context-v1.json'),'utf8'),audit=JSON.parse(auditRaw);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sourceRaw),audit.sourceHash);
assert.equal(audit.extractorHash,sha(await readFile(resolve(root,'src/lib/fluid-aggregate-source-context.ts'),'utf8')));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(dir,'source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),rows=parseCopy(mannRaw,'mann_filter_applications'),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {parseFluidCapacities}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const cache=new Map(),results=[];
for(const finding of audit.findings.filter(r=>r.disposition==='EQUIPMENT_CONFIRMATION_REMATCH_CANDIDATE')){
  const r=sources.get(finding.requirementId);assert.ok(r);assert.equal(r.systemCode,finding.metadata.systemCode);
  const key=finding.topCandidate.variantIds[0],target=variants.get(key)??[],windows=target.map(row=>applicabilityWindow(r,row));
  const window=windows[0],reasons=[];
  if(!window||windows.some(w=>!w)||new Set(windows.map(sha)).size!==1)reasons.push('INCONSISTENT_MONTH_SCOPE');
  if(r.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_CONFLICT');
  const normalized=normalize(r),make=normalized?.canonicalMake;
  if(!cache.has(make)){const forms=new Set(mannMakeFormsForTest(make??''));cache.set(make,rows.filter(row=>forms.has(normalizeMannText(row.makeNormalized||row.make))));}
  let candidate=null;
  if(window){
    const decision=match({...r,...window.narrowedYears},cache.get(make));candidate=decision.topCandidates[0];
    if(!candidate||candidate.variantIds.length!==1||candidate.variantIds[0]!==key||candidate.score<80||!candidate.matchedFields.includes('точный код двигателя'))reasons.push('NO_UNIQUE_EXACT_IDENTITY');
    if(candidate){
      reasons.push(...candidate.hardConflicts);
      const equipmentBlocker=r.systemCode==='POWER_STEERING'?'MANN variant не подтверждает наличие этой гидравлической системы':'MANN variant не подтверждает привод или модель агрегата';
      reasons.push(...candidate.reviewBlockers.filter(b=>b!==equipmentBlocker));
      if(decision.topCandidates.slice(1).some(c=>!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=candidate.score-10))reasons.push('NEARBY_EXACT_ENGINE_ALTERNATIVE');
    }
  }
  const capacity=parseFluidCapacities(r.fillVolumeText,r.systemCode);
  if(capacity.needsReview)reasons.push('CAPACITY_REQUIRES_REVIEW');
  const fingerprint=originalAssociationFingerprint(key,overlay.originalById.get(r.id),capacity);
  if(denied.has(fingerprint))reasons.push('PREVIOUSLY_REJECTED_ASSOCIATION');
  results.push({requirementId:r.id,vehicleVariantKey:key,systemCode:r.systemCode,sourceUrl:r.sourceUrl,
    disposition:reasons.length?'REVIEW':'EQUIPMENT_SCOPED_DRAFT_CANDIDATE',reasons:[...new Set(reasons)],
    originalAssociationFingerprint:fingerprint,sourceVehicleScope:{make:r.make,model:r.model,...(r.generation?{generation:r.generation}:{})},
    sourceExactEngineCodes:normalized?.sourceExactEngineCodes??[],window,requiredEquipment:finding.metadata,candidate,publicationAllowed:false});
  if(results.length%50===0)console.log(JSON.stringify({processed:results.length}));
}
const report={kind:'AGGREGATE_EQUIPMENT_FULL_MAKE_RECHECK',sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),auditHash:sha(auditRaw),identityCorrections:overlay.metadata,
  checked:results.length,counts:Object.fromEntries([...Map.groupBy(results,r=>r.disposition)].map(([k,v])=>[k,v.length])),productionApplyAllowed:false,
  limitation:'Rechecked identities only. Equipment is not VIN-confirmed; draft builder, exact per-target engine scopes, runtime gates and UI required before display.',results};
await writeFile(resolve(dir,'aggregate-equipment-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,results:undefined},null,2));
