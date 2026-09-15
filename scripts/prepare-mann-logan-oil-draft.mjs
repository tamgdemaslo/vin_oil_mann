import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const read=p=>readFile(resolve(root,p),'utf8');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw),auditRaw=await readFile(resolve(dir,'logan-complete-fluid-table-v1.json'),'utf8'),audit=JSON.parse(auditRaw);
assert.equal(sha(planRaw),audit.planHash);for(const [p,h] of Object.entries(audit.runtimeHashes))assert.equal(sha(await read(p)),h);
const f=audit.findings.find(f=>f.system==='ENGINE_OIL'),key=audit.vehicleVariantKey;
assert.ok(f.partitions.every(p=>p.target?.independentlyValidated&&p.status==='CONFIRMED_MULTI_APPLICABILITY'));assert.deepEqual(f.existingDraftIds,[]);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),audit.sourceHash);
const source=parseCopy(sourceRaw,'vehicle_fluid_requirements').find(s=>s.id===f.sourceRequirementId);assert.equal(sha(source),f.sourceHash);
assert.equal(f.fillVolume,'3.3 л. для K7M\n4.9 л. для K4M');assert.equal(source.powerHp,null);
const footnoteRaw=await read('data/mann-logan-source-footnote-evidence-v1.json'),footnote=JSON.parse(footnoteRaw);assert.equal(footnote.sourceRequirementId,source.id);assert.equal(footnote.oemVerified,false);
const liveRaw=await read('outputs/mann-live-audit-1789415211923/revisions.json'),live=JSON.parse(liveRaw);assert.equal(sha(liveRaw),plan.inputHashes.live);
const old=live.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===key);assert.equal(old.length,1);assert.equal(old[0].state,'REVIEW');assert.equal(old[0].verificationStatus,'UNVERIFIED');assert.equal(old[0].applyEligible,false);
const reviewsRaw=await read('outputs/mann-live-audit-1789415211923/reviewDecisions.json');assert.ok(!JSON.parse(reviewsRaw).some(d=>d.revisionId===old[0].id));
const previousAction=plan.existingActions.find(a=>a.revisionId===old[0].id);assert.equal(previousAction.action,'REVIEW_UNREPLACED');assert.equal(previousAction.expectedSemanticFingerprint,old[0].semanticFingerprint);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts'),{parseSpecifications}=await j.import('../src/lib/fluid-catalog.ts'),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
assert.deepEqual(parse(source.fillVolumeText,source.systemCode),f.parsedCapacity);
const selected=parse('3.3 л.',source.systemCode);assert.equal(selected.needsReview,false);assert.equal(selected.capacities.length,1);assert.equal(selected.capacities[0].nominalLiters,3.3);
const association=originalAssociationFingerprint(key,source,f.parsedCapacity),denyRaw=await read('data/mann-technical-association-denylist-v1.json');assert.ok(!JSON.parse(denyRaw).rejectedAssociationFingerprints.includes(association));
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1';
const template=plan.newRevisions.find(r=>r.vehicleVariantKey===key&&r.systemCode==='ENGINE_COOLANT');assert.ok(template);
const applicability=structuredClone(template.applicabilityJson);
const interval='Рекомендация podbormasla.ru: 5–7 тыс. км для описанных на сайте условий эксплуатации; не подтверждённый регламент Renault.';
const spec='Renault RN 0710, RN 0700';
const technical={fillVolumeText:'3.3 л. для K7M',capacities:selected.capacities,specificationText:spec,specifications:parseSpecifications(spec,[]),viscosityGrades:source.viscosityGradesJson,recommendationText:'Объём указан источником для K7M; наличие фильтра и вид обслуживания не уточнены. Сверьте с руководством автомобиля.',replacementIntervalText:interval,replacementKmMin:null,replacementKmMax:null,replacementMonths:null,controlIntervalText:null,analogText:null,
 sourceCapacitySelection:{originalFillVolumeText:source.fillVolumeText,originalCapacities:f.parsedCapacity.capacities,selectedEngine:'K7M',literalSourceBranch:'3.3 л. для K7M',serviceVolumeType:'UNKNOWN',filterContext:'UNKNOWN',evidenceHash:sha(auditRaw)},
 sourceIntervalAttribution:{publisher:footnote.publisher,sourceIntervalText:source.replacementIntervalText,footnoteEvidenceHash:sha(footnoteRaw),oemVerified:false,manufacturerIntervalNotImported:true},
 sourceSpecificationAttribution:{policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:source.specificationText,mainSourceText:spec,originalSourceHash:sha(source),sourceRequirementId:source.id,oemVerified:false,automaticAnalogSelectionAllowed:false}};
const fingerprint=sha({policy,sourceRequirementId:source.id,vehicleVariantKey:key,applicability,technical});
const r={id:`mtar_${fingerprint.slice(0,24)}`,sourceRequirementId:source.id,vehicleVariantKey:key,systemCode:source.systemCode,componentModel:null,applicabilityJson:applicability,technicalDataJson:technical,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_HIGH','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH','technical.viscosityGrades':'SECONDARY_SOURCE_PARSED_HIGH','technical.recommendation':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.replacementInterval':'SECONDARY_SOURCE_PARSED_MEDIUM'},evidenceJson:[{publisher:'podbormasla.ru',title:'Logan II: engine-specific oil capacity and attributed source recommendation',url:source.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:association,sourceRequirementHash:sha(source),independentValidation:f.partitions[0].target,datePartitionEvidence:{auditHash:sha(auditRaw),partitions:f.partitions.map(p=>({window:p.window,target:p.target,decisionFingerprint:p.decisionFingerprint}))},predecessorHash:sha(old[0]),footnoteEvidenceHash:sha(footnoteRaw)},state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:'CONFIRMED_MULTI_APPLICABILITY',matchScore:86,semanticFingerprint:fingerprint,applyEligible:false,replacesRevisionIds:[old[0].id]};
const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}});
const others=[...plan.newRevisions.filter(x=>x.vehicleVariantKey===key).map(fixture),...live.filter(x=>x.vehicleVariantKey===key&&x.id!==old[0].id).map(x=>({...x,createdAt:new Date(x.createdAt)}))];
let checks=0;const month=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
for(let m=month('2013-05')-1;m<=month('2022-12')+1;m++)for(const engineCode of ['K7M','K4M','H4M',undefined])for(const model of ['logan','sandero'])for(const generation of ['II','I']){
 const context={make:'renault',model,generation,engineCode,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
 const expected=m>=month('2013-05')&&m<=month('2022-12')&&engineCode==='K7M'&&model==='logan'&&generation==='II';
 const before=profile(others,undefined,context).items,after=profile([...others,fixture(r)],undefined,context).items,item=after.find(i=>i.revisionId===r.id);assert.equal(!!item,expected);
 if(item){assert.equal(item.capacities.length,1);assert.equal(item.capacities[0].nominalLiters,3.3);assert.equal(item.replacementInterval,interval);assert.ok(!item.automaticSelectionEligible);assert.ok(item.specifications.every(s=>!s.includes('Периодичность')));}
 for(const item of before)assert.ok(after.some(i=>sha(i)===sha(item)));checks++;
}
const valid={make:'renault',model:'logan',generation:'II',engineCode:'K7M',productionMonth:'2016-05'};assert.equal(profile([{...fixture(r),run:{...fixture(r).run,status:'PLANNED'}}],undefined,valid).items.length,0);assert.equal(profile([fixture(r)],undefined,{}).items.length,0);
await writeFile(resolve(dir,'logan-oil-draft-v1.json'),JSON.stringify({kind:'LOGAN_K7M_ENGINE_OIL_REPLACEMENT_DRAFT',planHash:sha(planRaw),auditHash:sha(auditRaw),footnoteHash:sha(footnoteRaw),liveHash:sha(liveRaw),reviewsHash:sha(reviewsRaw),denylistHash:sha(denyRaw),newRevisions:[r],existingActionUpdates:[{...previousAction,action:'REPLACE_WITH_PREVIEW',successorId:r.id}],summary:{drafts:1,replacements:1,profileChecks:checks},productionApplyAllowed:false,limitations:['Not merged/published.','Secondary source 3.3L K7M branch, unknown filter and service context.','Interval explicitly attributed to source, not OEM verified.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({draft:r.id,checks,capacity:3.3,intervalAttributed:true}));
