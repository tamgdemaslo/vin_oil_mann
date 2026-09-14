import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--az-fix'));
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-transmission-list-preview-2026-09-14');
const [sourceRaw,mannRaw,planRaw,coverageRaw]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'full-source-coverage.json'),'utf8')]);
const plan=JSON.parse(planRaw),coverage=JSON.parse(coverageRaw);assert.equal(coverage.planHash,sha(planRaw));assert.equal(coverage.sourceHash,sha(sourceRaw));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=overlay.requirements.filter(r=>r.make==='toyota');assert.equal(sources.length,1985);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const forms=new Set(mannMakeFormsForTest('TOYOTA'));
const rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
const coverageById=new Map(coverage.rows.map(r=>[r.requirementId,r])),results=[];
for(const source of sources){
 const decision=match(source,rows),old=coverageById.get(source.id);assert.ok(old);
 const existing=plan.newRevisions.filter(r=>r.sourceRequirementId===source.id);
 const confirmedTargets=decision.targets.filter(t=>t.independentlyValidated).map(t=>t.vehicleVariantKey).sort();
 results.push({sourceRequirementId:source.id,sourceHash:sha(overlay.originalById.get(source.id)),replayedSourceHash:sha(source),model:source.model,systemCode:source.systemCode,engineCodes:source.engineCodesJson,
 status:decision.status,previousStatus:old.sourceMatchStatus,coverageStatus:old.status,existingRevisionIds:existing.map(r=>r.id),pendingReview:old.pendingReview,
 confirmedTargets,newTargetKeys:confirmedTargets.filter(key=>!existing.some(r=>r.vehicleVariantKey===key)),reviewReasons:decision.reviewReasons,topCandidates:decision.topCandidates.slice(0,3),publicationAllowed:false});
 if(results.length%200===0)console.log(JSON.stringify({processed:results.length,total:sources.length}));
}
const counts=(rows,fn)=>Object.fromEntries([...Map.groupBy(rows,fn)].map(([k,v])=>[k,v.length]));
const noPreview=results.filter(r=>!r.existingRevisionIds.length);
const blockers=noPreview.flatMap(r=>[...new Set([...(r.topCandidates[0]?.hardConflicts??[]),...(r.topCandidates[0]?.reviewBlockers??[])])]);
const report={sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),planHash:sha(planRaw),coverageHash:sha(coverageRaw),codeHashes:Object.fromEntries(await Promise.all(['mann-fluid-matcher-v2.ts','mann-vehicle-resolver.ts','mann-engine-code-list.ts'].map(async f=>[f,sha(await readFile(resolve(root,'src/lib',f),'utf8'))]))),
 summary:{sources:results.length,mannRows:rows.length,statuses:counts(results,r=>r.status),changedStatuses:results.filter(r=>r.status!==r.previousStatus).length,noPreviewSources:noPreview.length,newConfirmedPairs:results.reduce((n,r)=>n+r.newTargetKeys.length,0),noPreviewTopBlockers:counts(blockers,r=>r)},results,productionApplyAllowed:false,
 limitation:'Fresh full-Toyota ranking of identity-corrected original sources, no date clipping or engine/gearbox inference. Confirmed matcher pairs still need source quality, capacity, applicability and publication verification. Pending old scopes remain unresolved.'};
await writeFile(resolve(dir,process.argv[2]==='--az-fix'?'toyota-az-fix-replay-v1.json':'toyota-current-replay-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
