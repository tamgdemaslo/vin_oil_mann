import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),'781991fac076332ea36461e32f9d05c3e877a9f726d1f663987599851bdbfcbd');const plan=JSON.parse(planRaw);
const holdRaw=await readFile(resolve(dir,'four-date-preview-hold-v1.json'),'utf8'),hold=JSON.parse(holdRaw);
const reviewRaw=await readFile(resolve(dir,'nine-draft-power-date-review-v1.json'),'utf8'),review=JSON.parse(reviewRaw);
assert.equal(hold.parentPlanHash,review.planHash);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:build}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const runtime=r=>({...r,reviewConfirmed:false,createdAt:new Date('2026-09-14T00:00:00Z'),run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}});
const drafts=[],findings=[];let checks=0;
for(const c of hold.changes){
 assert.deepEqual(plan.newRevisions.find(r=>r.id===c.revisionId),c.held);
 const f=review.findings.find(f=>f.revisionId===c.revisionId);assert.ok(f.requiresDateNarrowing);
 const old=c.original,applicabilityJson=structuredClone(old.applicabilityJson),technicalDataJson=structuredClone(old.technicalDataJson);
 assert.ok(!technicalDataJson.capacityBranches,'Nested branch narrowing requires separate review');
 applicabilityJson.window.intersection=f.proposedWindow;
 applicabilityJson.window.narrowedYears={yearFrom:Number(f.proposedWindow.from.slice(0,4)),yearTo:Number(f.proposedWindow.to.slice(0,4))};
 applicabilityJson.window.restricted=true;
 if(Object.hasOwn(applicabilityJson,'yearFrom'))applicabilityJson.yearFrom=applicabilityJson.window.narrowedYears.yearFrom;
 if(Object.hasOwn(applicabilityJson,'yearTo'))applicabilityJson.yearTo=applicabilityJson.window.narrowedYears.yearTo;
 const policy=old.provenanceJson.catalogPreviewPolicy??old.provenanceJson.conditionalEquipmentPolicy;
 assert.ok(['MANN_ENGINE_DATE_SCOPED_PREVIEW_V1','USER_CONFIRMED_EQUIPMENT_V1'].includes(policy));
 const fingerprint=policy==='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1'?sha({policy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,applicability:applicabilityJson,technicalData:technicalDataJson}):sha({policy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,applicabilityJson,technicalDataJson});
 const next={...old,id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,applicabilityJson,technicalDataJson,provenanceJson:{...old.provenanceJson,sourceDateRepair:{originalRevisionId:old.id,originalRevisionHash:sha(old),reviewHash:sha(reviewRaw),sourceDatePrecision:'YEAR',unverifiedMonthsWithinBoundaryYear:true}}};
 assert.ok(!plan.newRevisions.some(r=>r.id===next.id));assert.deepEqual(next.technicalDataJson,old.technicalDataJson);
 let positive=0;
 for(let y=2013;y<=2021;y++)for(let m=1;m<=12;m++)for(const confirm of [false,true]){
  const productionMonth=`${y}-${String(m).padStart(2,'0')}`,context={...applicabilityJson.sourceVehicleScope,engineCode:applicabilityJson.matchedEngineScope[0],productionMonth,confirmedEquipment:confirm?[{circuit:'HYDRAULIC_STEERING'}]:[]};
  const before=build([runtime(old)],undefined,context).items,actual=build([runtime(next)],undefined,context).items;
  const inRange=productionMonth>=f.proposedWindow.from&&productionMonth<=f.proposedWindow.to;
  assert.equal(actual.length,inRange?before.length:0,`${old.id} ${productionMonth}`);positive+=actual.length;checks++;
 }
 assert.ok(positive>0);assert.equal(next.applyEligible,false);assert.equal(next.verificationStatus,'UNVERIFIED');
 drafts.push(next);findings.push({originalRevisionId:old.id,successorId:next.id,oldWindow:f.oldWindow,newWindow:f.proposedWindow,excludedPrefix:{from:f.oldWindow.from,to:'2014-12'},positiveCases:positive});
}
assert.equal(drafts.length,4);assert.equal(new Set(drafts.map(d=>d.id)).size,4);
const report={kind:'FOUR_DATE_SCOPED_SUCCESSORS',planHash:sha(planRaw),holdHash:sha(holdRaw),reviewHash:sha(reviewRaw),drafts,findings,monthEquipmentChecks:checks,productionApplyAllowed:false,requiredGates:['INDEPENDENT_SUCCESSOR_VERIFICATION','CANONICAL_MERGE_WITH_HISTORY_AND_REFERENCE_UPDATES','SOURCE_QUALITY_AND_OEM_CONFIRMATION'],limitation:'Source year envelopes begin in 2015, not proof of a January factory change. Original technical and equipment conditions retained; older prefixes remain unresolved, not discarded.'};
await writeFile(resolve(dir,'four-date-successors-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,drafts:undefined}));
