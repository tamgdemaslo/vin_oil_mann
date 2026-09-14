import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),'f22d1056d9af7913ee5b2521254b12763bb4e2e3d488267fbb7e28aa333be90a');const plan=JSON.parse(planRaw);
const transitionRaw=await readFile(resolve(dir,'dot-token-transition-v4.json'),'utf8');assert.equal(sha(transitionRaw),'0a41c9207446bb0f4a9ac43ad6e80ceeea964b0ea17cca0539ca1521492dedb9');
const changes=new Map(JSON.parse(transitionRaw).changes.map(c=>[c.id,c]));
const audit=JSON.parse(await readFile(resolve(dir,'dot-plus-loss-v1.json'),'utf8'));assert.equal(audit.planHash,sha(planRaw));
const expectedIds=new Set(audit.findings.flatMap(f=>f.revisions.map(r=>r.revisionId)));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:build}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const fixture=r=>({...r,reviewConfirmed:false,createdAt:new Date('2026-09-14T00:00:00Z'),run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}});
const drafts=[],findings=[];let checks=0;
for(const old of plan.newRevisions.filter(r=>expectedIds.has(r.id))){
 const c=changes.get(old.sourceRequirementId);assert.ok(c);
 const before=c.before.filter(s=>s.type==='DOT'),after=c.after.filter(s=>s.type==='DOT');assert.equal(before.length,1);assert.equal(after.length,1);assert.equal(after[0].value,before[0].value+'+');
 const technicalDataJson=structuredClone(old.technicalDataJson);const dot=technicalDataJson.specifications.filter(s=>s.type==='DOT');assert.equal(dot.length,1);assert.equal(dot[0].value,before[0].value);dot[0].value=after[0].value;
 assert.ok(technicalDataJson.specificationText.includes(after[0].value));
 const policy=old.provenanceJson.catalogPreviewPolicy;assert.equal(policy,'MANN_ENGINE_DATE_SCOPED_PREVIEW_V1');
 const fingerprint=sha({policy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,applicability:old.applicabilityJson,technicalData:technicalDataJson});
 const next={...old,id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,technicalDataJson,provenanceJson:{...old.provenanceJson,dotTokenRepair:{originalRevisionId:old.id,originalRevisionHash:sha(old),transitionHash:sha(transitionRaw),before:before[0].value,after:after[0].value}}};
 assert.equal(next.applyEligible,false);assert.equal(next.verificationStatus,'UNVERIFIED');assert.ok(!plan.newRevisions.some(r=>r.id===next.id));
 let positive=0;
 for(let year=1990;year<=2030;year++)for(const month of [1,6,12]){
  const context={...old.applicabilityJson.sourceVehicleScope,engineCode:old.applicabilityJson.matchedEngineScope?.[0],productionMonth:`${year}-${String(month).padStart(2,'0')}`};
  const a=build([fixture(old)],undefined,context),b=build([fixture(next)],undefined,context);
  assert.equal(a.items.length,b.items.length);assert.deepEqual(a.transmissionOptions,b.transmissionOptions);assert.deepEqual(a.equipmentOptions,b.equipmentOptions);
  for(let i=0;i<a.items.length;i++){
   const expected=structuredClone(a.items[i]);assert.ok(expected.specifications.includes(before[0].value));
   expected.revisionId=next.id;expected.specifications=expected.specifications.map(s=>s===before[0].value?after[0].value:s);
   assert.deepEqual(b.items[i],expected);positive++;
  }checks++;
 }
 if(old.provenanceJson.sourcePowerReviewHold)assert.equal(positive,0);else assert.ok(positive>0,`No positive fixture ${old.id}`);
 drafts.push(next);findings.push({originalRevisionId:old.id,originalRevisionHash:sha(old),successorId:next.id,visibleCases:positive,held:!!old.provenanceJson.sourcePowerReviewHold});
}
assert.equal(drafts.length,82);assert.equal(new Set(drafts.map(r=>r.id)).size,82);
const report={kind:'DOT_TOKEN_SUCCESSOR_BATCH',planHash:sha(planRaw),transitionHash:sha(transitionRaw),drafts,findings,profileChecks:checks,productionApplyAllowed:false,limitations:['Real profile builder with synthetic staging-run metadata, not deployed production verification.','Only extracted DOT token changes; scopes, original text, capacities and holds remain unchanged.','Drafts require independent merge/reference verification; this script does not modify the canonical plan.']};
await writeFile(resolve(dir,'dot-successors-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,drafts:undefined,findings:undefined}));
