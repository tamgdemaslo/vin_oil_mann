import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-disputed-year-preview-2026-09-14');
const b7=process.argv.includes('--b7');
const cbab=process.argv.includes('--cbab'),dates=process.argv.includes('--dates')||cbab;
assert.ok(process.argv.length===2||(process.argv.length===3&&(b7||dates)));
const parentPath=resolve(cbab?resolve(root,'outputs/mann-body-quarantined-preview-2026-09-14'):dates?resolve(root,'outputs/mann-passat-b7-inclusive-preview-2026-09-14'):b7?resolve(root,'outputs/mann-passat-inclusive-preview-2026-09-14'):dir,'plan.json');
const supplementPath=resolve(dir,cbab?'passat-date-preview-supplement-v2.json':dates?'passat-date-preview-supplement-v1.json':`passat-preview-supplement-v${b7?3:2}.json`);
const [baseRaw,additionRaw,sourceRaw,liveRaw]=await Promise.all([readFile(parentPath,'utf8'),
  readFile(supplementPath,'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile(resolve(root,'outputs/mann-live-audit-1789334190861/revisions.json'),'utf8')]);
const base=JSON.parse(baseRaw),addition=JSON.parse(additionRaw),live=JSON.parse(liveRaw);
assert.equal(base.inputHashes.source,sha(sourceRaw));assert.equal(addition.inputs.source,sha(sourceRaw));
assert.equal(base.inputHashes.live,sha(liveRaw));assert.equal(addition.inputs.live,sha(liveRaw));
assert.equal(base.productionApplyAllowed,false);assert.equal(addition.productionApplyAllowed,false);
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
if(dates){
  const proof=JSON.parse(await readFile(resolve(dir,`passat-date-partition-verification-v${cbab?2:1}.json`),'utf8'));
  assert.equal(proof.supplementHash,sha(additionRaw));
  assert.equal(proof.months,proof.coveredMonths+proof.pendingMonths);
  assert.equal(proof.pendingScopes,addition.pendingSourceScopes.length);
  if(!cbab)assert.ok(!base.passatDatePending&&!base.passatDateReview,'Date supplement already merged');
  for(const entry of addition.pendingSourceScopes){
    assert.deepEqual(entry.originalSource,sources.get(entry.requirementId));
    assert.equal(entry.sourceHash,sha(entry.originalSource));assert.equal(entry.publicationAllowed,false);
  }
}
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const key=r=>`${r.sourceRequirementId}:${r.vehicleVariantKey}`,keys=new Set(base.newRevisions.map(key));
const existingIds=new Map(base.newRevisions.map(r=>[r.id,r]));
if(b7||cbab){
  const previous=JSON.parse(await readFile(resolve(dir,cbab?'passat-date-preview-supplement-v1.json':'passat-preview-supplement-v2.json'),'utf8'));
  for(const r of previous.revisions){
    assert.deepEqual(existingIds.get(r.id),r,'Parent must preserve previous supplement');
    const fresh=addition.revisions.find(n=>n.id===r.id);assert.ok(fresh,'Previous scope disappeared');
    for(const field of ['semanticFingerprint','applicabilityJson','technicalDataJson','sourceRequirementId','vehicleVariantKey'])assert.deepEqual(fresh[field],r[field]);
  }
  const reviewIdentity=r=>({requirementId:r.requirementId,vehicleVariantKey:r.vehicleVariantKey,window:r.window,reasons:r.reasons});
  if(!cbab)assert.deepEqual(addition.review.map(reviewIdentity),base.passatReview.map(reviewIdentity),'Review obligations changed');
  else{
    assert.deepEqual(base.passatDatePending,previous.pendingSourceScopes);
    assert.deepEqual(base.passatDateReview,previous.review);
    assert.deepEqual(addition.review,[]);
    for(const r of previous.review)assert.ok(addition.revisions.some(n=>n.sourceRequirementId===r.requirementId));
    const pendingSet=items=>{
      const out=new Set();
      for(const item of items)for(const engine of item.matchedEngineScope){
        const start=Number(item.window.from.slice(0,4))*12+Number(item.window.from.slice(5))-1;
        const end=Number(item.window.to.slice(0,4))*12+Number(item.window.to.slice(5))-1;
        for(let m=start;m<=end;m++)out.add(`${item.requirementId}:${engine}:${m}`);
      }
      return out;
    };
    const before=pendingSet(previous.pendingSourceScopes),after=pendingSet(addition.pendingSourceScopes);
    const added=addition.revisions.filter(r=>!existingIds.has(r.id));
    const covered=pendingSet(added.map(r=>({requirementId:r.sourceRequirementId,matchedEngineScope:r.applicabilityJson.matchedEngineScope,window:r.applicabilityJson.window.intersection})));
    assert.deepEqual(new Set([...before].filter(k=>!covered.has(k))),after,'Only newly covered months may leave pending queue');
    assert.ok([...covered].every(k=>before.has(k)),'Unexpected date expansion');
  }
}
const additions=addition.revisions.filter(r=>!(b7||cbab)||!existingIds.has(r.id));
for(const r of additions){
  assert.ok(!keys.has(key(r)));assert.deepEqual(r.replacesRevisionIds,[]);
  assert.ok(!live.some(old=>key(old)===key(r)),'Existing predecessor requires explicit reconciliation');
  const s=sources.get(r.sourceRequirementId);assert.ok(s);
  assert.equal(r.systemCode,s.systemCode);assert.equal(r.componentModel,s.componentModel);
  const capacity=parse(s.fillVolumeText,s.systemCode);assert.equal(capacity.needsReview,false);
  assert.deepEqual(r.technicalDataJson.capacities,capacity.capacities);
  for(const [target,source] of Object.entries({fillVolumeText:'fillVolumeText',specificationText:'specificationText',
    specifications:'specificationsJson',viscosityGrades:'viscosityGradesJson',recommendationText:'recommendationText',
    replacementIntervalText:'replacementIntervalText',replacementKmMin:'replacementKmMin',replacementKmMax:'replacementKmMax',
    replacementMonths:'replacementMonths',controlIntervalText:'controlIntervalText',analogText:'analogText'}))assert.deepEqual(r.technicalDataJson[target],s[source]);
  assert.equal(r.provenanceJson.sourceAssociationFingerprint,originalAssociationFingerprint(r.vehicleVariantKey,s,capacity));
  const fingerprint=sha({policy:r.provenanceJson.catalogPreviewPolicy,sourceRequirementId:s.id,vehicleVariantKey:r.vehicleVariantKey,
    applicability:r.applicabilityJson,technicalData:r.technicalDataJson});
  assert.equal(r.semanticFingerprint,fingerprint);assert.equal(r.id,`mtar_${fingerprint.slice(0,24)}`);
  assert.equal(r.state,'STAGED');assert.equal(r.verificationStatus,'UNVERIFIED');assert.equal(r.applyEligible,false);
}
const newRevisions=[...base.newRevisions,...additions];assert.equal(new Set(newRevisions.map(r=>r.id)).size,newRevisions.length);
const plan={...base,kind:'PASSAT_INCLUSIVE_OFFLINE_PREVIEW',newRevisions,
  passatMerge:{parentPath,parentHash:sha(baseRaw),supplementPath,supplementHash:sha(additionRaw)},
  passatReview:(b7||dates)?base.passatReview:addition.review,
  ...(dates?{passatDatePending:addition.pendingSourceScopes,passatDateReview:addition.review}:{}),
  ...(cbab?{passatDateReconciliation:{priorPending:base.passatDatePending,priorReview:base.passatDateReview,
    reason:'Specific chassis evidence excludes CC competitor; only newly covered engine months removed from pending',productionApplyAllowed:false}}:{}),
  summary:{...base.summary,candidateRevisions:newRevisions.length,
    sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,passatAdded:((b7||dates)?base.summary.passatAdded:0)+additions.length,
    passatReview:dates?base.passatReview.length:addition.review.length,
    ...(dates?{passatDatePendingScopes:addition.pendingSourceScopes.length,passatDateReview:addition.review.length}:{})},
  productionApplyAllowed:false,limitation:'Offline additive union only. Original actions and held scopes preserved. Requires joint composition and source/OEM verification; not production VIN coverage.'};
assert.deepEqual(plan.existingActions,base.existingActions);
for(const field of ['rawDateWithheld','sourceQualityHeld','sourceBodyHeld','disputedYearPending','protectedBranches'])assert.deepEqual(plan[field],base[field]);
const out=resolve(root,`outputs/mann-passat${cbab?'-cbab':dates?'-date':b7?'-b7':''}-inclusive-preview-2026-09-14`);await mkdir(out);
const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
await writeFile(resolve(out,'merge-verification.json'),JSON.stringify({planHash:sha(serialized),parentHash:sha(baseRaw),additionHash:sha(additionRaw),
  priorRecordsUnchanged:base.newRevisions.length,added:additions.length,actionsUnchanged:true,heldQueuesPreserved:true,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({out,...plan.summary},null,2));
