import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..');assert.ok([3,4].includes(process.argv.length));const version=process.argv[3]??'v1';assert.ok(['v1','v2','v3'].includes(version));
const freshDir=resolve(root,process.argv[2]),planRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8');
assert.equal(sha(planRaw),version==='v3'?'6b436120dd91f8b1ca909fe1fc51556cdb1906b946c2cccc895e9cc03a18e032':version==='v2'?'f0ea2b6ece3d08ce654b5d3e3b8d536ca0b419e7f996ee82f2997421f7ac4339':'df04fc11f498bb6e4c48d0b2976e2f01ecc9442ae6fcbc7c3973c7329224c3e5');
const plan=JSON.parse(planRaw),oldRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(oldRaw),plan.inputHashes.live);
const files={};for(const name of ['report','revisions','canonicalVehicles','runs','reviewDecisions'])files[name]=await readFile(resolve(freshDir,`${name}.json`),'utf8');
const fresh=JSON.parse(files.revisions),old=JSON.parse(oldRaw),report=JSON.parse(files.report),vehicles=JSON.parse(files.canonicalVehicles),decisions=JSON.parse(files.reviewDecisions);
assert.equal(report.transaction.readOnly,'on');assert.equal(report.transaction.isolation,'repeatable read');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const equal=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const current=new Map(fresh.map(r=>[r.id,r])),previous=new Map(old.map(r=>[r.id,r])),changed=[],missing=[];
for(const r of old){const next=current.get(r.id);if(!next){missing.push(r.id);continue;}const fields=[...new Set([...Object.keys(r),...Object.keys(next)])].filter(k=>!equal(r[k],next[k]));if(fields.length)changed.push({revisionId:r.id,fields});}
const pendingIds=new Set(plan.newRevisions.map(r=>r.id)),variantKeys=new Set(plan.newRevisions.map(r=>r.vehicleVariantKey));
const actions=plan.existingActions.map(a=>{const row=current.get(a.revisionId),reviews=decisions.filter(d=>d.revisionId===a.revisionId);return {revisionId:a.revisionId,action:a.action,exists:!!row,expectedIdentityStateMatch:!!row&&row.semanticFingerprint===a.expectedSemanticFingerprint&&row.state===a.expectedState,reviewDecisionCount:reviews.length,humanReviewPresent:reviews.some(d=>d.actorType==='HUMAN'),needsProtectedReview:a.action==='REPLACE_WITH_PREVIEW'&&reviews.some(d=>d.actorType==='HUMAN')};});
const knownVehicles=new Set(vehicles.map(v=>v.variantKey));
const result={kind:'FRESH_INTEGRATION_SNAPSHOT_COMPARISON',planHash:sha(planRaw),historicalSnapshotHash:sha(oldRaw),freshHashes:Object.fromEntries(Object.entries(files).map(([n,v])=>[n,sha(v)])),freshGeneratedAt:report.generatedAt,
 summary:{historicalRevisions:old.length,freshRevisions:fresh.length,added:fresh.filter(r=>!previous.has(r.id)).length,missing:missing.length,changed:changed.length,plannedRevisionIdsAlreadyPresent:fresh.filter(r=>pendingIds.has(r.id)).length,requiredVariantKeys:variantKeys.size,requiredCanonicalVehiclesPresent:[...variantKeys].filter(k=>knownVehicles.has(k)).length,reviewDecisions:decisions.length,actionPreconditionMismatches:actions.filter(a=>!a.expectedIdentityStateMatch).length,replacementsWithHumanReviews:actions.filter(a=>a.needsProtectedReview).length},sourceTableComparison:report.sourceTables,missing,changed,missingCanonicalVehicleKeys:[...variantKeys].filter(k=>!knownVehicles.has(k)),actions,productionApplyAllowed:false,limitations:['Read-only snapshot is not a verified restoreable backup or authorization to write.','Raw full-row differences retained; timestamp formatting changes are not silently dismissed.','Presence of canonical vehicle key does not prove identical scoped canonical payload.','Historical snapshot lacks full review-decision records; no claim all fresh decisions are new.']};
await writeFile(resolve(freshDir,`integration-comparison-${version}.json`),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result.summary));
