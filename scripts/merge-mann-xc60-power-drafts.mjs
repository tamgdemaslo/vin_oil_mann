import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),path=resolve(dir,'plan.json'),reportPath=resolve(dir,'xc60-power-merge-operations-v1.json');
const mode=process.argv[2],raw=await readFile(path,'utf8');
if(mode==='prepare'){
 const draftRaw=await readFile(resolve(dir,'xc60-scoped-preview-drafts-v2.json'),'utf8'),draft=JSON.parse(draftRaw),jointRaw=draftRaw,joint=draft,plan=JSON.parse(raw);
 assert.equal(sha(await readFile(resolve(root,'scripts/prepare-mann-xc60-scoped-drafts.mjs'),'utf8')),draft.builderHash);
 assert.equal(sha(await readFile(resolve(dir,'xc60-source-branch-preflight-v2.json'),'utf8')),draft.preflightHash);
 assert.equal(sha(raw),draft.planHash);assert.equal(joint.planHash,sha(raw));assert.equal(joint.summary.newConflicts,0);assert.equal(joint.summary.newRevisionsSeen,3);
 assert.equal(draft.revisions.length,3);assert.equal(draft.review.length,37);assert.equal(draft.pending.length,3);
 const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
 for(const r of draft.revisions){
  assert.ok(!plan.newRevisions.some(p=>p.id===r.id||p.sourceRequirementId===r.sourceRequirementId&&p.vehicleVariantKey===r.vehicleVariantKey));
  assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.deepEqual(r.verifiedFieldsJson,[]);assert.deepEqual(r.replacesRevisionIds,[]);
  assert.ok(!live.some(p=>p.sourceRequirementId===r.sourceRequirementId&&p.vehicleVariantKey===r.vehicleVariantKey));
  const fp=sha({policy:r.provenanceJson.catalogPreviewPolicy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technicalData:r.technicalDataJson});assert.equal(fp,r.semanticFingerprint);assert.equal(r.id,`mtar_${fp.slice(0,24)}`);
 }
 const deltaRaw=await readFile(resolve(dir,'xc60-power-transition-verification-v1.json'),'utf8'),delta=JSON.parse(deltaRaw);
 assert.equal(sha(deltaRaw),draft.deltaHash);assert.equal(delta.planHash,sha(raw));assert.equal(delta.afterHash,draft.preflightHash);
 const reviewTransitions=plan.xc60ScopedHistory.review.map(old=>{
  const after=draft.review.find(r=>r.sourceRequirementId===old.sourceRequirementId&&r.targetId===old.targetId&&sha(r.branch)===sha(old.branch));
  const removed=old.reasons.filter(r=>r==='SOURCE_ANCHOR_POWER_CONFLICT'),remaining=old.reasons.filter(r=>r!=='SOURCE_ANCHOR_POWER_CONFLICT');
  if(remaining.length){assert.ok(after);assert.deepEqual(after.reasons,remaining);}
  else assert.ok(draft.revisions.some(r=>r.sourceRequirementId===old.sourceRequirementId&&r.vehicleVariantKey===old.targetId));
  return {sourceRequirementId:old.sourceRequirementId,targetId:old.targetId,branch:old.branch,beforeReasons:old.reasons,removedReasons:removed,remainingReasons:remaining,sourceFullyResolved:false};
 });
 assert.equal(reviewTransitions.length,40);assert.equal(reviewTransitions.filter(t=>t.removedReasons.length).length,21);
 assert.equal(reviewTransitions.filter(t=>t.remainingReasons.length).length,37);
 const additions=draft.revisions,summary={...plan.summary,candidateRevisions:plan.newRevisions.length+additions.length,sourceRequirements:new Set([...plan.newRevisions,...additions].map(r=>r.sourceRequirementId)).size,xc60PowerRestoredRevisions:3};
 const history={parentPlanHash:sha(raw),draftHash:sha(draftRaw),jointHash:sha(jointRaw),preflightHash:draft.preflightHash,deltaHash:draft.deltaHash,reviewTransitions,newRevisionIds:additions.map(r=>r.id),pending:draft.pending,review:draft.review,predecessorSnapshotHash:sha(liveRaw),publicationAllowed:false};
 const render=x=>JSON.stringify(x,null,2).split('\n').map(l=>'    '+l).join('\n');
 const ops=[];
 // Prepend batches in reverse order so all original relative order is retained.
 for(let end=additions.length;end>0;end-=2){const group=additions.slice(Math.max(0,end-2),end);ops.push({from:'  "newRevisions": [',to:'  "newRevisions": [\n'+group.map(r=>render(r)+',').join('\n')});}
 const member=(name,value)=>'  "'+name+'": '+JSON.stringify(value,null,2).split('\n').map((l,i)=>i?'  '+l:l).join('\n')+',';
 ops.push({from:member('summary',plan.summary),to:member('summary',summary)});
 const kind='  "kind": "PASSAT_INCLUSIVE_OFFLINE_PREVIEW",';ops.push({from:kind,to:kind+'\n'+member('xc60PowerRestoredHistory',history)});
 let next=raw;const groups=[];
 for(const op of ops){assert.equal(next.split(op.from).length,2);const beforeHash=sha(next);next=next.replace(op.from,op.to);groups.push({beforeHash,afterHash:sha(next),op});}
 const updated=JSON.parse(next);assert.equal(updated.newRevisions.length,1967);assert.equal(new Set(updated.newRevisions.map(r=>r.id)).size,1967);assert.deepEqual(updated.newRevisions.slice(3),plan.newRevisions);assert.deepEqual(updated.existingActions,plan.existingActions);
 await writeFile(reportPath,JSON.stringify({parentPlanHash:sha(raw),afterPlanHash:sha(next),groups,summary,added:3,preserved:1964,actionsChanged:0,publicationAllowed:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({afterPlanHash:sha(next),groups:groups.length,added:3,sources:summary.sourceRequirements}));
}else{
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 if(mode==='patch'){
  const g=report.groups[Number(process.argv[3])];assert.ok(g);assert.equal(sha(raw),g.beforeHash);
  process.stdout.write('*** Begin Patch\n*** Update File: '+path+'\n@@\n'+g.op.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+g.op.to.split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n');
 }else if(mode==='verify'){
  assert.equal(sha(raw),report.afterPlanHash);let restored=raw;
  for(const g of [...report.groups].reverse()){assert.equal(restored.split(g.op.to).length,2);restored=restored.replace(g.op.to,g.op.from);}
  assert.equal(sha(restored),report.parentPlanHash);console.log(JSON.stringify({planHash:sha(raw),wholeFileReversalVerified:true,added:3,preserved:1964,actionsChanged:0}));
 }else throw new Error('Unknown mode');
}
