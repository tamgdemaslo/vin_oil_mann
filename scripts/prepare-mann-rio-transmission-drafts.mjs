import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const dir=resolve('outputs/mann-live-audit-1789469257907');
const preRaw=await readFile(resolve(dir,'rio-transmission-recovery-preflight.json'),'utf8'),pre=JSON.parse(preRaw);
const sr=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sr),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const sources=new Map(parseCopy(sr,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const archiveRaw=await readFile('../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson','utf8');
assert.equal(sha(archiveRaw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const archive=archiveRaw.trim().split('\n').map(JSON.parse);
const liveRaw=await readFile(resolve(dir,'revisions.json'),'utf8'),live=JSON.parse(liveRaw).map(r=>({...r,createdAt:new Date(r.createdAt)}));
const j=createJiti(import.meta.url,{alias:{'@':resolve('src')}});
const {parseFluidCapacities}=await j.import('../src/lib/fluid-capacity-parser.ts');
const {parseSpecifications}=await j.import('../src/lib/fluid-catalog.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const policy='USER_CONFIRMED_TRANSMISSION_V1',drafts=[];let checks=0;
for(const f of pre.findings){
 const s=sources.get(f.sourceId);assert.equal(sha(s),f.sourceHash);
 const own=archive.find(r=>r.row_id===s.sourceRowId);assert.ok(own);
 const anchors=archive.filter(r=>r.source_url===own.source_url&&r.table_index===own.table_index&&r.system_name==='МАСЛО в ДВИГАТЕЛЬ');
 assert.equal(anchors.length,1);assert.match(anchors[0].application,/- G4LC \/ 100 л\.с\. \/ Россия/);
 assert.equal(own.system_name,s.transmissionType==='automatic'?'МАСЛО в АКПП-6':'МАСЛО в МКПП-6');
 assert.equal(own.fill_volume,s.fillVolumeText);assert.equal(own.model,'-');assert.equal(own.analog,'');
 const parsed=parseFluidCapacities(s.fillVolumeText,s.systemCode);assert.equal(parsed.needsReview,false);assert.equal(parsed.capacities.length,1);
 const marker='Периодичность замены:',offset=s.specificationText.indexOf(marker);assert.ok(offset>0);
 const spec=s.specificationText.slice(0,offset).trim(),interval=s.specificationText.slice(offset+marker.length).trim();
 const grades=s.transmissionType==='manual'?['70W']:[];
 assert.equal(spec,s.transmissionType==='manual'?'API GL-4 для SAE 70W':'ATF SP-IV');
 const scope={sourceVehicleScope:{make:s.make,model:s.model,generation:s.generation},window:f.window,matchedEngineScope:['G4LC'],engineCodes:['G4LC'],requiredMarket:'RU',transmissionType:s.transmissionType,transmissionGearCount:6,componentModel:s.componentModel};
 const technical={fillVolumeText:s.fillVolumeText,capacities:parsed.capacities,specificationText:spec,specifications:[{type:'SOURCE_REQUIREMENT_TEXT',value:spec},...parseSpecifications(spec,grades).filter(x=>x.type!=='RAW')],viscosityGrades:grades,replacementIntervalText:interval,
 sourceSpecificationAttribution:{policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:s.specificationText,mainSourceText:spec,metadataAndCautionText:interval,sourceRequirementId:s.id,originalSourceHash:sha(s),oemVerified:false,automaticAnalogSelectionAllowed:false}};
 const fingerprint=sha({policy,source:s.id,key:f.key,scope,technical});
 const validation={vehicleIdentityIndependentlyValidated:true,score:f.identityEvidence.score,hardConflicts:f.identityEvidence.hardConflicts,reviewBlockers:f.identityEvidence.reviewBlockers,matchedFields:f.identityEvidence.matchedFields};
 const r={id:'mtar_'+fingerprint.slice(0,24),sourceRequirementId:s.id,vehicleVariantKey:f.key,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson:scope,technicalDataJson:technical,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_HIGH','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH','technical.viscosityGrades':'SECONDARY_SOURCE_PARSED_HIGH','technical.replacementInterval':'SECONDARY_SOURCE_PARSED_HIGH'},evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:s.sourceUrl}],provenanceJson:{conditionalTransmissionPolicy:policy,conditionalTransmissionEligible:true,catalogPreviewEligible:false,sourceTechnicalReviewRequired:true,independentValidation:validation,sourceRequirementHash:sha(s),sourceAnchorHash:sha(anchors[0]),sourceOwnRowHash:sha(own),preflightHash:sha(preRaw)},state:'REVIEW',verificationStatus:'UNVERIFIED',matchClass:'CONDITIONAL_TRANSMISSION',matchScore:f.identityEvidence.score,semanticFingerprint:fingerprint,applyEligible:false,replacesRevisionIds:[]};
 const fixture={...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalTransmissionPolicy:policy,automaticProductSelection:false}}};
 const existing=live.filter(x=>x.vehicleVariantKey===f.key);assert.ok(existing.length);assert.equal(existing.some(x=>x.sourceRequirementId===s.id),false);
 const base={...scope.sourceVehicleScope,engineCode:'G4LC',confirmedMarket:'RU',productionMonth:'2021-06',transmissionGearCount:6};
 const cases=[{context:base,type:s.transmissionType,visible:true},...[{}, {engineCode:'WRONG'}, {confirmedMarket:'EU'}, {transmissionGearCount:5},{productionMonth:'2016-12'},{productionMonth:'2023-01'},{generation:'III'}].slice(1).map(p=>({context:{...base,...p},type:s.transmissionType,visible:false})),{context:base,type:undefined,visible:false},{context:base,type:s.transmissionType==='automatic'?'manual':'automatic',visible:false},{context:{...base,transmissionGearCount:undefined},type:s.transmissionType,visible:false}];
 for(const field of ['engineCode','confirmedMarket','productionMonth'])cases.push({context:{...base,[field]:undefined},type:s.transmissionType,visible:false});
 for(const productionMonth of [f.window.intersection.from,f.window.intersection.to])cases.push({context:{...base,productionMonth},type:s.transmissionType,visible:true});
 for(const c of cases){
  const before=profile(existing,c.type,c.context),after=profile([...existing,fixture],c.type,c.context),item=after.items.find(x=>x.revisionId===r.id);
  assert.equal(Boolean(item),c.visible);for(const old of before.items)assert.ok(after.items.some(x=>sha(x)===sha(old)));
  if(item){assert.equal(item.automaticSelectionEligible,false);assert.equal(item.capacities.length,1);assert.ok(item.specifications.includes(spec));assert.equal(item.sourceStatus,'catalog_preview');}
  checks++;
 }
 drafts.push(r);
}
assert.equal(drafts.length,4);
await writeFile(resolve(dir,'rio-transmission-drafts-v2.json'),JSON.stringify({kind:'SCOPED_RIO_TRANSMISSION_DRAFTS',preflightHash:sha(preRaw),liveHash:sha(liveRaw),sourceArchiveHash:sha(archiveRaw),checks,newRevisions:drafts,productionApplyAllowed:false,limitations:['Local profile tests on persisted snapshot plus simulated completed draft run; not production HTTP or VIN correctness.','Requires actual RU destination, G4LC, correct generation/build date and explicit six-speed transmission choice.','Unspecified service type remains unspecified: 6.7 litres is not asserted partial-change volume.','No database writes or modification of committed v16 plan.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({drafts:drafts.length,checks}));
