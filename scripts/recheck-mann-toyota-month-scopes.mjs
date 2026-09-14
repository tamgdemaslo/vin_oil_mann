import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint,YEAR_BLOCKER} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {gearboxSourceQuality} from './lib/mann-gearbox-source-quality.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-transmission-list-preview-2026-09-14');
const [sourceRaw,mannRaw,auditRaw,planRaw]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'toyota-az-fix-replay-v1.json'),'utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const audit=JSON.parse(auditRaw),plan=JSON.parse(planRaw);assert.equal(audit.sourceHash,sha(sourceRaw));assert.equal(audit.mannHash,sha(mannRaw));assert.equal(audit.planHash,sha(planRaw));
for(const [file,hash] of Object.entries(audit.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,'src/lib',file),'utf8')));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json')),sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {splitMannEngineCodeList:split}=await jiti.import('../src/lib/mann-engine-code-list.ts');
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {extractFluidSourceSystemContext:label}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const {mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts');
const quality=gearboxSourceQuality([...overlay.originalById.values()],component,label);
const forms=new Set(mannMakeFormsForTest('TOYOTA')),rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const selected=audit.results.filter(r=>r.topCandidates[0]?.hardConflicts.length===0&&r.topCandidates[0].reviewBlockers.includes(YEAR_BLOCKER));
const results=[];
for(const previous of selected){
 const source=sources.get(previous.sourceRequirementId),original=overlay.originalById.get(source.id);assert.equal(sha(original),previous.sourceHash);
 const initial=previous.topCandidates[0],key=initial.variantIds.length===1?initial.variantIds[0]:null,reasons=[];
 let window=null,decision=null,engines=[],fingerprint=null;
 if(!key)reasons.push('NO_UNIQUE_INITIAL_TARGET');
 else{
  const target=variants.get(key);assert.ok(target?.length);
  const windows=target.map(r=>applicabilityWindow(source,r));window=windows[0];
  if(!window||windows.some(w=>!w)||new Set(windows.map(sha)).size!==1)reasons.push('INCONSISTENT_MONTH_SCOPE');
  else{
   decision=match({...source,...window.narrowedYears},rows);
   const top=decision.topCandidates[0];
   if(!top||top.variantIds.length!==1||top.variantIds[0]!==key||top.score<80||!top.matchedFields.includes('точный код двигателя'))reasons.push('NO_UNIQUE_EXACT_ENGINE_IDENTITY');
   if(top){reasons.push(...top.hardConflicts,...top.reviewBlockers);
    if(decision.topCandidates.slice(1).some(c=>!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=top.score-10))reasons.push('NEARBY_EXACT_ENGINE_ALTERNATIVE');
   }
   if(!decision.targets.some(t=>t.vehicleVariantKey===key&&t.independentlyValidated))reasons.push('TARGET_NOT_INDEPENDENTLY_VALIDATED');
  }
  const targetCodes=new Set(target.flatMap(r=>split(r.engineCode).map(norm)));
  engines=[...new Set([source.engineCodeNormalized,...source.engineCodesJson].filter(Boolean).filter(c=>targetCodes.has(norm(c))))];
  if(!engines.length)reasons.push('NO_EXACT_ENGINE_SCOPE');
  const capacity=parse(original.fillVolumeText,source.systemCode);if(capacity.needsReview||!capacity.capacities.length)reasons.push('CAPACITY_REVIEW');
  fingerprint=originalAssociationFingerprint(key,original,capacity);if(denied.has(fingerprint))reasons.push('PREVIOUSLY_REJECTED_ASSOCIATION');
 }
 const metadata=label(source.systemNameRaw,source.componentModel);
 if(metadata.issues.length||metadata.hasAdditionalLabelConditions)reasons.push('SOURCE_LABEL_REVIEW');
 if(quality.heldBySource.has(source.id))reasons.push('SOURCE_MODEL_GEAR_COUNT_CONFLICT');
 if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_REVIEW');
 results.push({sourceRequirementId:source.id,sourceHash:sha(original),systemCode:source.systemCode,model:source.model,vehicleVariantKey:key,status:reasons.length?'REVIEW':'MONTH_SCOPED_CANDIDATE',reasons:[...new Set(reasons)],window,matchedEngineScope:engines,originalAssociationFingerprint:fingerprint,decision,metadata,existingRevisionIds:plan.newRevisions.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===key).map(r=>r.id),publicationAllowed:false});
 if(results.length%50===0)console.log(JSON.stringify({processed:results.length,total:selected.length}));
}
const candidates=results.filter(r=>r.status==='MONTH_SCOPED_CANDIDATE');
const report={sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),planHash:sha(planRaw),auditHash:sha(auditRaw),codeHashes:audit.codeHashes,summary:{selected:selected.length,candidates:candidates.length,newPairs:candidates.filter(r=>!r.existingRevisionIds.length).length,existingPairs:candidates.filter(r=>r.existingRevisionIds.length).length,review:results.length-candidates.length},results,productionApplyAllowed:false,limitation:'Date intersection only; source engine/power unchanged. Candidates require exact horsepower, source technical review, runtime tests and complete source-domain partition. Conditional equipment/gearboxes remain review.'};
await writeFile(resolve(dir,'toyota-month-scope-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
