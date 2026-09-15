import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw),repairRaw=await readFile(resolve(dir,'literal-drive-date-repair-v1.json'),'utf8'),repair=JSON.parse(repairRaw);assert.equal(sha(planRaw),repair.afterPlanHash);
const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8'),live=JSON.parse(liveRaw);
const replaced=new Set(plan.existingActions.filter(a=>a.action==='REPLACE_WITH_PREVIEW').map(a=>a.revisionId));assert.equal(replaced.size,307);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const fixture=r=>({...r,createdAt:new Date('2026-09-15'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}});
const all=[...plan.newRevisions.map(fixture),...live.filter(r=>!replaced.has(r.id)&&['ACTIVE','STAGED','REVIEW'].includes(r.state)).map(r=>({...r,createdAt:new Date(r.createdAt)}))],findings=[];let checks=0,positiveChecks=0;
for(const c of repair.changes){
 const r=plan.newRevisions.find(r=>r.id===c.after.id);assert.deepEqual(r,c.after);const a=r.applicabilityJson;
 const group=all.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey),n=x=>Number(x.slice(0,4))*12+Number(x.slice(5))-1,from=n(c.before.applicabilityJson.window.intersection.from),to=n(c.before.applicabilityJson.window.intersection.to);
 for(let m=from;m<=to;m++)for(const confirmedDrive of [undefined,'2WD','4WD']){
  const context={...a.sourceVehicleScope,engineCode:a.matchedEngineScope[0],productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`,confirmedMarket:a.requiredMarket,confirmedDrive};
  const result=profile(group,undefined,context),sourceItems=result.items.filter(i=>group.some(x=>x.id===i.revisionId&&x.sourceRequirementId===r.sourceRequirementId));
  const shouldHide=(a.requiredVehicleDrive&&confirmedDrive!==a.requiredVehicleDrive)||context.productionMonth<a.window.intersection.from||context.productionMonth>a.window.intersection.to;
  if(shouldHide&&sourceItems.length)findings.push({revisionId:r.id,sourceRequirementId:r.sourceRequirementId,action:c.action,context,leakedRevisionIds:sourceItems.map(i=>i.revisionId)});
  if(!shouldHide){assert.ok(sourceItems.some(i=>i.revisionId===r.id));positiveChecks++;}
  assert.ok(result.items.every(i=>!i.automaticSelectionEligible));checks++;
 }
}
const report={kind:'DRIVE_DATE_REPAIR_JOINT_LEGACY_CHECK',planHash:sha(planRaw),repairHash:sha(repairRaw),liveHash:sha(liveRaw),checks,positiveChecks,leakContexts:findings.length,findings,productionApplyAllowed:false,limitations:['Synthetic full-month source contexts; archived legacy with307planned supersessions simulated, not a production DB.','Checks repaired source identities, not every unrelated fluid or all VINs.']};
await writeFile(resolve(dir,'literal-drive-date-joint-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:findings.slice(0,2)}));
