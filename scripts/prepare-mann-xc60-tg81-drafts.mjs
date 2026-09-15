import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const capacityRaw=await readFile(resolve(dir,'xc60-transmission-capacity-branches-v1.json'),'utf8'),capacityReport=JSON.parse(capacityRaw),preRaw=await readFile(resolve(dir,'xc60-source-branch-preflight-v3.json'),'utf8'),pre=JSON.parse(preRaw),planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);
assert.equal(capacityReport.planHash,sha(planRaw));assert.equal(capacityReport.preflightHash,sha(preRaw));assert.equal(pre.planHash,sha(planRaw));
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),pre.sourceHash);const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const denyRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8');assert.equal(sha(denyRaw),pre.denylistHash);const denied=new Set(JSON.parse(denyRaw).rejectedAssociationFingerprints);
const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8');assert.equal(sha(liveRaw),pre.liveHash);const live=JSON.parse(liveRaw);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseSpecifications}=await j.import('../src/lib/fluid-catalog.ts'),{parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts'),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const revisions=[],pending=[];let checks=0;
const policy='USER_CONFIRMED_TRANSMISSION_V1',month=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1,date=m=>`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
for(const evidence of capacityReport.findings.filter(f=>f.status==='EXPLICIT_FUEL_CAPACITY_BRANCH')){
 const source=sources.get(evidence.sourceRequirementId);assert.equal(sha(source),evidence.originalSourceHash);
 const f=pre.findings.find(f=>f.sourceRequirementId===source.id),pair=f.pairs.find(p=>p.targetId===evidence.targetId&&sha(p.branch)===sha(evidence.branch));assert.ok(pair);
 assert.equal(f.componentEngineList.componentText,'МАСЛО в АКПП-8\nМодель: TG-81SC');
 assert.deepEqual(f.system.issues,[]);assert.equal(f.system.hasAdditionalLabelConditions,false);assert.equal(f.system.transmissionGearCount,8);assert.equal(source.driveType,null);
 const candidate=pair.decision.topCandidates[0];assert.deepEqual(candidate.variantIds,[pair.targetId]);assert.ok(candidate.score>=80);assert.deepEqual(candidate.hardConflicts,[]);assert.deepEqual(candidate.reviewBlockers,['MANN variant не подтверждает тип или модель коробки']);
 assert.ok(candidate.matchedFields.includes('поколение')&&candidate.matchedFields.includes('точный код двигателя')&&candidate.matchedFields.includes('мощность'));
 assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===pair.targetId));assert.ok(!live.some(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===pair.targetId));
 assert.deepEqual(f.cautions,[]);assert.ok(['NO_EXPLICIT_MARKER','EXPLICIT_ANALOG_SEPARATED'].includes(f.sections.status));
 const originalCapacity=parse(source.fillVolumeText,source.systemCode);assert.deepEqual(originalCapacity,evidence.originalCapacities);
 const sourceFingerprint=originalAssociationFingerprint(pair.targetId,source,originalCapacity);assert.equal(sourceFingerprint,pair.originalAssociationFingerprint);assert.ok(!denied.has(sourceFingerprint));
 const selected=originalCapacity.capacities.filter(c=>c.nominalLiters===evidence.selectedFuelCapacity.liters);assert.equal(selected.length,1);
 const applicabilityJson={sourceVehicleScope:{make:source.make,model:source.model,generation:'I'},matchedEngineScope:[pair.branch.engineCode],window:pair.window,transmissionType:'automatic',transmissionGearCount:8,componentModel:'TG-81SC'};
 const technicalDataJson={fillVolumeText:source.fillVolumeText,capacities:selected,specificationText:source.specificationText,specifications:parseSpecifications(source.specificationText,source.viscosityGradesJson??[]),viscosityGrades:source.viscosityGradesJson,sourceCapacitySelection:{originalFillVolumeText:source.fillVolumeText,originalCapacities:originalCapacity.capacities,selectedFuel:evidence.selectedFuelCapacity.fuelType,sourceFuelType:evidence.sourceFuelType,anchorFuelText:evidence.anchorFuelText,evidenceHash:sha(capacityRaw),serviceVolumeType:'UNKNOWN'}};
 for(const key of ['recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])technicalDataJson[key]=source[key];
 const fingerprint=sha({policy,sourceRequirementId:source.id,vehicleVariantKey:pair.targetId,applicabilityJson,technicalDataJson});
 const revision={id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,sourceRequirementId:source.id,vehicleVariantKey:pair.targetId,systemCode:source.systemCode,componentModel:'TG-81SC',applicabilityJson,technicalDataJson,state:'REVIEW',verificationStatus:'UNVERIFIED',matchClass:'CONDITIONAL_TRANSMISSION',matchScore:candidate.score,applyEligible:false,verifiedFieldsJson:[],replacesRevisionIds:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.specifications':'SECONDARY_SOURCE_PARSED_MEDIUM'},evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:source.sourceUrl}],provenanceJson:{conditionalTransmissionPolicy:policy,conditionalTransmissionEligible:true,conditionalTransmissionChoiceRequired:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:sourceFingerprint,originalComponentModel:source.componentModel,sourceComponentEngineList:f.componentEngineList,sourcePowerModelDateBranch:pair.branch,preflightHash:sha(preRaw),capacityEvidenceHash:sha(capacityRaw),independentValidation:{score:candidate.score,matchedFields:candidate.matchedFields,hardConflicts:[],reviewBlockers:candidate.reviewBlockers,vehicleIdentityIndependentlyValidated:true}}};
 const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalTransmissionPolicy:policy,automaticProductSelection:false}}};
 const w=pair.window.intersection;
 for(let m=month(w.from)-1;m<=month(w.to)+1;m++)for(const type of [undefined,'automatic','manual','cvt','robot'])for(const model of [undefined,'TG-81SC','TF-80SC'])for(const count of [undefined,8,6]){
  const context={...applicabilityJson.sourceVehicleScope,engineCode:pair.branch.engineCode,productionMonth:date(m),transmissionModel:model,transmissionGearCount:count};
  const items=profile([runtime],type,context).items,allowed=type==='automatic'&&model==='TG-81SC'&&count===8&&m>=month(w.from)&&m<=month(w.to);
  assert.equal(items.length,allowed?1:0);
  if(allowed){assert.equal(items[0].capacities.length,1);assert.equal(items[0].capacity.nominalLiters,evidence.selectedFuelCapacity.liters);assert.equal(items[0].automaticSelectionEligible,false);}
  checks++;
 }
 revisions.push(revision);pending.push({sourceRequirementId:source.id,vehicleVariantKey:pair.targetId,acceptedEngineScope:[pair.branch.engineCode],acceptedWindow:w,requiredTransmissionModel:'TG-81SC',reason:'REMAINING_SOURCE_ENGINE_DATE_AND_SERVICE_VOLUME_CONTEXT',publicationAllowed:false});
}
assert.equal(revisions.length,4);assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),sha(planRaw));
const summary={drafts:4,profileChecks:checks,canonicalChanged:false};
await writeFile(resolve(dir,'xc60-tg81-conditional-drafts-v1.json'),JSON.stringify({kind:'XC60_TG81_CONDITIONAL_DRAFTS',planHash:sha(planRaw),preflightHash:sha(preRaw),capacityReportHash:sha(capacityRaw),summary,revisions,pending,productionApplyAllowed:false,limitations:['Isolated synthetic completed staging fixtures; full joint profile and wrong-engine/source identity regression still required before merge.','Secondary source volumes retain unknown service-volume context; not a recommendation for replacement quantity.','Specific model and gear count confirmation required; no automatic VIN inference or publication.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
