import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {splitSpecificationSections,specificationCautionSignals} from './lib/mann-specification-sections-v2.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const version=process.argv[2]??'v1';assert.ok(['v1','v2'].includes(version));
const triageRaw=await readFile(resolve(dir,'mercedes-gained-target-triage-v1.json'),'utf8'),triage=JSON.parse(triageRaw),planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);assert.equal(sha(planRaw),triage.planHash);
const replayRaw=await readFile(resolve(dir,'mercedes-import-matcher-replay-v1.json'),'utf8');assert.equal(sha(replayRaw),triage.replayHash);const replay=new Map(JSON.parse(replayRaw).findings.map(f=>[f.sourceRequirementId,f]));
let branchReport=null,branchHash=null;
if(version==='v2'){
 const branchRaw=await readFile(resolve(dir,'mercedes-power-branch-recheck-v1.json'),'utf8');branchHash=sha(branchRaw);branchReport=JSON.parse(branchRaw);
 assert.equal(branchReport.planHash,sha(planRaw));assert.equal(branchReport.triageHash,sha(triageRaw));
 assert.equal(branchReport.priorDraftHash,sha(await readFile(resolve(dir,'mercedes-gained-preview-drafts-v1.json'),'utf8')));
 assert.equal(branchReport.helperHash,sha(await readFile(resolve(root,'scripts/lib/mann-mercedes-power-branches.mjs'),'utf8')));
}
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),triage.sourceHash);
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34'),sources=new Map(overlay.requirements.map(s=>[s.id,s]));
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),triage.mannHash);const mann=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
const denyRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8');assert.equal(sha(denyRaw),triage.denylistHash);const denied=new Set(JSON.parse(denyRaw).rejectedAssociationFingerprints);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseSpecifications}=await j.import('../src/lib/fluid-catalog.ts'),{parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts'),{extractFluidSourceSystemContext:label}=await j.import('../src/lib/fluid-source-system-context.ts'),{normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts'),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const revisions=[],review=[],pending=[];let checks=0;
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1',month=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
for(const initial of triage.findings.filter(f=>!f.existingRevisionIds.length)){
 const branchFinding=branchReport?.findings.find(b=>b.sourceRequirementId===initial.sourceRequirementId&&b.vehicleVariantKey===initial.vehicleVariantKey);
 const supported=branchFinding?.branches.filter(b=>b.status==='EXPLICIT_BRANCH_MATCH_CONFIRMED')??[];assert.ok(supported.length<=1);
 const branch=supported[0],f=branch?{...initial,window:branch.window}:initial;
 const source=sources.get(f.sourceRequirementId),original=overlay.originalById.get(source.id);assert.equal(sha(original),f.sourceHash);
 const decision=branch?.decision??replay.get(source.id).newDecision;
 const target=decision.targets.find(t=>t.vehicleVariantKey===f.vehicleVariantKey);assert.equal(target.independentlyValidated,true);
 const reasons=f.reasons.filter(reason=>!branch||reason!=='ENGINE_ANCHOR_POWER_REVIEW'),rows=mann.get(f.vehicleVariantKey),system=label(source.systemNameRaw,source.componentModel),capacity=parse(original.fillVolumeText,original.systemCode),sections=splitSpecificationSections(original.specificationText,original.analogText),cautions=specificationCautionSignals(original.specificationText);
 if(!['ENGINE_OIL','ENGINE_COOLANT','BRAKE_FLUID','ADBLUE'].includes(source.systemCode))reasons.push('COMPONENT_SCOPE_REVIEW_REQUIRED');
 if(system.issues.length||system.hasAdditionalLabelConditions)reasons.push('SOURCE_LABEL_CONDITIONS');
 if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_CONFLICT');
 if(source.driveType||source.transmissionType||source.componentModel)reasons.push('SOURCE_ADDITIONAL_VEHICLE_CONDITION');
 if([...f.matchingAnchors,...f.otherAnchors].some(a=>/Россия|Япония|Европа|США|ОАЭ|Китай|Корея|Азия/iu.test(`${a.row.model} ${a.row.production_years}`)))reasons.push('EXPLICIT_MARKET_REVIEW');
 if(!capacity.capacities.length)reasons.push('MISSING_SOURCE_CAPACITY');
 if(!['NO_EXPLICIT_MARKER','EXPLICIT_ANALOG_SEPARATED'].includes(sections.status)||cautions.length)reasons.push('SPECIFICATION_ROLES_OR_CAUTION_REVIEW');
 if(!String(original.specificationText??'').trim())reasons.push('MISSING_SPECIFICATION');
 const powerHp=branch?.branch.powerHp??source.powerHp;
 if(!rows.every(t=>powerHp!=null&&String(t.hp??'').trim()!==''&&Number(t.hp)===powerHp))reasons.push('TARGET_POWER_NOT_EXACT');
 if(!f.window?.intersection.from||!f.window?.intersection.to)reasons.push('UNBOUNDED_MONTH_WINDOW');
 const old=live.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===f.vehicleVariantKey);
 if(old.some(r=>r.reviewConfirmed||r.applyEligible||r.state==='ACTIVE'||r.verificationStatus!=='UNVERIFIED'))reasons.push('PROTECTED_PREDECESSOR');
 const fingerprint=originalAssociationFingerprint(f.vehicleVariantKey,original,capacity);assert.equal(fingerprint,f.originalAssociationFingerprint);if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
 if(reasons.length){review.push({sourceRequirementId:source.id,vehicleVariantKey:f.vehicleVariantKey,reasons:[...new Set(reasons)],system,sections,cautions});continue;}
 const engines=[...new Set(f.matchingAnchors.flatMap(a=>a.exactCodes).filter(c=>f.targetCodes.includes(norm(c))))];assert.ok(engines.length);
 const applicability={sourceVehicleScope:{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})},matchedEngineScope:engines,window:f.window};
 const technical={fillVolumeText:original.fillVolumeText,capacities:capacity.capacities,specifications:parseSpecifications(original.specificationText,original.viscosityGradesJson??[]),viscosityGrades:original.viscosityGradesJson};
 for(const key of ['specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])technical[key]=original[key];
 const semanticFingerprint=sha({policy,sourceRequirementId:source.id,vehicleVariantKey:f.vehicleVariantKey,applicability,technicalData:technical});
 const revision={id:`mtar_${semanticFingerprint.slice(0,24)}`,semanticFingerprint,sourceRequirementId:source.id,vehicleVariantKey:f.vehicleVariantKey,systemCode:source.systemCode,componentModel:source.componentModel,applicabilityJson:applicability,technicalDataJson:technical,verifiedFieldsJson:[],fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:original.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:fingerprint,independentValidation:target,sourceEngineEvidence:f.matchingAnchors,sourceIdentityOverlayHash:overlay.metadata.sha256,gainedTargetTriageHash:sha(triageRaw),independentOemVerified:false},matchClass:replay.get(source.id).newDecision.status,matchScore:target.score,state:'STAGED',verificationStatus:'UNVERIFIED',applyEligible:false,replacesRevisionIds:old.map(r=>r.id)};
 if(branch){assert.deepEqual(engines,[branch.sourceEngineCode]);revision.provenanceJson.sourcePowerModelDateBranch={reportHash:branchHash,...branch.branch,acceptedWindow:branch.window.intersection};revision.matchClass=decision.status;}
 const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:policy,automaticProductSelection:false}}};
 for(let m=month(f.window.intersection.from)-1;m<=month(f.window.intersection.to)+1;m++)for(const engineCode of [...engines,'WRONG',undefined]){
  const items=profile([runtime],undefined,{...applicability.sourceVehicleScope,engineCode,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`}).items,allowed=engines.includes(engineCode)&&m>=month(f.window.intersection.from)&&m<=month(f.window.intersection.to);
  assert.equal(items.length,allowed?1:0);assert.ok(items.every(i=>!i.automaticSelectionEligible));checks++;
 }
 revisions.push(revision);pending.push({sourceRequirementId:source.id,vehicleVariantKey:f.vehicleVariantKey,acceptedEngineScope:engines,acceptedWindow:f.window.intersection,originalSourceHash:sha(original),reason:'RECONCILE_REMAINING_SOURCE_DATES_ENGINES_AND_PREDECESSORS',publicationAllowed:false});
}
assert.equal(revisions.length+review.length,56);assert.equal(new Set(revisions.map(r=>r.id)).size,revisions.length);
if(version==='v2')assert.equal(revisions.length,26);
const report={kind:'MERCEDES_GAINED_SCOPED_PREVIEW_DRAFTS',planHash:sha(planRaw),triageHash:sha(triageRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),summary:{considered:56,revisions:revisions.length,review:review.length,checks},revisions,review,pending,productionApplyAllowed:false,limitations:['Drafts not merged or deployed; synthetic completed staging run tests only.','Secondary-source technical facts remain unverified; exact remaining source-scope partition and joint profile/predecessor reconciliation required.','Missing capacity retained in review, no guessed volume.']};
await writeFile(resolve(dir,`mercedes-gained-preview-drafts-${version}.json`),JSON.stringify({...report,branchHash},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
