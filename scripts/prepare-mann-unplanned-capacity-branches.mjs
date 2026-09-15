import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const compound=process.argv[2]==='--compound';
assert.ok(process.argv.length===2||(process.argv.length===3&&compound));
const read=async p=>{const raw=await readFile(p,'utf8');return {raw,data:JSON.parse(raw)}};
const plan=await read(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'));
const reconciliation=await read(resolve(dir,'unplanned-market-predecessor-reconciliation-v2.json'));
const rematch=await read(resolve(dir,'unplanned-literal-branch-rematch-v1.json'));
assert.equal(sha(plan.raw),reconciliation.data.planHash);assert.equal(sha(rematch.raw),reconciliation.data.rematchHash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),plan.data.inputHashes.source);
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const live=await read(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'));assert.equal(sha(live.raw),reconciliation.data.liveHash);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseConditionalFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-conditions.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}});
const policy='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1',drafts=[],held=[];let checks=0;
for(const finding of reconciliation.data.findings.filter(f=>f.status==='HOLD'&&f.remainingReasons.length===1&&f.remainingReasons[0]==='CAPACITY_OR_SERVICE_CONDITION')){
 if(compound&&finding.sourceRequirementId!=='6ed12cd62693995e504c3303d5d51a4f78ae4bc466af4d6e351d188fcb6aa360')continue;
 const f=rematch.data.findings.find(r=>r.sourceRequirementId===finding.sourceRequirementId&&r.vehicleVariantKey===finding.vehicleVariantKey),s=sources.get(f.sourceRequirementId);assert.equal(sha(s),f.originalSourceHash);
 const parsed=parse(s.fillVolumeText,s.systemCode,[s.engineCodeNormalized,...(s.engineCodesJson??[])]);
 if(parsed.status!=='structured'||!compound&&parsed.branches.some(b=>b.condition.kind!=='transmission')){held.push({sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,reason:parsed.reason??'COMPOUND_REQUIRES_SEPARATE_SCOPE',fillVolumeText:s.fillVolumeText});continue;}
 const selectedBranches=compound?parsed.branches.filter(b=>b.condition.kind==='engineTransmission'&&b.condition.engineCode===f.proposedScope.matchedEngineScope[0]):parsed.branches;
 assert.equal(selectedBranches.length,2);
 assert.equal(plan.data.newRevisions.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===f.vehicleVariantKey),false);
 const target=f.decision.targets.find(t=>t.vehicleVariantKey===f.vehicleVariantKey&&t.independentlyValidated);assert.ok(target);
 const v=f.decision.normalizedVehicle,applicabilityJson={...f.proposedScope,sourceVehicleScope:{make:v.canonicalMake,model:v.baseModel,...(v.generation?{generation:v.generation}:{})}};
 if(compound)applicabilityJson.engineCodes=s.engineCodesJson;
 const capacityBranches=selectedBranches.map(b=>({condition:b.condition,sourceSegment:b.sourceSegment,applicabilityJson,validation:target,originalAssociationFingerprint:f.originalAssociationFingerprint}));
 const technicalDataJson={fillVolumeText:s.fillVolumeText,capacityBranches,specifications:s.specificationsJson,specificationText:s.specificationText,viscosityGrades:s.viscosityGradesJson,recommendationText:s.recommendationText,replacementIntervalText:s.replacementIntervalText};
 const fingerprint=sha({key:`${s.id}:${f.vehicleVariantKey}`,policy,applicabilityJson,technicalDataJson});
 const r={id:`mtar_${fingerprint.slice(0,24)}`,sourceRequirementId:s.id,vehicleVariantKey:f.vehicleVariantKey,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson,technicalDataJson,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH','technical.viscosityGrades':'SECONDARY_SOURCE_PARSED_HIGH'},evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:s.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:f.originalAssociationFingerprint,sourceRequirementHash:sha(s),rematchHash:sha(rematch.raw),independentValidation:target},state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:f.decision.status,matchScore:target.score,semanticFingerprint:fingerprint,applyEligible:false,replacesRevisionIds:[]};
 const existing=[...plan.data.newRevisions.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey).map(fixture),...live.data.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey&&['ACTIVE','STAGED','REVIEW'].includes(x.state)).map(x=>({...x,createdAt:new Date(x.createdAt)}))];
 const month=x=>Number(x.slice(0,4))*12+Number(x.slice(5))-1,from=month(applicabilityJson.window.intersection.from),to=month(applicabilityJson.window.intersection.to);
 for(let m=from-1;m<=to+1;m++)for(const engineCode of [applicabilityJson.matchedEngineScope[0],'WRONG',undefined])for(const confirmedMarket of [applicabilityJson.requiredMarket,'UNKNOWN',undefined])for(const type of [undefined,'manual','automatic','cvt','robot']){
  const context={...applicabilityJson.sourceVehicleScope,engineCode,confirmedMarket,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
  const isolated=profile([fixture(r)],type,context),joint=profile([...existing,fixture(r)],type,context);
  const inScope=m>=from&&m<=to&&engineCode===applicabilityJson.matchedEngineScope[0]&&(!applicabilityJson.requiredMarket||confirmedMarket===applicabilityJson.requiredMarket);
  assert.equal(isolated.items.length,inScope?1:0);
  if(inScope){
   const branch=selectedBranches.find(b=>(b.condition.kind==='engineTransmission'?b.condition.transmissionType:b.condition.value)===type),item=isolated.items[0];assert.equal(item.capacities.length,branch?1:0);
   for(const option of selectedBranches)assert.ok(isolated.transmissionOptions.some(o=>o.type===(option.condition.kind==='engineTransmission'?option.condition.transmissionType:option.condition.value)));
   if(branch)assert.equal(item.capacities[0].nominalLiters,branch.capacity.nominalLiters);
   const shown=joint.items.find(i=>i.revisionId===r.id);assert.ok(shown);assert.deepEqual(shown.capacities,item.capacities);
   assert.equal(joint.items.some(i=>existing.some(old=>old.id===i.revisionId&&old.sourceRequirementId===s.id)),false,'Unscoped same-source legacy volume leaked');
  }else assert.equal(joint.items.some(i=>i.revisionId===r.id),false);
  assert.ok(joint.items.every(i=>!i.automaticSelectionEligible));checks++;
 }
 const broken=structuredClone(r);broken.technicalDataJson.capacityBranches[0].sourceSegment='999 л.';
 assert.equal(profile([fixture(broken)],'manual',{...applicabilityJson.sourceVehicleScope,engineCode:applicabilityJson.matchedEngineScope[0],confirmedMarket:applicabilityJson.requiredMarket,productionMonth:applicabilityJson.window.intersection.from}).items.length,0);
 drafts.push(r);
}
assert.equal(drafts.length,compound?1:2);assert.equal(held.length,compound?0:2);
await writeFile(resolve(dir,compound?'unplanned-compound-capacity-drafts-v1.json':'unplanned-conditional-capacity-drafts-v1.json'),JSON.stringify({kind:'UNPLANNED_CONDITIONAL_CAPACITY_DRAFTS',planHash:sha(plan.raw),rematchHash:sha(rematch.raw),reconciliationHash:sha(reconciliation.raw),liveHash:sha(live.raw),summary:{drafts:drafts.length,branches:compound?2:4,checks,held:held.length},newRevisions:drafts,held,productionApplyAllowed:false,limitations:['Synthetic source-scoped contexts; no real VIN/production proof.','Gearbox choice is required for numeric coolant volume; never inferred from MANN identity.','Only independently matched engine scope is emitted; other engine branch and overlapping years are not approved.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({drafts:drafts.length,branches:compound?2:4,checks,held:held.length}));
