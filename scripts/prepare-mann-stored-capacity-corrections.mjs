import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const dir='outputs/mann-live-audit-1789479529769',read=n=>JSON.parse(readFileSync(`${dir}/${n}.json`,'utf8'));
const live=read('revisions'),sources=read('vehicle_fluid_requirements'),audit=read('stored-service-contexts-1789480538119');
const j=createJiti(import.meta.url,{alias:{'@':resolve('src')}}),{parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts'),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const changes=[],held=[];let checks=0;
for(const f of audit.findings.filter(f=>f.visibleInSyntheticContext)){
 const old=live.find(r=>r.id===f.id);assert.ok(old);
 if(!f.shownCapacities.length){held.push({id:old.id,reason:'CARD_VISIBLE_BUT_CAPACITIES_HIDDEN_REQUIRES_APPLICABILITY_REVIEW',scope:old.applicabilityJson});continue;}
 assert.equal(old.state,'REVIEW');assert.equal(old.reviewConfirmed,false);assert.deepEqual(old.verifiedFieldsJson,[]);assert.equal(old.applyEligible,false);
 assert.ok(old.applicabilityJson.window);const source=sources.find(s=>s.id===old.sourceRequirementId);assert.equal(source.fillVolumeText,old.technicalDataJson.fillVolumeText);
 const parsed=parse(source.fillVolumeText,source.systemCode);assert.equal(parsed.needsReview,false);
 const capacities=old.technicalDataJson.capacities.map((c,i)=>{const next=parsed.capacities[i];assert.ok(next);for(const k of ['raw','start','end','nominalLiters','minLiters','maxLiters','qualifier','filterContext','confidence'])assert.deepEqual(next[k],c[k]);if(c.kind!==next.kind){assert.equal(c.kind,'TOTAL');assert.equal(next.kind,'FULL_REPLACEMENT');}return {...c,kind:next.kind,serviceContext:next.serviceContext};});
 assert.equal(capacities.length,parsed.capacities.length);
 const replacement={...old,technicalDataJson:{...old.technicalDataJson,capacities}};
 const rows=live.filter(r=>r.vehicleVariantKey===old.vehicleVariantKey).map(r=>({...r,createdAt:new Date(r.createdAt)}));
 const revised=rows.map(r=>r.id===old.id?{...replacement,createdAt:new Date(replacement.createdAt)}:r);
 const contexts=[f.syntheticContext,{...f.syntheticContext,engineCode:'WRONG'},{...f.syntheticContext,engineCode:undefined},{...f.syntheticContext,transmissionModel:'WRONG'},{...f.syntheticContext,transmissionModel:undefined},{...f.syntheticContext,productionMonth:'2000-01'},{...f.syntheticContext,model:'WRONG'}];
 for(const context of contexts){
  const a=profile(rows,old.applicabilityJson.transmissionType,context),b=profile(revised,old.applicabilityJson.transmissionType,context);
  assert.deepEqual(a.items.map(x=>x.revisionId),b.items.map(x=>x.revisionId));
  for(const previous of a.items){const next=b.items.find(x=>x.revisionId===previous.revisionId);if(previous.revisionId!==old.id){assert.deepEqual(next,previous);continue;}
   const neutral=item=>({...item,capacity:item.capacity?{...item.capacity,serviceContext:null,serviceContextLabel:null}:item.capacity,capacities:item.capacities.map(c=>({...c,serviceContext:null,serviceContextLabel:null}))});
   assert.deepEqual(neutral(next),neutral(previous));assert.ok(next.capacities.some(c=>c.serviceContext==='FULL_REPLACEMENT'&&c.serviceContextLabel==='полная замена'));
  }checks++;
 }
 changes.push({id:old.id,expectedOldRowHash:sha(old),expectedTechnicalData:old.technicalDataJson,replacementTechnicalData:replacement.technicalDataJson,sourceId:source.id,sourceSnapshotHash:sha(source),policy:'CAPACITY_SERVICE_LABEL_ONLY_V1',allowedFields:['technicalDataJson.capacities[].kind','technicalDataJson.capacities[].serviceContext']});
}
assert.equal(changes.length,3);assert.equal(held.length,3);
const output=`${dir}/stored-capacity-label-correction-plan.json`;writeFileSync(output,JSON.stringify({changes,held,checks,productionApplyAllowed:false,limitations:['Correction plan only; not executable production SQL.','Requires exact row guards, audit receipt, rollback and production approval before applying.','Semantic fingerprint/provenance reconciliation must be explicit in final writer; no silent in-place patch.','RAV4 capacities remain held, not unlocked by this plan.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,changes:changes.length,held:held.length,checks}));
