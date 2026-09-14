import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const [raw,sourceRaw,mannRaw,liveRaw]=await Promise.all([readFile(resolve(dir,'aggregate-equipment-recheck-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(root,'outputs/mann-live-audit-1789334190861/revisions.json'),'utf8')]);
const report=JSON.parse(raw);assert.equal(report.sourceHash,sha(sourceRaw));assert.equal(report.mannHash,sha(mannRaw));
const overlay=await loadIdentityOverlay(root,sourceRaw,report.identityCorrections.path,report.identityCorrections.sha256);
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),rows=parseCopy(mannRaw,'mann_filter_applications'),variants=Map.groupBy(rows,r=>r.vehicleVariantKey),live=JSON.parse(liveRaw);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {parseFluidCapacities}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {extractFluidAggregateSourceContext:extract}=await jiti.import('../src/lib/fluid-aggregate-source-context.ts');
const {readMannEquipmentScope}=await jiti.import('../src/lib/mann-equipment-scope.ts');
const policy='USER_CONFIRMED_EQUIPMENT_V1',revisions=[],decisions=[],cache=new Map();
for(const entry of report.results){
  const reasons=[];const source=sources.get(entry.requirementId);assert.ok(source);
  if(entry.disposition!=='EQUIPMENT_SCOPED_DRAFT_CANDIDATE'){decisions.push({requirementId:source.id,disposition:'REVIEW',reasons:entry.reasons});continue;}
  const metadata=extract(source.systemNameRaw,source.componentModel);assert.deepEqual(metadata,entry.requiredEquipment);
  assert.equal(metadata.fluidRequired,true);assert.deepEqual(metadata.issues,[]);assert.equal(metadata.systemCode,source.systemCode);
  // Unknown extra source fields may not silently become equipment confirmations.
  if(source.driveType)reasons.push('SOURCE_DRIVE_FIELD_NEEDS_RECONCILIATION');
  if(source.transmissionType&&source.transmissionType!==metadata.attachedTransmissionType)reasons.push('SOURCE_TRANSMISSION_FIELD_NEEDS_RECONCILIATION');
  assert.notEqual(source.rawRequirementJson?.sourceIdentity?.reviewRequired,true);
  const target=variants.get(entry.vehicleVariantKey);assert.ok(target?.length);
  const windows=target.map(r=>applicabilityWindow(source,r)),window=windows[0];
  assert.ok(window&&windows.every(w=>sha(w)===sha(window)));assert.deepEqual(window,entry.window);
  const normalized=normalize(source);assert.ok(normalized);
  if(!cache.has(normalized.canonicalMake)){const forms=new Set(mannMakeFormsForTest(normalized.canonicalMake));cache.set(normalized.canonicalMake,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
  const full=match({...source,...window.narrowedYears},cache.get(normalized.canonicalMake)),candidate=full.topCandidates[0];
  assert.ok(candidate&&candidate.rank===1&&candidate.variantIds.length===1&&candidate.variantIds[0]===entry.vehicleVariantKey&&candidate.score>=80);
  assert.ok(candidate.matchedFields.includes('точный код двигателя'));assert.deepEqual(candidate.hardConflicts,[]);
  const blocker=source.systemCode==='POWER_STEERING'?'MANN variant не подтверждает наличие этой гидравлической системы':'MANN variant не подтверждает привод или модель агрегата';
  assert.ok(candidate.reviewBlockers.every(b=>b===blocker));
  if(full.topCandidates.slice(1).some(c=>!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=candidate.score-10))reasons.push('NEARBY_EXACT_ENGINE_ALTERNATIVE');
  const engines=normalized.sourceExactEngineCodes.filter(code=>target.every(row=>String(row.engineCode??'').split(/[;,/|]+/).map(normalizeEngineCode).includes(code)));
  if(!engines.length)reasons.push('NO_EXACT_TARGET_ENGINE_SCOPE');
  const old=live.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===entry.vehicleVariantKey);
  if(old.some(r=>r.reviewConfirmed||r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'))reasons.push('PROTECTED_REVISION');
  const capacity=parseFluidCapacities(source.fillVolumeText,source.systemCode);assert.equal(capacity.needsReview,false);
  const originalFingerprint=originalAssociationFingerprint(entry.vehicleVariantKey,overlay.originalById.get(source.id),capacity);
  if(denied.has(originalFingerprint))reasons.push('PREVIOUSLY_REJECTED_ASSOCIATION');
  const requiredEquipment={systemCode:source.systemCode,circuit:metadata.circuit,...(metadata.requiredDrive?{drive:metadata.requiredDrive}:{}),
    ...(metadata.attachedTransmissionType?{attachedTransmissionType:metadata.attachedTransmissionType}:{})};
  assert.ok(readMannEquipmentScope(requiredEquipment));
  if(reasons.length){decisions.push({requirementId:source.id,disposition:'REVIEW',reasons});continue;}
  const applicabilityJson={sourceVehicleScope:entry.sourceVehicleScope,matchedEngineScope:engines,window,requiredEquipment};
  assert.deepEqual(entry.sourceVehicleScope,{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})});
  const technicalDataJson={fillVolumeText:source.fillVolumeText,capacities:capacity.capacities,specificationText:source.specificationText,
    specifications:source.specificationsJson,viscosityGrades:source.viscosityGradesJson,...Object.fromEntries(['recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'].map(k=>[k,source[k]]))};
  const semanticFingerprint=sha({policy,sourceRequirementId:source.id,vehicleVariantKey:entry.vehicleVariantKey,applicabilityJson,technicalDataJson});
  const revision={id:`mtar_${semanticFingerprint.slice(0,24)}`,semanticFingerprint,sourceRequirementId:source.id,vehicleVariantKey:entry.vehicleVariantKey,
    systemCode:source.systemCode,componentModel:source.componentModel,applicabilityJson,technicalDataJson,state:'REVIEW',verificationStatus:'UNVERIFIED',
    matchClass:'CONDITIONAL_EQUIPMENT',matchScore:candidate.score,applyEligible:false,verifiedFieldsJson:[],replacesRevisionIds:old.map(r=>r.id),
    fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),
    evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:source.sourceUrl}],
    provenanceJson:{conditionalEquipmentPolicy:policy,conditionalEquipmentEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:originalFingerprint,
      sourceRecheckHash:sha(raw),identityCorrectionHash:overlay.metadata.sha256,sourceAggregateContext:metadata,
      independentValidation:{vehicleIdentityIndependentlyValidated:true,hardConflicts:[],reviewBlockers:candidate.reviewBlockers,score:candidate.score,matchedFields:candidate.matchedFields}}};
  revisions.push(revision);decisions.push({requirementId:source.id,disposition:'CONDITIONAL_EQUIPMENT_DRAFT',successorId:revision.id});
  if(revisions.length%50===0)console.log(JSON.stringify({drafts:revisions.length}));
}
assert.equal(decisions.length,report.checked);assert.equal(new Set(revisions.map(r=>r.id)).size,revisions.length);
const plan={kind:'CONDITIONAL_EQUIPMENT_DRAFT_PLAN',policy,productionApplyAllowed:false,inputHashes:{recheck:sha(raw),source:sha(sourceRaw),mann:sha(mannRaw),live:sha(liveRaw)},
  identityCorrections:overlay.metadata,summary:{checked:decisions.length,candidates:revisions.length,review:decisions.length-revisions.length,
    systems:Object.fromEntries([...Map.groupBy(revisions,r=>r.systemCode)].map(([k,v])=>[k,v.length]))},
  limitation:'Offline drafts; runtime publication policy, API/UI confirmations, combined audit and production checks still required.',revisions,decisions};
await writeFile(resolve(dir,'conditional-equipment-plan-v1.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(plan.summary,null,2));
