import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const preRaw=await readFile(resolve(dir,'recovered-volvo-fluid-preflight-v1.json'),'utf8'),pre=JSON.parse(preRaw),planRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8'),plan=JSON.parse(planRaw);assert.equal(sha(planRaw),pre.planHash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),plan.inputHashes.source);const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8');assert.equal(sha(liveRaw),pre.liveHash);const live=JSON.parse(liveRaw);
const summaryRaw=await readFile(resolve(dir,'date-backlog-rematch-summary-v1.json'),'utf8');assert.equal(sha(summaryRaw),pre.rematchSummaryHash);const inputHash=JSON.parse(summaryRaw).inputHash,matches=[];
for(const name of (await readdir(dir)).filter(n=>/^date-rematch-.*-v1.json$/.test(n))){const batch=JSON.parse(await readFile(resolve(dir,name),'utf8'));assert.equal(batch.inputHash,inputHash);matches.push(...batch.findings);}
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseSpecifications}=await j.import('../src/lib/fluid-catalog.ts'),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}});
const drafts=[],policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1';let checks=0;
for(const f of pre.findings.filter(f=>f.status==='READY_FOR_SCOPED_DRAFT')){
 assert.deepEqual(f.reasons,[]);const s=sources.get(f.sourceRequirementId);assert.equal(sha(s),f.sourceHash);assert.equal(plan.newRevisions.some(r=>r.sourceRequirementId===s.id),false);
 const match=matches.find(m=>m.sourceRequirementId===s.id&&m.vehicleVariantKey===f.vehicleVariantKey);assert.ok(match.targetValidated);
 const technical={fillVolumeText:s.fillVolumeText,capacities:f.parsedCapacity.capacities,specificationText:s.specificationText,specifications:s.specificationsJson,viscosityGrades:s.viscosityGradesJson,recommendationText:s.recommendationText,replacementIntervalText:s.replacementIntervalText,replacementKmMin:s.replacementKmMin,replacementKmMax:s.replacementKmMax,replacementMonths:s.replacementMonths,controlIntervalText:s.controlIntervalText,analogText:s.analogText};
 if(f.sections.status==='EXPLICIT_ANALOG_SEPARATED'){
  const main=f.sections.main.text.trim(),grades=[...new Set([...main.matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map(m=>m[0].toUpperCase()))];
  technical.specificationText=main;technical.specifications=[{type:'SOURCE_REQUIREMENT_TEXT',value:main},...parseSpecifications(main,grades).filter(x=>x.type!=='RAW')];technical.viscosityGrades=grades;
  technical.sourceSpecificationAttribution={policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:s.specificationText,mainSourceText:main,unverifiedAnalogText:f.sections.analog.text.trim(),metadataAndCautionText:f.sections.suffix.text.trim(),originalSourceHash:sha(s),sourceRequirementId:s.id,oemVerified:false,automaticAnalogSelectionAllowed:false};
 }
 const fingerprint=sha({policy,sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,applicability:f.scope,technical});
 const r={id:`mtar_${fingerprint.slice(0,24)}`,sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson:f.scope,technicalDataJson:technical,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':f.asNeeded?'NONE':'SECONDARY_SOURCE_PARSED_HIGH','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH','technical.viscosityGrades':'SECONDARY_SOURCE_PARSED_HIGH'},evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:s.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:f.originalAssociationFingerprint,sourceRequirementHash:sha(s),literalEngineBranch:f.branch,preflightHash:sha(preRaw),independentValidation:f.target},state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:match.decision.status,matchScore:f.target.score,semanticFingerprint:fingerprint,applyEligible:false,replacesRevisionIds:[]};
 const existing=[...plan.newRevisions.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey).map(fixture),...live.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey&&['ACTIVE','STAGED','REVIEW'].includes(x.state)).map(x=>({...x,createdAt:new Date(x.createdAt)}))];
 const month=x=>Number(x.slice(0,4))*12+Number(x.slice(5))-1,from=month(f.scope.window.intersection.from),to=month(f.scope.window.intersection.to);
 for(let m=from-1;m<=to+1;m++)for(const engineCode of [f.scope.matchedEngineScope[0],'WRONG',undefined])for(const confirmedMarket of [f.scope.requiredMarket,'UNKNOWN',undefined]){
  const context={...f.scope.sourceVehicleScope,engineCode,confirmedMarket,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`},expected=m>=from&&m<=to&&engineCode===f.scope.matchedEngineScope[0]&&(!f.scope.requiredMarket||confirmedMarket===f.scope.requiredMarket);
  const isolated=profile([fixture(r)],undefined,context),before=profile(existing,undefined,context),after=profile([...existing,fixture(r)],undefined,context);assert.equal(isolated.items.length,expected?1:0);
  if(expected){const item=after.items.find(i=>i.revisionId===r.id);assert.ok(item);assert.deepEqual(item.capacities,isolated.items[0].capacities);assert.deepEqual(item.specifications,isolated.items[0].specifications);
   for(const same of after.items.filter(i=>i.systemCode===r.systemCode))assert.deepEqual({capacities:same.capacities,specifications:same.specifications},{capacities:item.capacities,specifications:item.specifications});}
  for(const old of before.items){const source=existing.find(x=>x.id===old.revisionId);if(expected&&source.sourceRequirementId===s.id&&!source.reviewConfirmed&&!source.applyEligible&&source.verificationStatus==='UNVERIFIED')continue;assert.ok(after.items.some(i=>sha(i)===sha(old)));}
  assert.ok(after.items.every(i=>!i.automaticSelectionEligible));checks++;
 }
 drafts.push(r);
}
assert.equal(drafts.length,1);
await writeFile(resolve(dir,'recovered-volvo-fluid-drafts-v1.json'),JSON.stringify({kind:'RECOVERED_VOLVO_FLUID_DRAFTS',planHash:sha(planRaw),preflightHash:sha(preRaw),liveHash:sha(liveRaw),summary:{drafts:drafts.length,checks},newRevisions:drafts,productionApplyAllowed:false,limitations:['Standalone candidates; not merged, deployed or OEM verified.','Joint archived legacy/current draft proof covers scope months/engine/market, not real VINs.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({drafts:drafts.length,checks}));
