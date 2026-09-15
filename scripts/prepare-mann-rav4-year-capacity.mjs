import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {parseYearCapacityBranches as parse,selectYearCapacityBranch as select} from './lib/mann-year-capacity-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const planRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8'),plan=JSON.parse(planRaw);
const reconciliation=JSON.parse(await readFile(resolve(dir,'unplanned-market-predecessor-reconciliation-v2.json'),'utf8'));assert.equal(reconciliation.planHash,sha(planRaw));
const rematchRaw=await readFile(resolve(dir,'unplanned-literal-branch-rematch-v1.json'),'utf8');assert.equal(sha(rematchRaw),reconciliation.rematchHash);
const id='477e405c888473a6553d08b795bb94c7f84eb4d8e49b755aefe3a809b99dceec',f=JSON.parse(rematchRaw).findings.find(f=>f.sourceRequirementId===id);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),plan.inputHashes.source);const s=parseCopy(sql,'vehicle_fluid_requirements').find(s=>s.id===id);assert.equal(sha(s),f.originalSourceHash);
const review=reconciliation.findings.find(r=>r.sourceRequirementId===id);assert.deepEqual(review.remainingReasons,['CAPACITY_OR_SERVICE_CONDITION']);
assert.equal(plan.newRevisions.some(r=>r.sourceRequirementId===id),false);
const parsed=parse(s.fillVolumeText);assert.equal(parsed.status,'structured');
assert.equal(select(parsed.branches,2009).capacityText,'6.4 л.');assert.equal(select(parsed.branches,2010),null);assert.equal(select(parsed.branches,2011).capacityText,'5.8 л.');
for(const text of ['6 л. - для 2010-2006 5 л. - для 2011-2013','6 л. - для 2006-2010 extra 5 л. - для 2010-2013','до 6 л. - для 2006-2010 5 л. - для 2010-2013'])assert.equal(parse(text).status,'review');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseFluidCapacities}=await j.import('../src/lib/fluid-capacity-parser.ts'),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const v=f.decision.normalizedVehicle,scope={...f.proposedScope,sourceVehicleScope:{make:v.canonicalMake,model:v.baseModel,generation:v.generation},window:{intersection:{from:f.proposedScope.window.intersection.from,to:'2009-12'}}};
for(let year=2006;year<=2009;year++)assert.equal(select(parsed.branches,year),parsed.branches[0]);
const capacity=parseFluidCapacities(parsed.branches[0].capacityText,s.systemCode);assert.equal(capacity.needsReview,false);assert.equal(capacity.capacities.length,1);
const technical={fillVolumeText:parsed.branches[0].capacityText,capacities:capacity.capacities,specificationText:s.specificationText,specifications:s.specificationsJson,viscosityGrades:s.viscosityGradesJson,replacementIntervalText:s.replacementIntervalText,recommendationText:s.recommendationText,sourceYearCapacityAttribution:{originalFillVolumeText:s.fillVolumeText,branches:parsed.branches,selectedBranch:0,overlapYears:[2010],originalSourceHash:sha(s)}};
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1',fingerprint=sha({policy,sourceRequirementId:id,vehicleVariantKey:f.vehicleVariantKey,applicability:scope,technical});
const target=f.decision.targets.find(t=>t.vehicleVariantKey===f.vehicleVariantKey&&t.independentlyValidated);assert.ok(target);
const r={id:`mtar_${fingerprint.slice(0,24)}`,sourceRequirementId:id,vehicleVariantKey:f.vehicleVariantKey,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson:scope,technicalDataJson:technical,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_HIGH','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH','technical.viscosityGrades':'SECONDARY_SOURCE_PARSED_HIGH'},evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:s.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:f.originalAssociationFingerprint,sourceRequirementHash:sha(s),rematchHash:sha(rematchRaw),independentValidation:target},state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:f.decision.status,matchScore:target.score,semanticFingerprint:fingerprint,applyEligible:false,replacesRevisionIds:[]};
const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}});
const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8');assert.equal(sha(liveRaw),reconciliation.liveHash);
const existing=[...plan.newRevisions.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey).map(fixture),...JSON.parse(liveRaw).filter(x=>x.vehicleVariantKey===r.vehicleVariantKey&&['ACTIVE','STAGED','REVIEW'].includes(x.state)).map(x=>({...x,createdAt:new Date(x.createdAt)}))];
let checks=0;
for(let year=2005;year<=2013;year++)for(let month=1;month<=12;month++)for(const engineCode of ['1AZFE','WRONG',undefined])for(const confirmedMarket of ['RU','JP',undefined]){
 const context={...scope.sourceVehicleScope,engineCode,confirmedMarket,productionMonth:`${year}-${String(month).padStart(2,'0')}`};
 const expected=year>=2006&&year<=2009&&(year!==2006||month>=3)&&engineCode==='1AZFE'&&confirmedMarket==='RU';
 const isolated=profile([fixture(r)],undefined,context),joint=profile([...existing,fixture(r)],undefined,context);assert.equal(isolated.items.length,expected?1:0);
 if(expected){const item=joint.items.find(i=>i.revisionId===r.id);assert.ok(item);assert.equal(item.capacities[0].nominalLiters,6.4);assert.equal(joint.items.some(i=>existing.some(old=>old.id===i.revisionId&&old.sourceRequirementId===id)),false);}
 else assert.equal(joint.items.some(i=>i.revisionId===r.id),false);
 assert.ok(joint.items.every(i=>!i.automaticSelectionEligible));checks++;
}
await writeFile(resolve(dir,'rav4-unambiguous-year-capacity-draft-v1.json'),JSON.stringify({kind:'RAV4_UNAMBIGUOUS_YEAR_CAPACITY_DRAFT',planHash:sha(planRaw),rematchHash:sha(rematchRaw),liveHash:sha(liveRaw),summary:{drafts:1,checks},newRevisions:[r],held:[{sourceRequirementId:id,years:[2010],reason:'TWO_LITERAL_CAPACITY_RANGES_OVERLAP_NO_MONTH_CUTOVER_EVIDENCE'}],productionApplyAllowed:false,limitations:['2006-03 through2009-12 only; no2010or2011+applicability claimed.','Legacy outside qualified new scope remains unchanged, not certified by this draft.','Secondary source, synthetic scope tests, not real VIN or deployment proof.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({drafts:1,checks,heldYears:[2010]}));
