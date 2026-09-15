import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8'),planHash=sha(raw);
const version=process.argv[2]??'v2';
const expectedHashes={v2:'df04fc11f498bb6e4c48d0b2976e2f01ecc9442ae6fcbc7c3973c7329224c3e5',v3:'33fcc0c9b7396f57fca01ae9e062eb5faecf1e7b37a56f15a6fa4d9ec0a68596',v4:'f0ea2b6ece3d08ce654b5d3e3b8d536ca0b419e7f996ee82f2997421f7ac4339',v5:'3a3a0c2a6877dc4917c510713ff23ef7ab9a8d8ddd12abe4838622229b712e42'};
expectedHashes.v6='6b436120dd91f8b1ca909fe1fc51556cdb1906b946c2cccc895e9cc03a18e032';
expectedHashes.v7='2c95b0adc2f9584c4bfedc18d1d6ad59661afc3f9d39b4801e3b3da1a590c0f1';
expectedHashes.v8='48c9b898379db5afb9f2368b2929d8722bc46c3c4c66ca81fdb21ebe4d7aeaf1';
expectedHashes.v9='37ffc2703cec30045bf8d524a584ff9b2dbd842e34e6ffed9d81e44da51e1221';
expectedHashes.v10='8429d8f48e0c59d049ca04f69b2ee8156ceee4aff03b7b21ef94b6395af9e778';
assert.ok(expectedHashes[version]);assert.equal(planHash,expectedHashes[version]);
const plan=JSON.parse(raw);assert.equal(plan.productionApplyAllowed,false);assert.equal(plan.writeMode,'DRY_RUN_ONLY');
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const mann=parseCopy(mannRaw,'mann_filter_applications'),sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const gatesFor=r=>JSON.parse(JSON.stringify({catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,transmissionTypeCountPolicy:r.provenanceJson.explicitTransmissionTypeCount?.policy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,equipmentComponentDrivePolicy:r.provenanceJson.explicitComponentDriveCondition?.policy,equipmentModelPolicy:r.provenanceJson.explicitEquipmentModel?.policy,transmissionModelListPolicy:r.provenanceJson.explicitTransmissionModelList?.policy,automaticProductSelection:false}));
const runs=new Map(),revisions=[];
for(const r of plan.newRevisions){
 assert.ok(sources.has(r.sourceRequirementId),r.id);assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.ok(['STAGED','REVIEW'].includes(r.state));assert.deepEqual(r.verifiedFieldsJson,[]);
 const gates=gatesFor(r),key=sha(gates),runId=`mtr_scoped_${planHash.slice(0,12)}_${key.slice(0,12)}`;
 if(!runs.has(key))runs.set(key,{id:runId,mode:'STAGING',status:'PLANNED',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:gates,revisionIds:[]});
 runs.get(key).revisionIds.push(r.id);
 revisions.push({runId,originalRevisionHash:sha(r),originalRevision:r});
}
const variants=[...new Set(plan.newRevisions.map(r=>r.vehicleVariantKey))].map(key=>{
 const rows=mann.filter(r=>r.vehicleVariantKey===key);assert.ok(rows.length,key);
 const identities=[...new Map(rows.map(r=>{const identity={make:r.make,model:r.model,modelYears:r.modelYears,vehicleText:r.vehicleText,effectiveVehicleText:r.effectiveVehicleText,engineCode:r.engineCode,vehicleYears:r.vehicleYears,vehicleYearFrom:r.vehicleYearFrom,vehicleYearTo:r.vehicleYearTo,condition:r.condition,kw:r.kw,hp:r.hp};return [sha(identity),identity];})).values()];
 return {vehicleVariantKey:key,mannRows:rows.length,identities,identityStatus:identities.length===1?'SINGLE_ARCHIVED_IDENTITY':'RECONCILE_ARCHIVED_IDENTITIES',persistenceStatus:'REQUIRES_FRESH_CANONICAL_VEHICLE_SNAPSHOT'};
});
assert.equal(new Set(revisions.map(r=>r.originalRevision.id)).size,version==='v10'?2025:version==='v9'?2018:version==='v8'?2007:version==='v7'?1992:version==='v6'?1971:['v4','v5'].includes(version)?1958:1932);
assert.deepEqual(revisions.map(r=>r.originalRevision),plan.newRevisions);
const summary={revisions:revisions.length,sourceRequirements:new Set(revisions.map(r=>r.originalRevision.sourceRequirementId)).size,variantKeys:variants.length,runGateGroups:runs.size,ambiguousArchivedVehicleKeys:variants.filter(v=>v.identities.length!==1).length,explicitPowerHolds:revisions.filter(r=>r.originalRevision.provenanceJson.sourcePowerReviewHold).length};
const payload={kind:'CURRENT_SCOPED_STAGING_PAYLOAD_DRAFT',planHash,mannHash:sha(mannRaw),sourceHash:sha(sourceRaw),summary,runs:[...runs.values()],revisions,variants,existingActions:plan.existingActions,requiredGates:plan.requiredGates,productionApplyAllowed:false,writeMode:'DRY_RUN_ONLY',limitations:['Run states remain PLANNED: no invented approval, completed run or timestamps.','Full original revisions retained including holds and non-persisted audit fields; no activation or normalization.','Run grouping preserves exact policy gates; cannot combine heterogeneous rules into one run.','Archived MANN identities are evidence, not a fresh canonical-vehicle DB snapshot or authority to overwrite one.','Existing actions retained unexecuted, not automatically converted to supersession/deletion.','No SQL importer or committed rollback journal yet.']};
await writeFile(resolve(dir,`current-staging-payload-${version}.json`),JSON.stringify(payload,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
