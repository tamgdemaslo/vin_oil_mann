import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
import {coreScopeContains} from './lib/mann-core-scope-containment.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),'d1fb2649e1d2e19d1dcffcd69b132d39ba03329d17f8d94d372d828dc83c99de');const plan=JSON.parse(raw);
const auditRaw=await readFile(resolve(dir,'profile-composition-audit-v5.json'),'utf8'),audit=JSON.parse(auditRaw);
const proofRaw=await readFile(resolve(dir,'shadowed-core-scope-verification-v2.json'),'utf8'),proof=JSON.parse(proofRaw);
assert.equal(audit.planSha256,sha(raw));assert.equal(proof.planHash,sha(raw));assert.equal(proof.auditHash,sha(auditRaw));
assert.equal(audit.individuallyExercisedCandidates,plan.newRevisions.length);assert.equal(audit.capacityConflictCases,0);assert.equal(audit.droppedExpectedItems,0);
const byId=new Map(plan.newRevisions.map(r=>[r.id,r])),unseen=new Set(audit.unseenCandidateRevisions),accounted=new Set();
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{mannTechnicalScopeMatches:matches}=await j.import('../src/lib/mann-technical-applicability.ts');
let monthChecks=0;
function pair(id,otherId){const a=byId.get(id),b=byId.get(otherId);assert.ok(a&&b&&unseen.has(id)&&!unseen.has(otherId));assert.equal(a.vehicleVariantKey,b.vehicleVariantKey);assert.equal(a.systemCode,b.systemCode);assert.equal(a.componentModel,b.componentModel);assert.deepEqual(a.technicalDataJson,b.technicalDataJson);return[a,b];}
for(const p of audit.equivalentRows){const[a,b]=pair(p.revisionId,p.representedBy);assert.deepEqual(a.applicabilityJson,b.applicabilityJson);accounted.add(a.id);}
for(const f of proof.findings){assert.ok(f.coveringRevisionIds.length);for(const id of f.coveringRevisionIds){const[a,b]=pair(f.revisionId,id);assert.ok(coreScopeContains(b.applicabilityJson,a.applicabilityJson));
 for(const engineCode of a.applicabilityJson.matchedEngineScope)for(let year=1900;year<=2099;year++)for(let month=1;month<=12;month++){
  const context={...a.applicabilityJson.sourceVehicleScope,engineCode,productionMonth:`${year}-${String(month).padStart(2,'0')}`};
  if(matches(a.applicabilityJson,context))assert.ok(matches(b.applicabilityJson,context),`${a.id} ${context.productionMonth}`);monthChecks++;
 }
 }accounted.add(f.revisionId);}
assert.deepEqual([...accounted].sort(),[...unseen].sort());
const report={kind:'CURRENT_PROFILE_REPRESENTATION_ACCOUNTED',planHash:sha(raw),auditHash:sha(auditRaw),containmentHash:sha(proofRaw),candidateRevisions:1932,exactDuplicates:audit.equivalentRows.length,containedIdenticalPayloads:proof.findings.length,monthChecks,unaccounted:0,capacityConflicts:0,specificationDivergencePairs:audit.specificationDivergencePairs,productionApplyAllowed:false,limitations:['Representation and identical-payload containment only; no records deleted and no OEM/source approval.','Monthly runtime implication checks cover 1900–2099; static containment proof handles bounds. Original combined audit failed its exact-duplicate-only assertion; this separate report accounts for contained rows explicitly.']};
await writeFile(resolve(dir,'current-profile-representation-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
