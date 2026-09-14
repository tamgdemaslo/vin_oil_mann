import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
assert.ok([2,4].includes(process.argv.length));
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,process.argv[3]??'outputs/mann-scoped-merge-plan-2026-09-13-v2');
const plan=JSON.parse(await readFile(resolve(directory,'plan.json'),'utf8'));
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789334190861/revisions.json'),'utf8');
const proposalRaw=await readFile(resolve(root,process.argv[2]??'outputs/mann-engine-date-scoped-2026-09-13','scoped-proposals.ndjson'),'utf8');
assert.equal(plan.inputs.source,sha(sourceRaw));assert.equal(plan.inputs.liveRevisions,sha(liveRaw));assert.equal(plan.inputs.proposals,sha(proposalRaw));
assert.equal(plan.productionApplyAllowed,false);assert.equal(plan.writeMode,'DRY_RUN_ONLY');
const overlay=await loadIdentityOverlay(root,sourceRaw,plan.inputs.identityCorrections?.path,plan.inputs.identityCorrections?.sha256);
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const live=new Map(JSON.parse(liveRaw).map(r=>[r.id,r]));
const proposals=new Map(proposalRaw.trim().split('\n').map(JSON.parse).map(p=>[`${p.requirementId}:${p.vehicleVariantKey}`,p]));
const accounted=new Set(),successors=new Map();
for(const row of plan.newRevisions){
  const key=`${row.sourceRequirementId}:${row.vehicleVariantKey}`,p=proposals.get(key),source=sources.get(row.sourceRequirementId);
  assert.ok(p&&source&&!accounted.has(key));accounted.add(key);successors.set(row.id,row);
  assert.equal(row.applyEligible,false);assert.equal(row.state,'STAGED');assert.equal(row.verificationStatus,'UNVERIFIED');assert.deepEqual(row.verifiedFieldsJson,[]);
  assert.ok(Object.values(row.fieldConfidenceJson).every(v=>v.startsWith('SECONDARY_SOURCE_')));
  assert.equal(row.systemCode,source.systemCode);assert.equal(row.componentModel,source.componentModel);
  assert.deepEqual(row.applicabilityJson.window,p.window);
  assert.deepEqual(row.applicabilityJson.sourceVehicleScope,{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})});
  assert.notEqual(source.rawRequirementJson?.sourceIdentity?.reviewRequired,true);
  assert.deepEqual(row.provenanceJson.sourceIdentityCorrection,p.sourceIdentityCorrection??null);
  assert.equal(row.applicabilityJson.yearFrom,source.yearFrom);assert.equal(row.applicabilityJson.yearTo,source.yearTo);
  if(p.matchedEngineScope)assert.deepEqual(row.applicabilityJson.matchedEngineScope,p.matchedEngineScope);
  assert.equal(row.technicalDataJson.fillVolumeText,source.fillVolumeText);assert.equal(row.technicalDataJson.specificationText,source.specificationText);
  assert.deepEqual(row.technicalDataJson.specifications,source.specificationsJson);assert.deepEqual(row.technicalDataJson.viscosityGrades,source.viscosityGradesJson);
  assert.equal(row.provenanceJson.sourceProposalHash,sha(p));assert.equal(row.provenanceJson.sourceTechnicalReviewRequired,true);
  for(const id of row.replacesRevisionIds){const old=live.get(id);assert.ok(old);assert.equal(old.reviewConfirmed,false);assert.notEqual(old.verificationStatus,'PRIMARY_SOURCE_VERIFIED_FIELDS');}
}
const actionIds=new Set();
for(const action of plan.existingActions){
  const old=live.get(action.revisionId);assert.ok(old&&!actionIds.has(old.id));actionIds.add(old.id);
  assert.equal(action.expectedSemanticFingerprint,old.semanticFingerprint);assert.equal(action.expectedState,old.state);
  if(old.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'||old.reviewConfirmed)assert.equal(action.action,'PRESERVE_PROTECTED');
  if(action.action==='REPLACE_WITH_SCOPED_PREVIEW')assert.ok(successors.get(action.successorId)?.replacesRevisionIds.includes(old.id));
  else assert.equal(action.successorId,null);
}
assert.equal(actionIds.size,live.size);
for(const collision of plan.protectedCollisions){
  const key=`${collision.requirementId}:${collision.vehicleVariantKey}`;assert.ok(proposals.has(key)&&!accounted.has(key));accounted.add(key);
  assert.ok(collision.revisionIds.some(id=>live.get(id)?.reviewConfirmed||live.get(id)?.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'));
}
assert.equal(accounted.size,proposals.size);
const report={result:'PASS_OFFLINE_MERGE_STRUCTURE',planSha256:sha(plan),existingRevisions:live.size,proposalsAccountedFor:accounted.size,candidateRevisions:successors.size,issueCount:0,productionApplyAllowed:false,
  limitation:'Does not authorize publication, verify OEM facts, or replace runtime/SQL/backup gates.'};
await writeFile(resolve(directory,'verification.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
