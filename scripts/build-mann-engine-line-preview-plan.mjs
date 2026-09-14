import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const [raw,sourceRaw,mannRaw,metadataRaw,liveRaw]=await Promise.all([
  readFile(resolve(dir,'engine-candidate-source-date-scopes-v2.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'source-system-context-v3.json'),'utf8'),
  readFile(resolve(root,'outputs/mann-live-audit-1789334190861/revisions.json'),'utf8')]);
const candidates=JSON.parse(raw),metadata=JSON.parse(metadataRaw),live=JSON.parse(liveRaw);
assert.equal(candidates.sourceHash,sha(sourceRaw));assert.equal(metadata.sourceHash,sha(sourceRaw));
assert.equal(candidates.helperHash,sha(await readFile(resolve(root,'src/lib/fluid-source-date-condition.ts'),'utf8')));
const replayRaw=await readFile(resolve(dir,'engine-line-candidate-scope-replay-v1.json'),'utf8');assert.equal(candidates.replayHash,sha(replayRaw));
const replay=JSON.parse(replayRaw),runRaw=await readFile(resolve(dir,'engine-line-recheck-v1.json'),'utf8');assert.equal(replay.runHash,sha(runRaw));
const run=JSON.parse(runRaw);assert.equal(run.mannHash,sha(mannRaw));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const targets=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const labels=new Map(metadata.findings.map(r=>[r.requirementId,r]));
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1',revisions=[],review=[],dedup=new Map();let replayCases=0;
for(const c of candidates.results){
  const source=sources.get(c.requirementId);assert.ok(source);assert.equal(sha(source),c.sourceHash);
  const label=labels.get(source.id);assert.ok(label);assert.equal(label.sourceHash,c.sourceHash);
  const reasons=[];
  if(!c.applicability)reasons.push('NO_COMPLETE_MONTH');
  if(label.extracted.issues.length||(label.extracted.hasAdditionalLabelConditions&&!c.sourceDateCondition))reasons.push('SOURCE_LABEL_CONDITION_UNRESOLVED');
  const target=targets.get(c.vehicleVariantKey);assert.ok(target?.length);
  // Do not lose a power restriction when the target key has no unambiguous power.
  for(const [field,column] of [['powerHp','hp'],['powerKw','kw']])if(c.sourceEngineScope[field]!=null&&target.some(row=>String(row[column]??'').trim()!==String(c.sourceEngineScope[field])))reasons.push(`TARGET_${column.toUpperCase()}_NOT_EXACT_SINGLE_VALUE`);
  const capacity=parse(source.fillVolumeText,source.systemCode);if(capacity.needsReview)reasons.push('CAPACITY_REVIEW');
  assert.equal(originalAssociationFingerprint(c.vehicleVariantKey,source,capacity),c.sourceAssociationFingerprint);
  if(denied.has(c.sourceAssociationFingerprint))reasons.push('DENIED_ASSOCIATION');
  const old=live.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===c.vehicleVariantKey);
  if(old.some(r=>r.reviewConfirmed||r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'))reasons.push('PROTECTED_EXISTING_REVISION');
  if(reasons.length){review.push({...c,reasons});continue;}
  const technicalData={fillVolumeText:source.fillVolumeText,capacities:capacity.capacities,specificationText:source.specificationText,
    specifications:source.specificationsJson,viscosityGrades:source.viscosityGradesJson,recommendationText:source.recommendationText,
    replacementIntervalText:source.replacementIntervalText,replacementKmMin:source.replacementKmMin,replacementKmMax:source.replacementKmMax,
    replacementMonths:source.replacementMonths,controlIntervalText:source.controlIntervalText,analogText:source.analogText};
  const fingerprint=sha({policy,sourceRequirementId:source.id,vehicleVariantKey:c.vehicleVariantKey,applicability:c.applicability,sourceEngineScope:c.sourceEngineScope,technicalData});
  if(dedup.has(fingerprint)){dedup.get(fingerprint).provenanceJson.engineAnchorRowIds.push(c.engineAnchorRowId);continue;}
  const revision={id:`mtar_${fingerprint.slice(0,24)}`,sourceRequirementId:source.id,vehicleVariantKey:c.vehicleVariantKey,systemCode:source.systemCode,
    componentModel:source.componentModel,applicabilityJson:c.applicability,technicalDataJson:technicalData,verifiedFieldsJson:[],
    fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.specifications':'SECONDARY_SOURCE_PARSED_MEDIUM',
      'technical.viscosityGrades':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.recommendation':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.replacementInterval':'SECONDARY_SOURCE_PARSED_MEDIUM'},
    evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:source.sourceUrl}],
    provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:c.sourceAssociationFingerprint,
      independentValidation:c.validation,sourceEngineScope:c.sourceEngineScope,engineAnchorRowIds:[c.engineAnchorRowId],sourceCandidateHash:sha(c)},
    matchClass:'CONFIRMED_SINGLE',matchScore:c.validation.score,semanticFingerprint:fingerprint,state:'STAGED',verificationStatus:'UNVERIFIED',applyEligible:false,
    replacesRevisionIds:old.map(r=>r.id)};
  // Match class comes from the original full-make decision, never fabricated.
  const branch=run.results.find(r=>r.requirementId===source.id&&r.engineCode===c.engineCode&&r.engineAnchorRowId===c.engineAnchorRowId);
  const outcome=branch?.outcomes.find(o=>o.vehicleVariantKey===c.vehicleVariantKey&&o.status==='ENGINE_CONTEXT_MATCH_CANDIDATE');assert.ok(outcome);
  revision.matchClass=outcome.matchStatus;assert.ok(['CONFIRMED_SINGLE','CONFIRMED_MULTI_APPLICABILITY'].includes(revision.matchClass));
  const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:policy,automaticProductSelection:false}}};
  for(const productionMonth of new Set(Object.values(c.applicability.window.intersection).filter(Boolean))){
    const context={...c.applicability.sourceVehicleScope,engineCode:c.engineCode,productionMonth};
    assert.equal(profile([runtime],undefined,context).items.length,1);replayCases++;
    assert.equal(profile([runtime],undefined,{...context,engineCode:'WRONG'}).items.length,0);replayCases++;
  }
  dedup.set(fingerprint,revision);revisions.push(revision);
}
const report={kind:'ENGINE_LINE_PREVIEW_PLAN',policy,productionApplyAllowed:false,inputs:{candidates:sha(raw),source:sha(sourceRaw),mann:sha(mannRaw),live:sha(liveRaw),labels:sha(metadataRaw)},
  summary:{inputContexts:candidates.results.length,revisions:revisions.length,sourceRequirements:new Set(revisions.map(r=>r.sourceRequirementId)).size,
    reviewContexts:review.length,exactDuplicates:candidates.results.length-review.length-revisions.length,individualReplayCases:replayCases,
    reasons:Object.fromEntries([...Map.groupBy(review.flatMap(r=>r.reasons),r=>r)].map(([k,v])=>[k,v.length]))},
  limitation:'Local individual preview only; joint composition, independent verification and production integration required. Review queue and boundary months remain in scope.',revisions,review};
await writeFile(resolve(dir,'engine-line-preview-plan-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
