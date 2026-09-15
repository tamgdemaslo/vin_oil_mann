import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const read=p=>readFile(resolve(root,p),'utf8');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);
const matchRaw=await readFile(resolve(dir,'logan-source-coverage-rematch-v3.json'),'utf8'),match=JSON.parse(matchRaw);
assert.equal(sha(planRaw),match.planHash);
for(const [file,hash] of Object.entries(match.runtimeHashes))assert.equal(sha(await read(file)),hash);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),match.sourceHash);
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const liveRaw=await read('outputs/mann-live-audit-1789415211923/revisions.json'),live=JSON.parse(liveRaw);
assert.equal(sha(liveRaw),'53976af26ffa3b016ab3bb49836e15b1529562795c6f3a0577b2eae92cf6bf48');
const reviewRaw=await read('outputs/mann-live-audit-1789415211923/reviewDecisions.json'),reviews=JSON.parse(reviewRaw);
const denyRaw=await read('data/mann-technical-association-denylist-v1.json'),denied=new Set(JSON.parse(denyRaw).rejectedAssociationFingerprints);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1',drafts=[],actions=[];
for(const group of Map.groupBy(match.findings,f=>f.sourceRequirementId).values()){
 assert.equal(group.length,2);const [first,last]=group,s=sources.get(first.sourceRequirementId),donor=plan.newRevisions.find(r=>r.id===first.donorRevisionId);
 assert.equal(sha(s),first.originalSourceHash);assert.equal(sha(donor),first.donorHash);
 for(const f of group){assert.equal(f.originalSourceHash,sha(s));assert.equal(f.donorHash,sha(donor));assert.equal(f.vehicleVariantKey,first.vehicleVariantKey);assert.ok(f.target.independentlyValidated);assert.deepEqual(f.target.hardConflicts,[]);assert.deepEqual(f.target.reviewBlockers,[]);assert.equal(f.decision.status,'CONFIRMED_MULTI_APPLICABILITY');}
 assert.deepEqual(first.window.intersection,{from:'2013-05',to:'2014-12'});assert.deepEqual(last.window.intersection,{from:'2015-01',to:'2022-12'});
 assert.ok(['АНТИФРИЗ','МАСЛО в ТОРМОЗНУЮ СИСТЕМУ'].includes(first.ownApplication));
 assert.equal(s.powerHp,null);assert.equal(s.powerKw,null);assert.equal(s.componentModel,null);assert.equal(s.transmissionType,null);assert.equal(s.driveType,null);
 const key=first.vehicleVariantKey,predecessors=live.filter(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===key);assert.equal(predecessors.length,1);const old=predecessors[0];
 assert.equal(old.state,'STAGED');assert.equal(old.verificationStatus,'UNVERIFIED');assert.equal(old.applyEligible,false);assert.ok(!reviews.some(r=>r.revisionId===old.id));
 const action=plan.existingActions.find(a=>a.revisionId===old.id);assert.equal(action.action,'REVIEW_UNREPLACED');assert.equal(action.expectedSemanticFingerprint,old.semanticFingerprint);
 assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===key));
 const technical=structuredClone(donor.technicalDataJson);
 if(s.systemCode==='BRAKE_FLUID'){
  assert.equal(s.specificationText,'Renault Brake Fluid DOT 4+ Class 6 Периодичность замены: 90 тыс. км или 3 года');
  technical.specificationText='Renault Brake Fluid DOT 4+ Class 6';
  technical.specifications=[{type:'SOURCE_REQUIREMENT_TEXT',value:technical.specificationText},{type:'DOT',value:'DOT 4+ Class 6'}];
  technical.sourceSpecificationAttribution={policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:s.specificationText,mainSourceText:technical.specificationText,unverifiedAnalogText:null,metadataAndCautionText:'Периодичность замены: 90 тыс. км или 3 года',originalSourceHash:sha(s),sourceRequirementId:s.id,oemVerified:false,automaticAnalogSelectionAllowed:false};
 }
 assert.equal(technical.sourceSpecificationAttribution.originalSourceHash,sha(s));assert.equal(technical.sourceSpecificationAttribution.oemVerified,false);
 assert.deepEqual(technical.capacities,parse(s.fillVolumeText,s.systemCode).capacities);assert.equal(technical.fillVolumeText,s.fillVolumeText);
 const association=originalAssociationFingerprint(key,s,parse(s.fillVolumeText,s.systemCode));assert.ok(!denied.has(association));
 const applicability=structuredClone(donor.applicabilityJson);applicability.window={...first.window,intersection:{from:first.window.intersection.from,to:last.window.intersection.to},narrowedYears:{yearFrom:2013,yearTo:2022}};
 const fingerprint=sha({policy,sourceRequirementId:s.id,vehicleVariantKey:key,applicability,technical});
 const r={...structuredClone(donor),id:`mtar_${fingerprint.slice(0,24)}`,vehicleVariantKey:key,applicabilityJson:applicability,semanticFingerprint:fingerprint,replacesRevisionIds:[old.id],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceRequirementHash:sha(s),sourceAssociationFingerprint:association,independentValidation:first.target,datePartitionEvidence:{rematchHash:sha(matchRaw),partitions:group.map(f=>({window:f.window,target:f.target,decisionFingerprint:f.decision.decisionFingerprint}))},sourceRoleDonor:{id:donor.id,hash:sha(donor)},predecessorHash:sha(old)}};
 r.technicalDataJson=technical;
 assert.equal(sha({policy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technical:r.technicalDataJson}),r.semanticFingerprint);
 drafts.push(r);actions.push({...action,action:'REPLACE_WITH_PREVIEW',successorId:r.id});
}
assert.equal(drafts.length,2);
const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}});
const key=drafts[0].vehicleVariantKey,oldIds=new Set(drafts.flatMap(r=>r.replacesRevisionIds));
const existing=[...plan.newRevisions.filter(r=>r.vehicleVariantKey===key).map(fixture),...live.filter(r=>r.vehicleVariantKey===key).map(r=>({...r,createdAt:new Date(r.createdAt)}))];
const unaffected=existing.filter(r=>!oldIds.has(r.id)),combined=[...unaffected,...drafts.map(fixture)];
const month=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;let checks=0;
for(let m=month('2013-05')-1;m<=month('2022-12')+1;m++)for(const engineCode of ['K7M','K4M',undefined])for(const model of ['logan','sandero'])for(const generation of ['II','I']){
 const context={make:'renault',model,generation,engineCode,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
 const expected=m>=month('2013-05')&&m<=month('2022-12')&&engineCode==='K7M'&&model==='logan'&&generation==='II';
 const after=profile(combined,undefined,context).items,before=profile(unaffected,undefined,context).items;
 for(const r of drafts){assert.equal(after.filter(i=>i.revisionId===r.id).length,expected?1:0);if(expected){const isolated=profile([fixture(r)],undefined,context).items;assert.deepEqual(after.find(i=>i.revisionId===r.id),isolated[0]);}}
 for(const item of before)assert.ok(after.some(i=>sha(i)===sha(item)));assert.ok(!after.some(i=>oldIds.has(i.revisionId)));assert.ok(after.every(i=>!i.automaticSelectionEligible));checks++;
}
for(const r of drafts){const f=fixture(r),context={make:'renault',model:'logan',generation:'II',engineCode:'K7M',productionMonth:'2015-01'};assert.equal(profile([{...f,run:{...f.run,status:'PLANNED'}}],undefined,context).items.length,0);assert.equal(profile([f],undefined,{}).items.length,0);}
assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),sha(planRaw));
const report={kind:'LOGAN_K7M_TWO_FLUID_REPLACEMENT_DRAFTS',planHash:sha(planRaw),rematchHash:sha(matchRaw),liveHash:sha(liveRaw),reviewsHash:sha(reviewRaw),denylistHash:sha(denyRaw),summary:{drafts:2,replacements:2,profileChecks:checks,canonicalChanged:false},newRevisions:drafts,existingActionUpdates:actions,productionApplyAllowed:false,limitations:['Replacement simulated locally, not persisted or published.','Secondary source, not OEM verified. Exact K7M, generation and date scope required.','No claim of complete Logan fluid coverage or real VIN replay improvement.']};
await writeFile(resolve(dir,'logan-fluid-drafts-v2.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
