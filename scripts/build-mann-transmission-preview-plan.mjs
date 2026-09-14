import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
assert.equal(process.argv.length,2,'Offline only');
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const [raw,sourceRaw,mannRaw,liveRaw]=await Promise.all([readFile(resolve(dir,'conditional-transmission-recheck.json'),'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),
  readFile(resolve(root,'outputs/mann-live-audit-1789334190861/revisions.json'),'utf8')]);
const report=JSON.parse(raw);
assert.deepEqual(report.sourceHashes,{revisions:sha(liveRaw),fluids:sha(sourceRaw),mann:sha(mannRaw)});
const overlay=await loadIdentityOverlay(root,sourceRaw,report.identityCorrections.path,report.identityCorrections.sha256);
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),live=new Map(JSON.parse(liveRaw).map(r=>[r.id,r]));
const rows=parseCopy(mannRaw,'mann_filter_applications'),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts');
const {parseFluidCapacities}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const blocker='MANN variant не подтверждает тип или модель коробки',policy='USER_CONFIRMED_TRANSMISSION_V1';
const typeBySystem={AUTOMATIC_TRANSMISSION:'automatic',MANUAL_TRANSMISSION:'manual',CVT_TRANSMISSION:'cvt',ROBOT_TRANSMISSION:'robot'};
const revisions=[],decisions=[],makeCache=new Map(),matchCache=new Map(),seen=new Set();
for(const entry of report.results){
  assert.ok(!seen.has(entry.revisionId));seen.add(entry.revisionId);
  const old=live.get(entry.revisionId),source=sources.get(entry.sourceRequirementId);
  assert.ok(old&&source);assert.equal(old.sourceRequirementId,source.id);assert.equal(old.vehicleVariantKey,entry.vehicleVariantKey);
  const reasons=[];
  if(!['TYPE_CONFIRMATION_PREVIEW','COMPONENT_CONFIRMATION_PREVIEW'].includes(entry.disposition))reasons.push(entry.disposition);
  if(old.reviewConfirmed||old.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS')reasons.push('PROTECTED');
  if(reasons.length){decisions.push({revisionId:old.id,disposition:'REVIEW',reasons});continue;}
  assert.deepEqual(entry.reasons,[]);
  const classified=component(source.componentModel);
  assert.equal(classified.kind,entry.disposition==='TYPE_CONFIRMATION_PREVIEW'?'type':'model');
  assert.equal(typeBySystem[source.systemCode],source.transmissionType);
  assert.notEqual(source.rawRequirementJson?.sourceIdentity?.reviewRequired,true);
  const targets=variants.get(old.vehicleVariantKey);assert.ok(targets?.length);
  const windows=targets.map(row=>applicabilityWindow(source,row)),window=windows[0];
  assert.ok(window&&windows.every(w=>sha(w)===sha(window)));assert.deepEqual(window,entry.applicability.window);
  const normalized=normalize(source);assert.ok(normalized);
  if(!makeCache.has(normalized.canonicalMake)){const forms=new Set(mannMakeFormsForTest(normalized.canonicalMake));makeCache.set(normalized.canonicalMake,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
  const cacheKey=sha({id:source.id,years:window.narrowedYears});
  if(!matchCache.has(cacheKey))matchCache.set(cacheKey,match({...source,...window.narrowedYears},makeCache.get(normalized.canonicalMake)));
  const full=matchCache.get(cacheKey),candidate=full.topCandidates.find(c=>c.variantIds.includes(old.vehicleVariantKey));
  assert.ok(candidate&&candidate.rank===1&&candidate.variantIds.length===1&&candidate.score>=80);
  assert.deepEqual(candidate.hardConflicts,[]);assert.deepEqual(candidate.reviewBlockers,[blocker]);
  assert.ok(candidate.matchedFields.includes('точный код двигателя'));
  const alternatives=full.topCandidates.filter(c=>c!==candidate&&!c.hardConflicts.length&&c.score>=candidate.score-10&&c.matchedFields.includes('точный код двигателя')&&c.reviewBlockers.every(b=>b===blocker));
  if(alternatives.length){decisions.push({revisionId:old.id,disposition:'REVIEW',reasons:['NEARBY_ALTERNATIVE_TARGET'],alternatives:alternatives.map(c=>({score:c.score,variantIds:c.variantIds}))});continue;}
  const engines=normalized.sourceExactEngineCodes.filter(code=>targets.every(row=>String(row.engineCode??'').split(/[;,/|]+/).map(normalizeEngineCode).includes(code)));
  if(!engines.length){decisions.push({revisionId:old.id,disposition:'REVIEW',reasons:['NO_EXACT_TARGET_ENGINE_SCOPE']});continue;}
  const capacity=parseFluidCapacities(source.fillVolumeText,source.systemCode);assert.equal(capacity.needsReview,false);assert.deepEqual(capacity,entry.capacity);
  const sourceFingerprint=originalAssociationFingerprint(old.vehicleVariantKey,overlay.originalById.get(source.id),capacity);
  if(denied.has(sourceFingerprint)){decisions.push({revisionId:old.id,disposition:'REVIEW',reasons:['PREVIOUSLY_REJECTED_ASSOCIATION']});continue;}
  const applicabilityJson={yearFrom:source.yearFrom,yearTo:source.yearTo,transmissionType:source.transmissionType,componentModel:source.componentModel,
    sourceVehicleScope:{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})},matchedEngineScope:engines,window};
  const technicalDataJson={fillVolumeText:source.fillVolumeText,capacities:capacity.capacities,specificationText:source.specificationText,
    specifications:source.specificationsJson,viscosityGrades:source.viscosityGradesJson,recommendationText:source.recommendationText,
    replacementIntervalText:source.replacementIntervalText,replacementKmMin:source.replacementKmMin,replacementKmMax:source.replacementKmMax,
    replacementMonths:source.replacementMonths,controlIntervalText:source.controlIntervalText,analogText:source.analogText};
  const fingerprint=sha({policy,sourceRequirementId:source.id,vehicleVariantKey:old.vehicleVariantKey,applicabilityJson,technicalDataJson});
  const revision={id:`mtar_${fingerprint.slice(0,24)}`,sourceRequirementId:source.id,vehicleVariantKey:old.vehicleVariantKey,
    systemCode:source.systemCode,componentModel:source.componentModel,applicabilityJson,technicalDataJson,
    state:'REVIEW',verificationStatus:'UNVERIFIED',matchClass:'CONDITIONAL_TRANSMISSION',matchScore:candidate.score,applyEligible:false,verifiedFieldsJson:[],
    fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(f=>[`technical.${f}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),
    evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:source.sourceUrl}],
    provenanceJson:{conditionalTransmissionPolicy:policy,conditionalTransmissionEligible:true,conditionalTransmissionChoiceRequired:true,
      sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:sourceFingerprint,sourceRecheckHash:sha(raw),identityCorrectionHash:overlay.metadata.sha256,
      independentValidation:{score:candidate.score,matchedFields:candidate.matchedFields,hardConflicts:[],reviewBlockers:[blocker],vehicleIdentityIndependentlyValidated:true}},
    semanticFingerprint:fingerprint,replacesRevisionIds:[old.id]};
  revisions.push(revision);decisions.push({revisionId:old.id,disposition:'CONDITIONAL_PREVIEW',successorId:revision.id,requiredChoice:classified});
}
assert.equal(seen.size,report.total);assert.equal(new Set(revisions.map(r=>r.id)).size,revisions.length);
const codeFiles=['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-transmission-component.ts','scripts/build-mann-transmission-preview-plan.mjs'];
const plan={kind:'CORRECTED_CONDITIONAL_TRANSMISSION_PLAN',productionApplyAllowed:false,policy,
  inputHashes:{recheck:sha(raw),source:sha(sourceRaw),mann:sha(mannRaw),live:sha(liveRaw)},identityCorrections:overlay.metadata,
  codeHashes:Object.fromEntries(await Promise.all(codeFiles.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),
  summary:{checked:seen.size,candidates:revisions.length,review:seen.size-revisions.length,requiredChoices:Object.fromEntries([...Map.groupBy(decisions.filter(d=>d.requiredChoice),d=>d.requiredChoice.kind)].map(([k,v])=>[k,v.length]))},
  limitation:'Existing 497 conditional records only; independent full-make re-evaluation, but not OEM facts, production import or whole-database coverage.',revisions,decisions};
await writeFile(resolve(dir,'conditional-transmission-plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(plan.summary,null,2));
