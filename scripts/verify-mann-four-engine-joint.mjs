import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(raw);
const draftRaw=await readFile(resolve(dir,'four-engine-restoration-drafts-v1.json'),'utf8'),batch=JSON.parse(draftRaw);
assert.equal(sha(raw),batch.planHash);
const replacements=new Map(batch.drafts.map(d=>[d.before.id,d.after]));
for(const d of batch.drafts){
 assert.deepEqual(plan.newRevisions.find(r=>r.id===d.before.id),d.before);
 const restored=structuredClone(d.after);restored.id=d.before.id;restored.semanticFingerprint=d.before.semanticFingerprint;
 restored.applicabilityJson.matchedEngineScope=d.before.applicabilityJson.matchedEngineScope;
 delete restored.provenanceJson.engineScopeRestoration;assert.deepEqual(restored,d.before);
}
const fixture=r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,transmissionTypeCountPolicy:r.provenanceJson.explicitTransmissionTypeCount?.policy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,equipmentComponentDrivePolicy:r.provenanceJson.explicitComponentDriveCondition?.policy,equipmentModelPolicy:r.provenanceJson.explicitEquipmentModel?.policy,transmissionModelListPolicy:r.provenanceJson.explicitTransmissionModelList?.policy,automaticProductSelection:false}}});
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);
const protectedIds=new Set(plan.existingActions.filter(a=>a.action==='PRESERVE_PROTECTED').map(a=>a.revisionId));
const primary=JSON.parse(liveRaw).filter(r=>protectedIds.has(r.id)).map(r=>({...r,createdAt:new Date(r.createdAt)}));
const oldRows=[...plan.newRevisions.map(fixture),...primary],newRows=[...plan.newRevisions.map(r=>fixture(replacements.get(r.id)??r)),...primary];
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const fingerprint=i=>sha({systemCode:i.systemCode,componentModel:i.componentModel,capacities:i.capacities,specifications:i.specifications,viscosityGrades:i.viscosityGrades,recommendation:i.recommendation,replacementInterval:i.replacementInterval});
const month=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
let cases=0;const seen=new Set(),contexts=new Map(),conflicts=new Map();
for(const d of batch.drafts){
 const scope=d.after.applicabilityJson,win=scope.window.intersection;
 for(let m=month(win.from)-1;m<=month(win.to)+1;m++)for(const engineCode of [...new Set([...d.originalSource.engineCodesJson,'UNRELATED_TEST_ENGINE'])]){
  const context={...scope.sourceVehicleScope,engineCode,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
  contexts.set(sha({variant:d.after.vehicleVariantKey,context}),{variant:d.after.vehicleVariantKey,context});
 }
}
for(const {variant,context} of contexts.values())for(const type of [undefined,'automatic','manual','cvt','robot']){
 const before=oldRows.filter(r=>r.vehicleVariantKey===variant),after=newRows.filter(r=>r.vehicleVariantKey===variant);
 const old=profile(before,type,context),now=profile(after,type,context),actual=new Set(now.items.map(fingerprint));
 for(const item of old.items)assert.ok(actual.has(fingerprint(item)),'Existing fluid payload lost');
 const isolated=after.flatMap(r=>profile([r],type,context).items),primarySystems=new Set(isolated.filter(i=>i.sourceStatus==='primary_source').map(i=>i.systemCode));
 const expected=isolated.filter(i=>i.sourceStatus==='primary_source'||!primarySystems.has(i.systemCode));
 assert.deepEqual(actual,new Set(expected.map(fingerprint)),'Joint profile lost isolated payload');
 assert.ok(now.items.every(i=>!i.automaticSelectionEligible));
 for(const item of now.items)seen.add(item.revisionId);
 for(const [key,items] of Map.groupBy(now.items,i=>`${i.systemCode}:${i.componentModel??''}`)){
  const prior=old.items.filter(i=>`${i.systemCode}:${i.componentModel??''}`===key);
  for(let i=0;i<items.length;i++)for(let k=i+1;k<items.length;k++){
   const a=items[i],b=items[k];if(sha(a.capacities)===sha(b.capacities)&&sha(a.specifications)===sha(b.specifications))continue;
   const priorPrints=new Set(prior.map(fingerprint));if(priorPrints.has(fingerprint(a))&&priorPrints.has(fingerprint(b)))continue;
   conflicts.set(sha({variant,key,a:fingerprint(a),b:fingerprint(b)}),{variant,key,context,type,items:[a,b]});
  }
 }
 cases++;
}
assert.equal(conflicts.size,0,'New conflicting fluid payloads');
for(const d of batch.drafts)assert.ok(seen.has(d.after.id),'Restored revision never visible jointly');
const report={kind:'FOUR_ENGINE_RESTORATION_JOINT_VERIFICATION',planHash:sha(raw),draftHash:sha(draftRaw),summary:{cases,variants:new Set(batch.drafts.map(d=>d.after.vehicleVariantKey)).size,restoredRevisionsSeen:batch.drafts.filter(d=>seen.has(d.after.id)).length,newConflicts:conflicts.size},productionApplyAllowed:false,limitations:['Local synthetic completed staging runs; no deployed VIN or database writes.','Base vehicle contexts across every affected month and engine, with five transmission types; not every equipment confirmation combination.','Canonical plan and downstream reports unchanged.']};
await writeFile(resolve(dir,'four-engine-restoration-joint-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary));
