import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-transmission-list-preview-2026-09-14');
const [raw,sRaw,pRaw,sourceRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'alphard-ru-preview-supplement-v1.json'),'utf8'),readFile(resolve(dir,'alphard-ru-market-partition-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8')]);
const parent=JSON.parse(raw),s=JSON.parse(sRaw),partition=JSON.parse(pRaw);
assert.equal(s.planHash,sha(raw));assert.equal(partition.supplementHash,sha(sRaw));assert.equal(s.sourceHash,sha(sourceRaw));
assert.equal(s.mannHash,sha(await readFile('/tmp/mann_filter_applications.sql','utf8')));
assert.equal(s.liveHash,sha(await readFile(resolve(root,parent.inputFiles.live),'utf8')));
assert.equal(s.auditHash,sha(await readFile(resolve(dir,'toyota-new-pair-source-branches-v1.json'),'utf8')));assert.equal(partition.sourceEvidenceHash,s.auditHash);
for(const [file,hash] of Object.entries(s.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
assert.deepEqual(s.summary,{considered:3,revisions:3,review:0,checks:2664,totalBranchMonths:396,coveredBranchMonths:153,pendingBranchMonths:243,pendingIntervals:6});
assert.equal(partition.noGaps,true);assert.equal(partition.noOverlaps,true);
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r])),ids=new Set(parent.newRevisions.map(r=>r.id)),pairs=new Set(parent.newRevisions.map(r=>`${r.sourceRequirementId}:${r.vehicleVariantKey}`));
for(const r of s.revisions){
 assert.equal(r.applyEligible,false);assert.equal(r.state,'STAGED');assert.equal(r.verificationStatus,'UNVERIFIED');
 assert.ok(!ids.has(r.id));ids.add(r.id);const pair=`${r.sourceRequirementId}:${r.vehicleVariantKey}`;assert.ok(!pairs.has(pair));pairs.add(pair);
 assert.deepEqual(r.replacesRevisionIds,[],'Predecessor reconciliation requires a separate review');
 const original=sources.get(r.sourceRequirementId);assert.ok(original);
 for(const key of ['fillVolumeText','specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])assert.deepEqual(r.technicalDataJson[key],original[key]);
 assert.deepEqual(r.technicalDataJson.specifications,original.specificationsJson);assert.deepEqual(r.technicalDataJson.viscosityGrades,original.viscosityGradesJson);
 assert.equal(r.applicabilityJson.requiredMarket,'RU');assert.deepEqual(r.applicabilityJson.matchedEngineScope,['2GR-FKS']);assert.deepEqual(r.applicabilityJson.window.intersection,{from:'2018-10',to:'2022-12'});
 assert.equal(r.provenanceJson.sourceMarketBranch.powerHp,300);assert.equal(r.provenanceJson.sourceMarketBranch.requiredMarket,'RU');
 const hash=sha({policy:r.provenanceJson.catalogPreviewPolicy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technicalData:r.technicalDataJson});
 assert.equal(hash,r.semanticFingerprint);assert.equal(r.id,`mtar_${hash.slice(0,24)}`);
}
for(const p of s.pending){assert.equal(sha(sources.get(p.sourceRequirementId)),p.sourceHash);assert.deepEqual(p.originalSource,sources.get(p.sourceRequirementId));assert.equal(p.requiredMarket,p.sourceBranch.requiredMarket);}
const newRevisions=[...parent.newRevisions,...s.revisions];
const plan={...parent,newRevisions,toyotaMarketPending:[...(parent.toyotaMarketPending??[]),...s.pending],toyotaMarketHistory:{previous:parent.toyotaMarketHistory??null,parentPath:resolve(dir,'plan.json'),parentHash:sha(raw),supplementHash:sha(sRaw),partitionHash:sha(pRaw),addedIds:s.revisions.map(r=>r.id)},summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,toyotaMarketAdded:(parent.summary.toyotaMarketAdded??0)+3,toyotaMarketPendingIntervals:(parent.toyotaMarketPending??[]).length+s.pending.length},productionApplyAllowed:false};
for(const key of Object.keys(parent).filter(k=>!['newRevisions','summary','toyotaMarketPending','toyotaMarketHistory'].includes(k)))assert.deepEqual(plan[key],parent[key]);
assert.deepEqual(plan.newRevisions.slice(0,parent.newRevisions.length),parent.newRevisions);
const out=resolve(root,'outputs/mann-alphard-ru-preview-2026-09-14');await mkdir(out);
const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
const verification={planHash:sha(serialized),parentHash:sha(raw),added:3,preserved:parent.newRevisions.length,pending:6,changedActions:0,productionApplyAllowed:false};
await writeFile(resolve(out,'merge-verification.json'),JSON.stringify(verification,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...verification,revisions:newRevisions.length,sources:plan.summary.sourceRequirements,out}));
