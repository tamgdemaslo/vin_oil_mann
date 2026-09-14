import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),'781991fac076332ea36461e32f9d05c3e877a9f726d1f663987599851bdbfcbd');const plan=JSON.parse(raw);
const holdRaw=await readFile(resolve(dir,'four-date-preview-hold-v1.json'),'utf8'),hold=JSON.parse(holdRaw);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:build}=await j.import('../src/lib/mann-unified-technical-profile.ts');
function fixture(r){return {...r,reviewConfirmed:false,createdAt:new Date('2026-09-14T00:00:00Z'),run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}};}
const findings=[];
for(const c of hold.changes){
 const held=plan.newRevisions.find(r=>r.id===c.revisionId);assert.deepEqual(held,c.held);
 let baselineVisible=0,checks=0;
 for(let year=2013;year<=2021;year++)for(let month=1;month<=12;month++)for(const confirmed of [false,true]){
  const context={...held.applicabilityJson.sourceVehicleScope,engineCode:held.applicabilityJson.matchedEngineScope[0],productionMonth:`${year}-${String(month).padStart(2,'0')}`,confirmedEquipment:confirmed?[{circuit:'HYDRAULIC_STEERING'}]:[]};
  const before=build([fixture(c.original)],undefined,context),after=build([fixture(held)],undefined,context);
  baselineVisible+=before.items.length;
  assert.equal(after.items.length,0,`${held.id} ${context.productionMonth}`);
  assert.equal((after.equipmentOptions??[]).length,0);assert.equal(after.transmissionOptions.length,0);
  checks++;
 }
 assert.ok(baselineVisible>0,`Positive control never displayed ${held.id}`);
 findings.push({revisionId:held.id,checks,baselineVisible,heldVisible:0});
}
const restored=structuredClone(plan);for(const c of hold.changes)restored.newRevisions[restored.newRevisions.findIndex(r=>r.id===c.revisionId)]=c.original;
assert.equal(sha(JSON.stringify(restored,null,2)+'\n'),hold.parentPlanHash);
const report={kind:'FOUR_DATE_HOLD_REAL_PROFILE_TEST',planHash:sha(raw),holdHash:sha(holdRaw),profileHash:sha(await readFile(resolve(root,'src/lib/mann-unified-technical-profile.ts'),'utf8')),checked:findings.reduce((n,f)=>n+f.checks,0),findings,otherRevisionsPreserved:1928,productionApplyAllowed:false,limitation:'Real profile builder with synthetic completed-run metadata; verifies local preview suppression, not deployment or new date-scoped successor eligibility.'};
await writeFile(resolve(dir,'four-date-preview-hold-verification-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
