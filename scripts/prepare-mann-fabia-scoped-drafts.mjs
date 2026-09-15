import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const dir=resolve('outputs/mann-live-audit-1789469257907'),raw=await readFile(resolve(dir,'fabia-mk2-identity-audit.json'),'utf8'),audit=JSON.parse(raw);
const sr=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mr=await readFile('/tmp/mann_filter_applications.sql','utf8'),ar=await readFile('../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson','utf8');
assert.equal(sha(sr),audit.sourceHash);assert.equal(sha(mr),audit.mannHash);assert.equal(sha(ar),audit.archiveHash);
const sources=new Map(parseCopy(sr,'vehicle_fluid_requirements').map(r=>[r.id,r])),mann=parseCopy(mr,'mann_filter_applications'),archive=ar.trim().split('\n').map(JSON.parse);
const lr=await readFile(resolve(dir,'revisions.json'),'utf8'),live=JSON.parse(lr).map(r=>({...r,createdAt:new Date(r.createdAt)}));
const j=createJiti(import.meta.url,{alias:{'@':resolve('src')}}),{parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts'),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const drafts=[],policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1';let checks=0;
for(const f of audit.findings)for(const t of f.scoped.filter(t=>t.target)){
 const s=sources.get(f.sourceId);assert.equal(sha(s),f.sourceHash);assert.ok(['ENGINE_OIL','ENGINE_COOLANT','BRAKE_FLUID'].includes(s.systemCode));
 const own=archive.find(r=>r.row_id===s.sourceRowId);assert.equal(sha(own),f.sourceRowHash);assert.equal(own.analog,'');assert.equal(own.fill_volume,s.fillVolumeText);
 const anchors=own.system_name.startsWith('МАСЛО в ДВИГАТЕЛЬ')?[own]:archive.filter(r=>r.source_url===own.source_url&&r.table_index===own.table_index&&r.system_name.startsWith('МАСЛО в ДВИГАТЕЛЬ'));assert.equal(anchors.length,1);
 const targetCodes=[...new Set(mann.filter(r=>r.vehicleVariantKey===t.key).flatMap(r=>String(r.engineCode).split(/[,;/\s]+/)))],engines=s.engineCodesJson.filter(e=>targetCodes.includes(e));assert.ok(engines.length);
 for(const e of engines)assert.ok(anchors[0].application.includes(e));
 const capacity=parse(s.fillVolumeText,s.systemCode);assert.equal(capacity.needsReview,false);assert.equal(capacity.capacities.length,1);
 const index=s.specificationText.indexOf('Периодичность замены:');assert.ok(index>0);
 const spec=s.specificationText.slice(0,index).trim(),interval=s.specificationText.slice(index+'Периодичность замены:'.length).trim();
 // Preserve best-choice/alternative text as one attributed clause; never
 // flatten viscosities across VW504 and VW502 or label catalogue as OEM proof.
 const technical={fillVolumeText:s.fillVolumeText,capacities:capacity.capacities,specifications:[{type:'SOURCE_REQUIREMENT_TEXT',value:spec}],specificationText:spec,viscosityGrades:[],replacementIntervalText:interval,sourceSpecificationAttribution:{policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:s.specificationText,mainSourceText:spec,metadataAndCautionText:interval,sourceRequirementId:s.id,originalSourceHash:sha(s),oemVerified:false,automaticAnalogSelectionAllowed:false}};
 const scope={sourceVehicleScope:{make:s.make,model:s.model,generation:'II'},window:t.window,matchedEngineScope:engines};
 const fingerprint=sha({policy,source:s.id,key:t.key,scope,technical});
 const r={id:'mtar_'+fingerprint.slice(0,24),sourceRequirementId:s.id,vehicleVariantKey:t.key,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson:scope,technicalDataJson:technical,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_HIGH','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH','technical.replacementInterval':'SECONDARY_SOURCE_PARSED_HIGH'},evidenceJson:[{publisher:'podbormasla.ru',title:own.page_title,url:s.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,independentValidation:t.target,sourceRequirementHash:sha(s),sourceAnchorHash:sha(anchors[0]),sourceIdentityCorrection:{auditHash:sha(raw),before:f.beforeIdentity,after:f.afterIdentity,sourceRowHash:f.sourceRowHash,pageHash:f.pageHash}},state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:'CONFIRMED_SINGLE',matchScore:t.target.score,semanticFingerprint:fingerprint,applyEligible:false,replacesRevisionIds:[]};
 const fixture={...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:policy,automaticProductSelection:false}}};
 const existing=live.filter(r=>r.vehicleVariantKey===t.key),existingSameSource=existing.filter(r=>r.sourceRequirementId===s.id);
 assert.equal(existingSameSource.length,0,'Existing association requires reviewed replacement, not insert-only');
 for(const engineCode of engines){
  const base={...scope.sourceVehicleScope,engineCode,productionMonth:'2013-06'};
  for(const patch of [{},{productionMonth:t.window.intersection.from},{productionMonth:t.window.intersection.to},{engineCode:'WRONG'},{engineCode:undefined},{generation:'III'},{productionMonth:'2006-12'},{productionMonth:'2015-01'},{productionMonth:undefined}]){
   const c={...base,...patch},expected=!('engineCode'in patch)&&!('generation'in patch)&&(!('productionMonth'in patch)||[t.window.intersection.from,t.window.intersection.to].includes(patch.productionMonth));
   const before=profile(existing,undefined,c),after=profile([...existing,fixture],undefined,c),item=after.items.find(x=>x.revisionId===r.id);
   assert.equal(Boolean(item),expected);for(const old of before.items)assert.ok(after.items.some(x=>sha(x)===sha(old)));
   if(item){assert.deepEqual(item.specifications,[spec]);assert.equal(item.capacities.length,1);assert.equal(item.automaticSelectionEligible,false);assert.equal(item.sourceStatus,'catalog_preview');}
   checks++;
  }
 }
 drafts.push(r);
}
assert.equal(drafts.length,5);
await writeFile(resolve(dir,'fabia-scoped-drafts.json'),JSON.stringify({kind:'FABIA_EXACT_PAGE_SCOPED_DRAFTS',auditHash:sha(raw),liveHash:sha(lr),checks,newRevisions:drafts,productionApplyAllowed:false,limitations:['Pure local profile checks against persisted snapshot, not production API.','Original source identity unchanged; proposed generation correction scoped to exact page evidence.','Source oil alternatives kept as one labelled text clause, not interchangeable approvals.','Service volume semantics and source interval footnote retained without invention.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({drafts:drafts.length,checks}));
