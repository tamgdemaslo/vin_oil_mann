import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const planPath=resolve(dir,'plan.json'),raw=await readFile(planPath,'utf8'),plan=JSON.parse(raw);
assert.equal(sha(raw),'d1fb2649e1d2e19d1dcffcd69b132d39ba03329d17f8d94d372d828dc83c99de');
const reviewRaw=await readFile(resolve(dir,'nine-draft-power-date-review-v1.json'),'utf8');
assert.equal(sha(reviewRaw),'b9503dccdd81567ffee3f78c17fd7bb4562aa6c1825ad47861ac4efbc5e47ebb');
const findings=JSON.parse(reviewRaw).findings.filter(f=>f.status==='ENGINE_POWER_ATTRIBUTION_UNRESOLVED');
assert.equal(findings.length,3);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:build}=await j.import('../src/lib/mann-unified-technical-profile.ts');
function fixture(r){return {...r,reviewConfirmed:false,createdAt:new Date('2026-09-14T00:00:00Z'),run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}};}
const changes=[];
for(const f of findings){
 const index=plan.newRevisions.findIndex(r=>r.id===f.revisionId);assert.ok(index>=0);
 const original=structuredClone(plan.newRevisions[index]);assert.equal(original.sourceRequirementId,f.sourceRequirementId);assert.equal(original.verificationStatus,'UNVERIFIED');assert.equal(original.applyEligible,false);assert.equal(original.provenanceJson.catalogPreviewEligible,true);
 const held=structuredClone(original);
 held.provenanceJson.catalogPreviewEligible=false;
 held.provenanceJson.conditionalEquipmentEligible=false;
 held.provenanceJson.sourcePowerReviewHold={reason:'ENGINE_POWER_ATTRIBUTION_UNRESOLVED',reviewHash:sha(reviewRaw),reviewRevisionId:original.id,publicationAllowed:false};
 let baselineVisible=0,checks=0;
 for(let year=2007;year<=2018;year++)for(let month=1;month<=12;month++){
  const context={...held.applicabilityJson.sourceVehicleScope,engineCode:held.applicabilityJson.matchedEngineScope?.[0],productionMonth:`${year}-${String(month).padStart(2,'0')}`};
  const before=build([fixture(original)],undefined,context),after=build([fixture(held)],undefined,context);
  baselineVisible+=before.items.length;assert.equal(after.items.length,0);assert.equal((after.equipmentOptions??[]).length,0);assert.equal(after.transmissionOptions.length,0);checks++;
 }
 assert.ok(baselineVisible>0,`Vacuous control ${original.id}`);
 changes.push({revisionId:original.id,index,original,held,checks,baselineVisible,heldVisible:0});plan.newRevisions[index]=held;
}
const next=JSON.stringify(plan,null,2)+'\n';
const restored=structuredClone(plan);for(const c of changes)restored.newRevisions[c.index]=c.original;
assert.equal(JSON.stringify(restored,null,2)+'\n',raw);
const report={kind:'THREE_UNRESOLVED_POWER_PREVIEW_HOLD',parentPlanHash:sha(raw),heldPlanHash:sha(next),reviewHash:sha(reviewRaw),profileHash:sha(await readFile(resolve(root,'src/lib/mann-unified-technical-profile.ts'),'utf8')),checked:changes.reduce((n,c)=>n+c.checks,0),otherRevisionsPreserved:plan.newRevisions.length-3,changes,productionApplyAllowed:false,limitations:['Conservative local preview hold, not proof that the fluid itself is unsuitable.','Synthetic staging-run fixtures exercise the real profile builder; no production deployment claim.','Historical IDs and technical payloads are retained; independent engine attribution is still required.']};
await writeFile(resolve(dir,'three-power-preview-hold-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
const indent=r=>JSON.stringify(r,null,2).split('\n').map(l=>'    '+l).join('\n');
const hunks=changes.sort((a,b)=>a.index-b.index).map(c=>'@@\n'+indent(c.original).split('\n').map(l=>'-'+l).join('\n')+',\n'+indent(c.held).split('\n').map(l=>'+'+l).join('\n')+',');
process.stdout.write('*** Begin Patch\n*** Update File: '+planPath+'\n'+hunks.join('\n')+'\n*** End Patch\n');
