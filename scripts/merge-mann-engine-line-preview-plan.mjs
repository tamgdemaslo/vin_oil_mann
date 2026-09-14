import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),baseDir=resolve(root,'outputs/mann-equipment-inclusive-preview-2026-09-14');
const files={base:resolve(baseDir,'plan.json'),baseVerification:resolve(baseDir,'verification.json'),
  engine:resolve(root,'outputs/mann-identity-scoped-2026-09-14/engine-line-preview-plan-v1.json')};
const raw=Object.fromEntries(await Promise.all(Object.entries(files).map(async([k,p])=>[k,await readFile(p,'utf8')])));
const {base,baseVerification,engine}=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,JSON.parse(v)]));
assert.equal(baseVerification.planSha256,sha(raw.base));assert.equal(baseVerification.issueCount,0);
assert.equal(base.productionApplyAllowed,false);assert.equal(engine.productionApplyAllowed,false);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
assert.equal(engine.inputs.source,sha(sourceRaw));assert.equal(base.inputHashes.source,sha(sourceRaw));
const liveRaw=await readFile(resolve(root,base.inputFiles.live),'utf8');
assert.equal(engine.inputs.live,sha(liveRaw));assert.equal(base.inputHashes.live,sha(liveRaw));
const live=JSON.parse(liveRaw),sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const key=r=>`${r.sourceRequirementId}:${r.vehicleVariantKey}`;
const baseKeys=new Set(base.newRevisions.map(key));
for(const revision of engine.revisions){
  assert.ok(!baseKeys.has(key(revision)),'Parent overlap needs explicit reconciliation');
  const source=sources.get(revision.sourceRequirementId);assert.ok(source);
  assert.equal(revision.systemCode,source.systemCode);assert.equal(revision.componentModel,source.componentModel);
  const capacity=parse(source.fillVolumeText,source.systemCode);assert.equal(capacity.needsReview,false);
  const data=revision.technicalDataJson;
  for(const [target,original] of Object.entries({fillVolumeText:'fillVolumeText',specificationText:'specificationText',specifications:'specificationsJson',
    viscosityGrades:'viscosityGradesJson',recommendationText:'recommendationText',replacementIntervalText:'replacementIntervalText',
    replacementKmMin:'replacementKmMin',replacementKmMax:'replacementKmMax',replacementMonths:'replacementMonths',controlIntervalText:'controlIntervalText',analogText:'analogText'}))assert.deepEqual(data[target],source[original]);
  assert.deepEqual(data.capacities,capacity.capacities);
  assert.equal(revision.provenanceJson.sourceAssociationFingerprint,originalAssociationFingerprint(revision.vehicleVariantKey,source,capacity));
  const fingerprint=sha({policy:engine.policy,sourceRequirementId:source.id,vehicleVariantKey:revision.vehicleVariantKey,
    applicability:revision.applicabilityJson,sourceEngineScope:revision.provenanceJson.sourceEngineScope,technicalData:data});
  assert.equal(revision.semanticFingerprint,fingerprint);assert.equal(revision.id,`mtar_${fingerprint.slice(0,24)}`);
  assert.equal(revision.applyEligible,false);assert.equal(revision.state,'STAGED');assert.equal(revision.verificationStatus,'UNVERIFIED');
  const old=live.filter(r=>key(r)===key(revision));
  assert.ok(old.every(r=>!r.reviewConfirmed&&r.verificationStatus!=='PRIMARY_SOURCE_VERIFIED_FIELDS'));
  assert.deepEqual(revision.replacesRevisionIds.sort(),old.map(r=>r.id).sort());
}
// Keep every engine-specific alternative; source+variant alone is not unique.
const newRevisions=[...base.newRevisions,...engine.revisions];
assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
const groups=Map.groupBy(newRevisions,key);
const existingActions=base.existingActions.map(action=>{
  const previous=live.find(r=>r.id===action.revisionId);assert.ok(previous);
  const successors=groups.get(key(previous))??[];
  if(action.action==='PRESERVE_PROTECTED'){assert.equal(successors.length,0);return action;}
  if(!successors.length)return action;
  const {successorId,successorIds,...rest}=action;
  return {...rest,action:'REPLACE_WITH_PREVIEW',...(successors.length===1?{successorId:successors[0].id}:{successorIds:successors.map(r=>r.id).sort()})};
});
const summary={...base.summary,candidateRevisions:newRevisions.length,engineLineRevisions:engine.revisions.length,
  sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,
  multipleSuccessorActions:existingActions.filter(a=>a.successorIds).length,
  actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))};
const plan={...base,kind:'ENGINE_LINE_INCLUSIVE_PREVIEW_PLAN',summary,newRevisions,existingActions,
  engineMergeInputFiles:files,engineMergeInputHashes:Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,sha(v)])),
  engineReview:engine.review,productionApplyAllowed:false,
  limitation:'Prospective offline union, pending joint composition audit. Multi-successor actions are not executable SQL; deployment and whole-source coverage unverified.'};
const output=resolve(root,'outputs/mann-engine-inclusive-preview-2026-09-14');await mkdir(output);
await writeFile(resolve(output,'plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,...summary},null,2));
