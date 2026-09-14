import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--single-engine'));
const single=process.argv[2]==='--single-engine';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,single?'outputs/mann-corolla-cvt-preview-2026-09-14':'outputs/mann-alphard-ru-preview-2026-09-14');
const [raw,sRaw,pRaw,sql]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,single?'toyota-single-engine-cvt-preview-v1.json':'corolla-cvt-coolant-preview-v1.json'),'utf8'),readFile(resolve(dir,single?'toyota-single-engine-cvt-partition-v1.json':'corolla-cvt-partition-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8')]);
const parent=JSON.parse(raw),s=JSON.parse(sRaw),p=JSON.parse(pRaw);assert.equal(s.planHash,sha(raw));assert.equal(p.supplementHash,sha(sRaw));assert.equal(s.sourceHash,sha(sql));
assert.equal(s.mannHash,sha(await readFile('/tmp/mann_filter_applications.sql','utf8')));assert.equal(s.liveHash,sha(await readFile(resolve(root,parent.inputFiles.live),'utf8')));
assert.equal(s.rawHash,sha(await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')));if(single)assert.equal(p.sourceHash,s.sourceHash);else assert.equal(p.rawHash,s.rawHash);
for(const [file,hash] of Object.entries(s.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
assert.deepEqual(s.summary,single?{sources:2,revisions:2,branchRechecks:4,checks:1860,totalBranchMonths:240,coveredBranchMonths:192,pendingBranchMonths:48,pendingIntervals:4}:{targets:2,branchRechecks:4,revisions:2,review:0,checks:2000});assert.equal(p.covered,192);assert.equal(p.noOverlaps,true);
if(single){assert.equal(p.total,240);assert.equal(p.pending,48);assert.equal(p.noGaps,true);assert.equal(s.pending.length,4);}else{assert.equal(p.totalEnginePowerTransmissionMonths,192);assert.deepEqual(p.pending,[]);}
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const live=JSON.parse(await readFile(resolve(root,parent.inputFiles.live),'utf8')),actionHistory=[],successors=new Map();
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});const {readMannCapacityBranches}=await jiti.import('../src/lib/mann-capacity-branches.ts');
const ids=new Set(parent.newRevisions.map(r=>r.id)),pairs=new Set(parent.newRevisions.map(r=>`${r.sourceRequirementId}:${r.vehicleVariantKey}`));
for(const r of s.revisions){
 assert.equal(r.state,'STAGED');assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');
 if(!single)assert.deepEqual(r.replacesRevisionIds,[]);
 else for(const id of r.replacesRevisionIds){const old=live.find(v=>v.id===id),action=parent.existingActions.find(a=>a.revisionId===id);assert.ok(old&&action);assert.equal(old.state,'REVIEW');assert.equal(old.verificationStatus,'UNVERIFIED');assert.equal(old.reviewConfirmed,false);assert.equal(action.action,'REVIEW_UNREPLACED');assert.equal(action.expectedSemanticFingerprint,old.semanticFingerprint);assert.equal(action.expectedState,old.state);assert.equal(old.sourceRequirementId,r.sourceRequirementId);assert.equal(old.vehicleVariantKey,r.vehicleVariantKey);assert.ok(!successors.has(id));successors.set(id,r.id);actionHistory.push(action);}
 const key=`${r.sourceRequirementId}:${r.vehicleVariantKey}`;assert.ok(!ids.has(r.id));assert.ok(!pairs.has(key));ids.add(r.id);pairs.add(key);
 const original=sources.get(r.sourceRequirementId);assert.ok(original);if(!single)assert.deepEqual(s.originalSource,original);
 for(const field of ['fillVolumeText','specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])assert.deepEqual(r.technicalDataJson[field],original[field]);
 assert.deepEqual(r.technicalDataJson.specifications,original.specificationsJson);assert.deepEqual(r.technicalDataJson.viscosityGrades,original.viscosityGradesJson);
 const branches=readMannCapacityBranches(r.technicalDataJson,r.applicabilityJson,r.systemCode);assert.equal(branches?.length,2);assert.deepEqual(branches.map(b=>[b.condition.value,b.capacity.nominalLiters]),single?(original.model==='avensis'?[['manual',6.3],['cvt',6.2]]:[['cvt',6.6],['manual',6.4]]):[['cvt',5.8],['manual',5.6]]);
 const policy=r.provenanceJson.catalogPreviewPolicy;assert.equal(policy,'MANN_CONDITIONAL_CAPACITY_PREVIEW_V1');
 const hash=sha({key,policy,applicabilityJson:r.applicabilityJson,technicalDataJson:r.technicalDataJson});assert.equal(hash,r.semanticFingerprint);assert.equal(r.id,`mtar_${hash.slice(0,24)}`);
}
const newRevisions=[...parent.newRevisions,...s.revisions];
if(single)for(const entry of s.pending){assert.deepEqual(entry.originalSource,sources.get(entry.sourceRequirementId));assert.equal(entry.sourceHash,sha(entry.originalSource));const r=s.revisions.find(r=>r.sourceRequirementId===entry.sourceRequirementId);assert.deepEqual(entry.sourceEngineBranch,r.provenanceJson.sourceEngineBranch);assert.ok(r.technicalDataJson.capacityBranches.some(b=>sha(b.condition)===sha(entry.condition)));}
const plan={...parent,newRevisions,toyotaCapacityHistory:{previous:parent.toyotaCapacityHistory??null,parentHash:sha(raw),parentPath:resolve(dir,'plan.json'),supplementHash:sha(sRaw),partitionHash:sha(pRaw),addedIds:s.revisions.map(r=>r.id)},summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,toyotaCapacityAdded:(parent.summary.toyotaCapacityAdded??0)+2},productionApplyAllowed:false};
if(single)plan.toyotaCapacityPending=[...(parent.toyotaCapacityPending??[]),...s.pending];
if(single){plan.toyotaCapacityHistory.actions=actionHistory;plan.existingActions=parent.existingActions.map(a=>successors.has(a.revisionId)?{...a,action:'REVIEW_SOURCE_ENGINE_SCOPE',proposedSuccessorIds:[successors.get(a.revisionId)]}:a);plan.summary.actions=Object.fromEntries([...Map.groupBy(plan.existingActions,a=>a.action)].map(([k,v])=>[k,v.length]));for(const a of plan.existingActions)for(const id of a.proposedSuccessorIds??[])assert.ok(ids.has(id));}
for(const key of Object.keys(parent).filter(k=>!['newRevisions','summary','toyotaCapacityHistory',...(single?['toyotaCapacityPending','existingActions']:[])].includes(k)))assert.deepEqual(plan[key],parent[key]);assert.deepEqual(newRevisions.slice(0,parent.newRevisions.length),parent.newRevisions);
const out=resolve(root,single?'outputs/mann-toyota-single-cvt-preview-2026-09-14':'outputs/mann-corolla-cvt-preview-2026-09-14');await mkdir(out);const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
const proof={planHash:sha(serialized),parentHash:sha(raw),added:2,preserved:parent.newRevisions.length,changedActions:actionHistory.length,newPendingIntervals:single?4:0,productionApplyAllowed:false};await writeFile(resolve(out,'merge-verification.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...proof,revisions:newRevisions.length,sources:plan.summary.sourceRequirements,out}));
