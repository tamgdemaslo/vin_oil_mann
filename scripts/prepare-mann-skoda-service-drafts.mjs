import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const dir='outputs/mann-live-audit-1789479529769',read=f=>readFileSync(f,'utf8');
const auditRaw=read('outputs/mann-live-audit-1789469257907/legacy-transmission-list-rematch-1789480002737.json'),audit=JSON.parse(auditRaw);
const liveRaw=read(`${dir}/revisions.json`),live=JSON.parse(liveRaw),sources=JSON.parse(read(`${dir}/vehicle_fluid_requirements.json`));
const ar=read('../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson');
assert.equal(sha(ar),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const archive=ar.trim().split('\n').map(JSON.parse),j=createJiti(import.meta.url,{alias:{'@':resolve('src')}});
const {parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const {explicitMannAlphanumericModels:modelsOf}=await j.import('../src/lib/mann-transmission-model-list.ts');
const policy='USER_CONFIRMED_TRANSMISSION_V1',listPolicy='EXPLICIT_ALPHANUMERIC_SOURCE_MODEL_LIST_V1',drafts=[];let checks=0;
for(const f of audit.findings.filter(f=>['kodiaq','rapid'].includes(f.model))){
 const s=f.dateScoped.effectiveSource,original=sources.find(r=>r.id===s.id);
 // SQL and JSON snapshots encode dates/numbers differently; compare substantive source fields.
 for(const key of ['sourceRowId','fillVolumeText','specificationText','engineCodeNormalized','componentModel','systemCode'])assert.deepEqual(original[key],s[key]);
 assert.equal(f.dateScoped.onlyGearboxBlocker,true);assert.equal(sha(s),f.sourceHash);
 const own=archive.find(r=>r.row_id===s.sourceRowId);assert.ok(own);assert.equal(own.model,s.componentModel);
 assert.equal(own.fill_volume.replace(/\s+/g,' '),s.fillVolumeText);
 const tableAnchors=archive.filter(r=>r.source_url===own.source_url&&r.table_index===own.table_index&&r.system_name==='МАСЛО в ДВИГАТЕЛЬ');
 assert.equal(tableAnchors.length,s.model==='rapid'?2:1);
 const anchors=tableAnchors.filter(r=>r.application.split('\n').map(l=>l.trim()).includes('- '+s.engineCodeNormalized));
 assert.equal(anchors.length,1);assert.ok(anchors[0].application.includes(s.engineCodeNormalized));
 assert.match(own.system_name,/-6$/);const models=modelsOf(s.componentModel);assert.deepEqual(models,f.literalModels);
 const main=own.specification.split('\n').filter(l=>! /^(Аналог|Контроль|Периодичность замены):/.test(l)).join(' ').trim();
 assert.equal(main,s.model==='kodiaq'?'VAG G 052 182 A2':'VAG G 055 540 A2');
 const parsed=parse(s.fillVolumeText,s.systemCode);assert.equal(parsed.needsReview,false);
 const expected=s.model==='kodiaq'?[['PARTIAL',5],['FULL_REPLACEMENT',6.9]]:[['PARTIAL',3],['TOTAL',7],['REFILL',10]];
 assert.deepEqual(parsed.capacities.map(c=>[c.kind,c.nominalLiters]),expected);
 const scope={sourceVehicleScope:{make:s.make,model:s.model},window:f.dateScoped.window,matchedEngineScope:[s.engineCodeNormalized],transmissionType:s.transmissionType,transmissionGearCount:6,componentModel:s.componentModel};
 const technical={fillVolumeText:s.fillVolumeText,capacities:parsed.capacities,specificationText:main,specifications:[{type:'SOURCE_REQUIREMENT_TEXT',value:main}],viscosityGrades:[],analogText:own.analog,replacementIntervalText:own.replacement_interval,sourceSpecificationAttribution:{policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:own.specification,mainSourceText:main,sourceRequirementId:s.id,originalSourceHash:sha(s),oemVerified:false,automaticAnalogSelectionAllowed:false}};
 const fp=sha({policy,listPolicy,scope,technical,source:s.id,key:f.vehicleVariantKey}),c=f.dateScoped.candidate;
 const r={id:'mtar_'+fp.slice(0,24),sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson:scope,technicalDataJson:technical,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_HIGH','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH'},evidenceJson:[{publisher:'podbormasla.ru',title:own.page_title,url:s.sourceUrl}],provenanceJson:{conditionalTransmissionPolicy:policy,conditionalTransmissionEligible:true,catalogPreviewEligible:false,sourceTechnicalReviewRequired:true,sourceRequirementHash:sha(s),sourceAssociationFingerprint:originalAssociationFingerprint(f.vehicleVariantKey,s,parsed),sourceOwnRowHash:sha(own),sourceAnchorHash:sha(anchors[0]),fullBrandAuditHash:sha(auditRaw),explicitTransmissionModelList:{policy:listPolicy,models,sourceComponentModel:s.componentModel},independentValidation:{vehicleIdentityIndependentlyValidated:true,score:c.score,hardConflicts:c.hardConflicts,reviewBlockers:c.reviewBlockers,matchedFields:c.matchedFields}},state:'REVIEW',verificationStatus:'UNVERIFIED',matchClass:'CONDITIONAL_TRANSMISSION',matchScore:c.score,semanticFingerprint:fp,applyEligible:false,replacesRevisionIds:[]};
 const existing=live.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey).map(x=>({...x,createdAt:new Date(x.createdAt)})),old=live.find(x=>x.id===f.revisionId);
 assert.ok(old);assert.equal(old.reviewConfirmed,false);assert.equal(old.applyEligible,false);
 const fixture={...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalTransmissionPolicy:policy,transmissionModelListPolicy:listPolicy,automaticProductSelection:false}}};
 const base={...scope.sourceVehicleScope,engineCode:s.engineCodeNormalized,productionMonth:scope.window.intersection.from,transmissionModel:models[0],transmissionGearCount:6};
 const cases=[{patch:{},visible:true},{patch:{productionMonth:scope.window.intersection.to},visible:true},...[{engineCode:undefined},{engineCode:'WRONG'},{productionMonth:undefined},{productionMonth:'2015-01'},{productionMonth:'2024-01'},{transmissionModel:undefined},{transmissionModel:'WRONG123'},{transmissionGearCount:undefined},{transmissionGearCount:7},{model:'WRONG'}].map(patch=>({patch,visible:false})),{patch:{},type:'manual',visible:false}];
 for(const test of cases){const type=test.type??s.transmissionType,context={...base,...test.patch},before=profile(existing,type,context),after=profile([...existing,fixture],type,context),item=after.items.find(i=>i.revisionId===r.id);assert.equal(!!item,test.visible,`${s.model} ${JSON.stringify(test)}`);for(const previous of before.items)assert.ok(after.items.some(i=>sha(i)===sha(previous)));if(item){assert.equal(item.automaticSelectionEligible,false);assert.deepEqual(item.specifications,[main]);assert.deepEqual(item.capacities.map(c=>[c.serviceContext,c.nominalLiters]),expected);if(s.model==='kodiaq')assert.equal(item.capacities[1].serviceContextLabel,'полная замена');}checks++;}
 drafts.push({...r,existingAssociation:{revisionId:old.id,rowHash:sha(old),action:'REQUIRES_EXPLICIT_EXISTING_PAIR_RECONCILIATION_NOT_INSERT_ONLY'}});
}
assert.equal(drafts.length,2);const output=`${dir}/skoda-service-scoped-drafts.json`;
writeFileSync(output,JSON.stringify({kind:'SKODA_SERVICE_SCOPED_DRAFTS',auditHash:sha(auditRaw),liveHash:sha(liveRaw),checks,newRevisions:drafts,productionApplyAllowed:false,limitations:['Synthetic profile checks, not persisted HTTP or installed gearbox confirmation.','Existing pairs require explicit reconciliation; no production writes.','Requires v7 service context support; raw source and analog roles preserved.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,drafts:2,checks}));
