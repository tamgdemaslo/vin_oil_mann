import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw),matchRaw=await readFile(resolve(dir,'sx4-112-source-rematch-v1.json'),'utf8'),match=JSON.parse(matchRaw);assert.equal(sha(planRaw),match.planHash);
for(const [p,h] of Object.entries(match.runtimeHashes))assert.equal(sha(await readFile(resolve(root,p),'utf8')),h);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),match.sourceHash);const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8');assert.equal(sha(liveRaw),match.liveHash);const live=JSON.parse(liveRaw);
const reviewRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/reviewDecisions.json'),'utf8'),reviews=JSON.parse(reviewRaw),denyRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8'),denied=new Set(JSON.parse(denyRaw).rejectedAssociationFingerprints);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts'),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const drafts=[],updates=[];
for(const f of match.findings){
 assert.equal(f.targetValidated,true);const s=sources.get(f.sourceRequirementId);assert.equal(sha(s),f.originalSourceHash);assert.equal(s.componentModel,null);assert.equal(f.predecessors.length,0);
 assert.ok(!live.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===f.vehicleVariantKey));
 assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===f.vehicleVariantKey));
 const b=f.literalBranch;assert.ok(['RU','US'].includes(b.requiredMarket));assert.equal(b.driveCondition,null);
 const applicability={matchedEngineScope:f.engineScope,window:f.window,requiredMarket:b.requiredMarket,sourceVehicleScope:{make:f.decision.normalizedVehicle.canonicalMake,model:f.decision.normalizedVehicle.baseModel,generation:f.decision.normalizedVehicle.generation}};
 const parsed=parse(s.fillVolumeText,s.systemCode);assert.deepEqual(parsed,f.capacity);const association=originalAssociationFingerprint(f.vehicleVariantKey,s,parsed);assert.ok(!denied.has(association));
 const marker=s.specificationText.search(/Периодичность замены:|По регламенту:/u);assert.ok(marker>=0);let main=s.specificationText.slice(0,marker).trim(),interval=s.specificationText.slice(marker).replace(/^Периодичность замены:\s*/u,'');
 let recommendation='Данные podbormasla.ru, не проверены по руководству производителя. Условия спецификации сохранены в тексте.';
 let analog=null;
 if(main.includes('или аналогичная*')){assert.equal(s.systemCode,'ENGINE_COOLANT');main=main.replace('или аналогичная*','').trim();analog='Источник допускает аналог со сноской, условия которой не подтверждены. Автоматический выбор аналога запрещён.';recommendation+=' Не используйте неопределённый аналог из сноски без отдельной проверки.';}
 if(s.systemCode==='ENGINE_COOLANT'){
  assert.equal(s.id,'ac1d3d8126674daecfcfdbf2f9cabb1c498866eb5f837211fd607c27a4be41fd');
  assert.equal(s.specificationText,'SUZUKI SUPER LONG LIFE COOLANT OEM: 990E0-59J44000, 990F0-ECSC2-005 Аналог: NISSAN L250 Цвет: Синий Периодичность замены: Первая замена через 150 тыс. км или 8 лет, далее каждые 75 тыс. км или 4 года ИЛИ SUZUKI LONG LIFE COOLANT Аналог: VW TL 774-C (G11) Цвет: Зеленый Периодичность замены: 45 тыс. км или 3 года');
  main='SUZUKI SUPER LONG LIFE COOLANT (OEM: 990E0-59J44000, 990F0-ECSC2-005) ИЛИ SUZUKI LONG LIFE COOLANT. Вариант выбирается по документации автомобиля; взаимозаменяемость и возможность смешивания не подтверждены.';
  interval='Для SUZUKI SUPER LONG LIFE COOLANT: первая замена через 150 тыс. км или 8 лет, далее каждые 75 тыс. км или 4 года. Для SUZUKI LONG LIFE COOLANT: 45 тыс. км или 3 года.';
  analog='Вторичный источник называет NISSAN L250 для SUPER LONG LIFE и VW TL 774-C (G11) для LONG LIFE. Соответствие аналогов не проверено; автоматический подбор аналога запрещён.';
  recommendation+=' Указаны два отдельных варианта антифриза с разными интервалами. Цвет не является подтверждением соответствия; проверьте требуемый вариант по документации автомобиля.';
 }
 const technical={fillVolumeText:s.fillVolumeText,capacities:parsed.capacities,specificationText:main,specifications:[{type:'SOURCE_REQUIREMENT_TEXT',value:main}],viscosityGrades:s.viscosityGradesJson,recommendationText:recommendation,replacementIntervalText:'По данным podbormasla.ru (не проверено по регламенту производителя): '+interval,replacementKmMin:null,replacementKmMax:null,replacementMonths:null,controlIntervalText:s.controlIntervalText,analogText:analog,sourceSpecificationAttribution:{policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:s.specificationText,mainSourceText:main,originalSourceHash:sha(s),sourceRequirementId:s.id,oemVerified:false,automaticAnalogSelectionAllowed:false},sourceIntervalAttribution:{originalText:s.replacementIntervalText,retainedFullIntervalText:interval,oemVerified:false,numericIntervalWithheldToAvoidMixingSchedules:true}};
 let policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1';
 if(parsed.needsReview){
  assert.equal(s.id,'86193f4ac246d47e4e544b9e67f466ecd1ff6a06319115b48e7c104f6f4c15a3');assert.equal(s.fillVolumeText,'5.2 л. для моделей с МКПП 5.3 л. для моделей с АКПП');
  policy='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1';delete technical.capacities;
  technical.capacityBranches=[['manual','5.2 л. для моделей с МКПП '],['automatic','5.3 л. для моделей с АКПП']].map(([value,sourceSegment])=>({condition:{kind:'transmission',value},sourceSegment,applicabilityJson:applicability,validation:f.target,originalAssociationFingerprint:association}));
 }
 const fp=sha({policy,sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,applicability,technical});
 const r={id:`mtar_${fp.slice(0,24)}`,sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,systemCode:s.systemCode,componentModel:null,applicabilityJson:applicability,technicalDataJson:technical,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_HIGH','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH','technical.viscosityGrades':'SECONDARY_SOURCE_PARSED_HIGH','technical.recommendation':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.replacementInterval':'SECONDARY_SOURCE_PARSED_MEDIUM'},evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей: условия исходного текста сохранены',url:s.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:association,sourceRequirementHash:sha(s),literalEngineBranch:b,rematchHash:sha(matchRaw),independentValidation:f.target},state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:f.decision.status,matchScore:f.target.score,semanticFingerprint:fp,applyEligible:false,replacesRevisionIds:[]};drafts.push(r);
}
assert.equal(drafts.length,3);
const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}});
let checks=0;const month=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
for(const r of drafts){const a=r.applicabilityJson,group=drafts.filter(d=>d.vehicleVariantKey===r.vehicleVariantKey),replaced=new Set(group.flatMap(d=>d.replacesRevisionIds));
 const others=[...plan.newRevisions.filter(d=>d.vehicleVariantKey===r.vehicleVariantKey).map(fixture),...live.filter(d=>d.vehicleVariantKey===r.vehicleVariantKey&&!replaced.has(d.id)).map(d=>({...d,createdAt:new Date(d.createdAt)}))];
 for(let m=month(a.window.intersection.from)-1;m<=month(a.window.intersection.to)+1;m++)for(const engineCode of [a.matchedEngineScope[0],'M15A','WRONG',undefined])for(const confirmedMarket of [a.requiredMarket,'JP',undefined])for(const transmission of ['manual','automatic','cvt',undefined]){
  const context={...a.sourceVehicleScope,engineCode,confirmedMarket,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`},expected=m>=month(a.window.intersection.from)&&m<=month(a.window.intersection.to)&&engineCode===a.matchedEngineScope[0]&&confirmedMarket===a.requiredMarket;
  const after=profile([...others,...group.map(fixture)],transmission,context).items,before=profile(others,transmission,context).items,item=after.find(i=>i.revisionId===r.id);assert.equal(!!item,expected);
  if(item){assert.equal(item.automaticSelectionEligible,false);assert.deepEqual(item.specifications,[r.technicalDataJson.specificationText]);assert.equal(item.replacementInterval,r.technicalDataJson.replacementIntervalText);if(r.technicalDataJson.capacityBranches){assert.equal(item.capacities.length,['manual','automatic'].includes(transmission)?1:0);if(item.capacities.length)assert.equal(item.capacities[0].nominalLiters,transmission==='manual'?5.2:5.3);}}
  for(const old of before)assert.ok(after.some(i=>sha(i)===sha(old)));checks++;
 }
 const valid={...a.sourceVehicleScope,engineCode:a.matchedEngineScope[0],confirmedMarket:a.requiredMarket,productionMonth:a.window.intersection.from};assert.equal(profile([fixture(r)],undefined,{...valid,generation:'WRONG'}).items.length,0);assert.equal(profile([fixture(r)],undefined,{...valid,model:'WRONG'}).items.length,0);assert.equal(profile([{...fixture(r),run:{...fixture(r).run,status:'PLANNED'}}],undefined,valid).items.length,0);
}
await writeFile(resolve(dir,'sx4-112-fluid-drafts-v1.json'),JSON.stringify({kind:'SX4_112_RU_FIRST_GENERATION_NEW_FLUID_DRAFTS',planHash:sha(planRaw),rematchHash:sha(matchRaw),liveHash:sha(liveRaw),reviewsHash:sha(reviewRaw),denylistHash:sha(denyRaw),summary:{drafts:3,replacements:0,profileChecks:checks},newRevisions:drafts,existingActionUpdates:updates,productionApplyAllowed:false,limitations:['Standalone new records with no predecessors, not merged or published/OEM verified.','RU or US market evidence required, no geography inferred from language.','Source specification alternatives remain intact as prose, not flattened independent approvals.','Two coolant types retain their own schedules; secondary analogs not promoted to verified requirements.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({drafts:3,checks}));
