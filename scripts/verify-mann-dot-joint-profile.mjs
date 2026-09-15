import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
import {coreScopeContains} from './lib/mann-core-scope-containment.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const version=process.argv[2]??'v1',versions={v1:{hash:'df04fc11f498bb6e4c48d0b2976e2f01ecc9442ae6fcbc7c3973c7329224c3e5',audit:'v7'},v2:{hash:'33fcc0c9b7396f57fca01ae9e062eb5faecf1e7b37a56f15a6fa4d9ec0a68596',audit:'v8'}};
assert.ok(versions[version]);
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),versions[version].hash);const plan=JSON.parse(raw);
const auditRaw=await readFile(resolve(dir,`profile-composition-audit-${versions[version].audit}.json`),'utf8'),audit=JSON.parse(auditRaw);assert.equal(audit.planSha256,sha(raw));
assert.equal(audit.capacityConflictCases,0);assert.equal(audit.droppedExpectedItems,0);
const unseen=new Set(audit.unseenCandidateRevisions),byId=new Map(plan.newRevisions.map(r=>[r.id,r]));
const held=plan.newRevisions.filter(r=>r.provenanceJson.sourcePowerReviewHold);assert.equal(held.length,3);
for(const r of held){assert.equal(r.provenanceJson.catalogPreviewEligible,false);assert.equal(r.provenanceJson.conditionalEquipmentEligible,false);assert.ok(unseen.has(r.id));}
assert.deepEqual([...audit.unexercisedCandidates].sort(),held.map(r=>r.id).sort());
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{mannTechnicalScopeMatches:matches}=await j.import('../src/lib/mann-technical-applicability.ts');
const findings=[];let monthChecks=0;
for(const id of unseen){
 const r=byId.get(id);assert.ok(r);
 if(held.some(h=>h.id===id)){findings.push({revisionId:id,reason:'EXPLICIT_POWER_REVIEW_HOLD'});continue;}
 const candidates=plan.newRevisions.filter(other=>!unseen.has(other.id)&&other.vehicleVariantKey===r.vehicleVariantKey&&other.systemCode===r.systemCode&&other.componentModel===r.componentModel&&sha(other.technicalDataJson)===sha(r.technicalDataJson));
 const exact=candidates.find(other=>sha(other.applicabilityJson)===sha(r.applicabilityJson));
 if(exact){findings.push({revisionId:id,representedBy:exact.id,reason:'EXACT_DUPLICATE'});continue;}
 const covering=candidates.find(other=>coreScopeContains(other.applicabilityJson,r.applicabilityJson));assert.ok(covering,`Unaccounted revision ${id}`);
 for(const engineCode of r.applicabilityJson.matchedEngineScope)for(let year=1900;year<=2099;year++)for(let month=1;month<=12;month++){
  const context={...r.applicabilityJson.sourceVehicleScope,engineCode,productionMonth:`${year}-${String(month).padStart(2,'0')}`};
  if(matches(r.applicabilityJson,context))assert.ok(matches(covering.applicabilityJson,context));monthChecks++;
 }
 findings.push({revisionId:id,representedBy:covering.id,reason:'IDENTICAL_TECHNICAL_CORE_SCOPE_CONTAINMENT'});
}
const previous=JSON.parse(await readFile(resolve(dir,'profile-composition-audit-v5.json'),'utf8'));
assert.deepEqual(audit.specificationDifferences,previous.specificationDifferences);
assert.equal(audit.specificationDivergencePairs,4);
const report={kind:'DOT_JOINT_PROFILE_EXPLICIT_ACCOUNTING',planHash:sha(raw),auditHash:sha(auditRaw),cases:audit.cases,individuallyExercised:audit.individuallyExercisedCandidates,held:held.length,findings,monthChecks,unaccounted:0,capacityConflicts:0,unchangedTireRimPairs:4,productionApplyAllowed:false,limitations:['Combined audit retains its strict assertions and may fail on explicitly held/contained records. This separate report accounts for them without deleting records or approving publication.','Synthetic scope endpoints plus containment-month checks, not actual VIN/production HTTP or OEM fact verification.']};
await writeFile(resolve(dir,`dot-joint-profile-accounting-${version}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined}));
