#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
assert.ok([2,4].includes(process.argv.length) && !process.argv.slice(2).some(a=>a.startsWith('--')), 'Usage: offline planner [source-directory new-plan-directory]; no apply flags');
const root=resolve(import.meta.dirname,'..');
const base=resolve(root,process.argv[2]??'outputs/mann-engine-date-scoped-2026-09-13');
const live=resolve(root,'outputs/mann-live-audit-1789334190861');
const [proposalRaw,revisionRaw,sourceRaw,decisionRaw,verificationRaw,replayRaw,liveReportRaw]=await Promise.all([
  readFile(resolve(base,'scoped-proposals.ndjson'),'utf8'),readFile(resolve(live,'revisions.json'),'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile(resolve(base,'decisions.ndjson'),'utf8'),
  readFile(resolve(base,'verification.json'),'utf8'),readFile(resolve(base,'target-replay.json'),'utf8'),readFile(resolve(live,'report.json'),'utf8')]);
const verification=JSON.parse(verificationRaw),replay=JSON.parse(replayRaw),liveReport=JSON.parse(liveReportRaw);
assert.equal(verification.issueCount,0);assert.equal(replay.issueCount,0);assert.equal(replay.partial,false);
assert.equal(replay.inputHashes['decisions.ndjson'],sha(decisionRaw));assert.equal(replay.sourceHashes.fluids,sha(sourceRaw));
for(const report of Object.values(liveReport.sourceTables))assert.equal(report.changed.length+report.added.length+report.missing.length,0);
const proposals=proposalRaw.trim().split('\n').map(JSON.parse),existing=JSON.parse(revisionRaw);
const summary=JSON.parse(await readFile(resolve(base,'summary.json'),'utf8'));
const overlay=await loadIdentityOverlay(root,sourceRaw,summary.identityCorrections?.path,summary.identityCorrections?.sha256);
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const decisions=new Map(decisionRaw.trim().split('\n').map(JSON.parse).map(d=>[d.requirementId,d]));
const key=r=>`${r.sourceRequirementId??r.requirementId}:${r.vehicleVariantKey}`;
const byKey=Map.groupBy(existing,key),byProposal=new Map();
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeFluidRequirementVehicle}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const newRevisions=[],protectedCollisions=[];
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1';
for(const p of proposals){
  assert.equal(p.publicationAllowed,false);assert.ok(!byProposal.has(key(p)));
  const r=sources.get(p.requirementId),d=decisions.get(p.requirementId);assert.ok(r&&d);
  assert.ok(d.proposals.some(candidate=>sha(candidate)===sha(p)),'canonical proposal mismatch');
  assert.equal(d.capacity.needsReview,false);
  const old=byKey.get(key(p))??[];
  if(old.some(r=>r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'||r.reviewConfirmed)){
    protectedCollisions.push({requirementId:r.id,vehicleVariantKey:p.vehicleVariantKey,revisionIds:old.map(r=>r.id)});continue;
  }
  const engines=p.matchedEngineScope??normalizeFluidRequirementVehicle(r)?.sourceExactEngineCodes??[];
  assert.notEqual(r.rawRequirementJson?.sourceIdentity?.reviewRequired,true);
  const applicability={...p.originalApplicability,matchedEngineScope:engines.length?engines:null,window:p.window,
    sourceVehicleScope:{make:r.make,model:r.model,...(r.generation?{generation:r.generation}:{})}};
  const technicalData={fillVolumeText:r.fillVolumeText,capacities:d.capacity.capacities,
    specificationText:r.specificationText,specifications:r.specificationsJson,viscosityGrades:r.viscosityGradesJson,
    recommendationText:r.recommendationText,replacementIntervalText:r.replacementIntervalText,
    replacementKmMin:r.replacementKmMin,replacementKmMax:r.replacementKmMax,replacementMonths:r.replacementMonths,
    controlIntervalText:r.controlIntervalText,analogText:r.analogText};
  const fingerprint=sha({policy,sourceRequirementId:r.id,vehicleVariantKey:p.vehicleVariantKey,applicability,technicalData});
  const revision={id:`mtar_${fingerprint.slice(0,24)}`,sourceRequirementId:r.id,vehicleVariantKey:p.vehicleVariantKey,
    systemCode:r.systemCode,componentModel:r.componentModel,applicabilityJson:applicability,technicalDataJson:technicalData,
    verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':`SECONDARY_SOURCE_PARSED_${d.capacity.capacities.every(c=>c.confidence==='HIGH')?'HIGH':'MEDIUM'}`,
      'technical.specifications':`SECONDARY_SOURCE_PARSED_${d.match.fieldConfidence.specification.level}`,'technical.viscosityGrades':'SECONDARY_SOURCE_PARSED_HIGH',
      'technical.recommendation':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.replacementInterval':'SECONDARY_SOURCE_PARSED_MEDIUM'},
    evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:r.sourceUrl}],
    provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceAssociationFingerprint:p.originalAssociationFingerprint,
      sourceProposalHash:sha(p),independentValidation:p.validation.target,sourceTechnicalReviewRequired:true,
      sourceIdentityCorrection:p.sourceIdentityCorrection??null},
    matchClass:p.validation.matchStatus,matchScore:p.validation.target.score,semanticFingerprint:fingerprint,
    state:'STAGED',verificationStatus:'UNVERIFIED',applyEligible:false,
    replacesRevisionIds:old.map(r=>r.id)};
  byProposal.set(key(p),revision);newRevisions.push(revision);
}
const actions=existing.map(r=>({revisionId:r.id,expectedSemanticFingerprint:r.semanticFingerprint,
  expectedState:r.state,action:r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'||r.reviewConfirmed?'PRESERVE_PROTECTED'
    :byProposal.has(key(r))?'REPLACE_WITH_SCOPED_PREVIEW':r.matchClass==='CONDITIONAL_TRANSMISSION'?'RECHECK_CONDITIONAL':'REVIEW_UNREPLACED',
  successorId:byProposal.get(key(r))?.id??null}));
assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
assert.equal(actions.length,existing.length);assert.equal(new Set(actions.map(a=>a.revisionId)).size,existing.length);
for(const r of newRevisions)assert.equal(r.applyEligible,false);
const counts={};for(const a of actions)counts[a.action]=(counts[a.action]??0)+1;
const report={kind:'MANN_SCOPED_MERGE_PLAN',productionApplyAllowed:false,writeMode:'DRY_RUN_ONLY',policy,
  inputs:{proposals:sha(proposalRaw),liveRevisions:sha(revisionRaw),source:sha(sourceRaw),decisions:sha(decisionRaw),identityCorrections:overlay.metadata},
  summary:{existingRevisions:existing.length,candidateRevisions:newRevisions.length,newWithoutPredecessor:newRevisions.filter(r=>!r.replacesRevisionIds.length).length,actions:counts,protectedCollisions:protectedCollisions.length},
  requiredGates:['Fresh verified backup and live fingerprint/review-decision recheck','New policy supported by runtime and tested through UI','Engine/month scope preserved in canonical vehicles and API','Conditional transmissions rechecked separately','Idempotent transactional SQL and rollback verified','No primary-source or manual review overwrite'],
  newRevisions,existingActions:actions,protectedCollisions};
const output=resolve(root,process.argv[3]??'outputs/mann-scoped-merge-plan-2026-09-13-v2');await mkdir(output);
await writeFile(resolve(output,'plan.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,...report.summary,productionApplyAllowed:false},null,2));
