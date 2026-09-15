import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const expanded=process.argv[2]==='--remaining-v2';
const rematchRaw=await readFile(resolve(dir,'unplanned-literal-branch-rematch-v1.json'),'utf8'),rematch=JSON.parse(rematchRaw),pre=JSON.parse(await readFile(resolve(dir,'unplanned-matches-preflight-v2.json'),'utf8'));
const planRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8'),plan=JSON.parse(planRaw);assert.equal(expanded?plan.unplannedScopedHistory.parentPlanHash:sha(planRaw),pre.planHash);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),plan.inputHashes.source);
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const {parseSpecifications}=await j.import('../src/lib/fluid-catalog.ts');
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1',drafts=[];
const marketMode=process.argv[2]==='--reconciled-markets'||expanded;
assert.ok(process.argv.length===2||(process.argv.length===3&&marketMode));
const reconciliation=marketMode?JSON.parse(await readFile(resolve(dir,expanded?'unplanned-market-predecessor-reconciliation-v2.json':'unplanned-market-predecessor-reconciliation-v1.json'),'utf8')):null;
const liveRaw=marketMode?await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8'):null;
const live=liveRaw?JSON.parse(liveRaw):[];
if(marketMode){assert.equal(reconciliation.planHash,sha(planRaw));assert.equal(reconciliation.rematchHash,sha(rematchRaw));assert.equal(reconciliation.liveHash,sha(liveRaw));}
const fixture=r=>({...r,createdAt:new Date('2026-09-15T00:00:00Z'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}});
let checks=0;
for(const f of rematch.findings.filter(f=>marketMode?reconciliation.findings.some(r=>r.sourceRequirementId===f.sourceRequirementId&&r.vehicleVariantKey===f.vehicleVariantKey&&r.status==='SCOPED_DRAFT_READY'):!f.reasons.length)){
 assert.ok(f.targetValidated);const s=sources.get(f.sourceRequirementId);assert.equal(sha(s),f.originalSourceHash);
 assert.equal(plan.newRevisions.some(r=>r.sourceRequirementId===s.id),false);
 const audit=pre.findings.find(p=>p.sourceRequirementId===s.id),pair=audit.pairs.find(p=>p.vehicleVariantKey===f.vehicleVariantKey);if(!marketMode)assert.equal(pair.reasons.length,0);
 const review=reconciliation?.findings.find(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===f.vehicleVariantKey);
 assert.ok(audit.sections.status==='NO_EXPLICIT_MARKER'||expanded&&audit.sections.status==='EXPLICIT_ANALOG_SEPARATED');
 if(review?.evidence.capacityPolicy==='EXPLICIT_AS_NEEDED_NO_NUMERIC_VOLUME')assert.deepEqual(audit.parsedCapacity.capacities,[]);else assert.equal(audit.parsedCapacity.needsReview,false);
 const v=f.decision.normalizedVehicle;
 const applicability={...f.proposedScope,sourceVehicleScope:{make:v.canonicalMake,model:v.baseModel,...(v.generation?{generation:v.generation}:{})}};
 const technical={fillVolumeText:s.fillVolumeText,capacities:audit.parsedCapacity.capacities,specificationText:s.specificationText,specifications:s.specificationsJson,viscosityGrades:s.viscosityGradesJson,recommendationText:s.recommendationText,replacementIntervalText:s.replacementIntervalText,replacementKmMin:s.replacementKmMin,replacementKmMax:s.replacementKmMax,replacementMonths:s.replacementMonths,controlIntervalText:s.controlIntervalText,analogText:s.analogText};
 if(expanded&&audit.sections.status==='EXPLICIT_ANALOG_SEPARATED'){
  const main=audit.sections.main.text.trim();assert.ok(main);
  const grades=[...new Set([...main.matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map(m=>m[0].toUpperCase()))];
  technical.specificationText=main;
  technical.specifications=[{type:'SOURCE_REQUIREMENT_TEXT',value:main},...parseSpecifications(main,grades).filter(s=>s.type!=='RAW')];
  technical.viscosityGrades=grades;
  technical.sourceSpecificationAttribution={policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:s.specificationText,mainSourceText:main,unverifiedAnalogText:audit.sections.analog.text.trim(),metadataAndCautionText:audit.sections.suffix.text.trim(),originalSourceHash:sha(s),sourceRequirementId:s.id,oemVerified:false,automaticAnalogSelectionAllowed:false};
 }
 const fingerprint=sha({policy,sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,applicability,technical});
 const revision={id:`mtar_${fingerprint.slice(0,24)}`,sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson:applicability,technicalDataJson:technical,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_HIGH','technical.specifications':`SECONDARY_SOURCE_PARSED_${f.decision.fieldConfidence.specification.level}`,'technical.viscosityGrades':'SECONDARY_SOURCE_PARSED_HIGH','technical.replacementInterval':'SECONDARY_SOURCE_PARSED_MEDIUM'},evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:s.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:f.originalAssociationFingerprint,sourceRowId:s.sourceRowId,sourceRequirementHash:sha(s),literalEngineBranch:f.branch,rematchHash:sha(rematchRaw),independentValidation:f.decision.targets.find(t=>t.vehicleVariantKey===f.vehicleVariantKey&&t.independentlyValidated)},matchClass:f.decision.status,matchScore:f.decision.targets.find(t=>t.vehicleVariantKey===f.vehicleVariantKey).score,semanticFingerprint:fingerprint,state:'STAGED',verificationStatus:'UNVERIFIED',applyEligible:false,replacesRevisionIds:[]};
 if(review?.evidence.capacityPolicy==='EXPLICIT_AS_NEEDED_NO_NUMERIC_VOLUME')revision.fieldConfidenceJson['technical.capacity']='NONE';
 const start=applicability.window.intersection.from,end=applicability.window.intersection.to,month=x=>Number(x.slice(0,4))*12+Number(x.slice(5))-1;
 for(let m=month(start)-1;m<=month(end)+1;m++)for(const engineCode of [applicability.matchedEngineScope[0],'WRONG',undefined])for(const confirmedMarket of applicability.requiredMarket?[applicability.requiredMarket,'UNKNOWN',undefined]:[undefined]){
  const context={...applicability.sourceVehicleScope,engineCode,confirmedMarket,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
  const expected=m>=month(start)&&m<=month(end)&&engineCode===applicability.matchedEngineScope[0]&&(!applicability.requiredMarket||confirmedMarket===applicability.requiredMarket);
  const isolated=profile([fixture(revision)],undefined,context);assert.equal(isolated.items.length,expected?1:0);
  const existing=[...plan.newRevisions.filter(r=>r.vehicleVariantKey===revision.vehicleVariantKey).map(fixture),...live.filter(r=>r.vehicleVariantKey===revision.vehicleVariantKey&&['ACTIVE','STAGED','REVIEW'].includes(r.state)).map(r=>({...r,createdAt:new Date(r.createdAt)}))];
  const before=profile(existing,undefined,context),after=profile([...existing,fixture(revision)],undefined,context);
  for(const item of before.items){
   const predecessor=existing.find(r=>r.id===item.revisionId);
   const scopedReplacement=marketMode&&expected&&predecessor?.sourceRequirementId===s.id&&!predecessor.reviewConfirmed&&!predecessor.applyEligible&&predecessor.verificationStatus==='UNVERIFIED';
   if(!scopedReplacement)assert.ok(after.items.some(next=>sha({...next,revisionId:null})===sha({...item,revisionId:null})));
  }
  for(const item of after.items)assert.equal(item.automaticSelectionEligible,false);
  for(const same of after.items.filter(i=>i.systemCode===revision.systemCode))if(expected)assert.deepEqual({capacities:same.capacities,specifications:same.specifications},{capacities:isolated.items[0].capacities,specifications:isolated.items[0].specifications});
  checks++;
 }
 drafts.push(revision);
}
assert.equal(drafts.length,marketMode?reconciliation.summary.ready:1);
await writeFile(resolve(dir,expanded?'remaining-unplanned-drafts-v3.json':marketMode?'market-reconciled-unplanned-drafts-v1.json':'clear-unplanned-drafts-v1.json'),JSON.stringify({kind:'CLEAR_UNPLANNED_SCOPED_DRAFTS',planHash:sha(planRaw),rematchHash:sha(rematchRaw),reconciliationHash:reconciliation?sha(reconciliation):null,legacySnapshotHash:liveRaw?sha(liveRaw):null,summary:{drafts:drafts.length,profileChecks:checks},newRevisions:drafts,productionApplyAllowed:false,limitations:['Standalone candidate draft, not merged or deployed.','Secondary source values are not OEM verification; no automatic product selection.',marketMode?'Joint check includes archived legacy rows and current drafts; not real VINs, all equipment choices or publication.':'Joint check covers existing canonical drafts, not all live legacy rows or all equipment choices.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({drafts:drafts.length,profileChecks:checks}));
