import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),path=resolve(dir,'plan.json'),reportPath=resolve(dir,'xc60-tg81-merge-operations-v1.json');
const mode=process.argv[2],raw=await readFile(path,'utf8');
if(mode==='prepare'){
 const draftRaw=await readFile(resolve(dir,'xc60-tg81-conditional-drafts-v1.json'),'utf8'),draft=JSON.parse(draftRaw),jointRaw=await readFile(resolve(dir,'xc60-tg81-joint-v1.json'),'utf8'),joint=JSON.parse(jointRaw),plan=JSON.parse(raw);
 assert.equal(sha(raw),draft.planHash);assert.equal(joint.planHash,sha(raw));assert.equal(joint.draftHash,sha(draftRaw));assert.equal(joint.summary.newConflicts,0);assert.equal(joint.summary.newRevisionsSeen,4);assert.deepEqual(joint.unseenDrafts,[]);
 assert.equal(draft.revisions.length,4);assert.equal(draft.pending.length,4);
 const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
 for(const r of draft.revisions){
  assert.ok(!plan.newRevisions.some(p=>p.id===r.id||p.sourceRequirementId===r.sourceRequirementId&&p.vehicleVariantKey===r.vehicleVariantKey));
  assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.deepEqual(r.verifiedFieldsJson,[]);assert.deepEqual(r.replacesRevisionIds,[]);
  assert.ok(!live.some(p=>p.sourceRequirementId===r.sourceRequirementId&&p.vehicleVariantKey===r.vehicleVariantKey));
  assert.equal(r.provenanceJson.conditionalTransmissionPolicy,'USER_CONFIRMED_TRANSMISSION_V1');assert.equal(r.state,'REVIEW');assert.equal(r.componentModel,'TG-81SC');assert.equal(r.applicabilityJson.transmissionGearCount,8);assert.equal(r.applicabilityJson.transmissionType,'automatic');
  const fp=sha({policy:r.provenanceJson.conditionalTransmissionPolicy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicabilityJson:r.applicabilityJson,technicalDataJson:r.technicalDataJson});assert.equal(fp,r.semanticFingerprint);assert.equal(r.id,`mtar_${fp.slice(0,24)}`);
 }
 const additions=draft.revisions,summary={...plan.summary,candidateRevisions:plan.newRevisions.length+additions.length,sourceRequirements:new Set([...plan.newRevisions,...additions].map(r=>r.sourceRequirementId)).size,xc60Tg81ConditionalRevisions:4};
 const history={parentPlanHash:sha(raw),draftHash:sha(draftRaw),jointHash:sha(jointRaw),newRevisionIds:additions.map(r=>r.id),pending:draft.pending,preflightHash:draft.preflightHash,capacityReportHash:draft.capacityReportHash,remainingSourceReviewRequired:true,predecessorSnapshotHash:sha(liveRaw),publicationAllowed:false};
 const render=x=>JSON.stringify(x,null,2).split('\n').map(l=>'    '+l).join('\n');
 const ops=[];
 // Prepend batches in reverse order so all original relative order is retained.
 for(let end=additions.length;end>0;end-=2){const group=additions.slice(Math.max(0,end-2),end);ops.push({from:'  "newRevisions": [',to:'  "newRevisions": [\n'+group.map(r=>render(r)+',').join('\n')});}
 const member=(name,value)=>'  "'+name+'": '+JSON.stringify(value,null,2).split('\n').map((l,i)=>i?'  '+l:l).join('\n')+',';
 ops.push({from:member('summary',plan.summary),to:member('summary',summary)});
 const kind='  "kind": "PASSAT_INCLUSIVE_OFFLINE_PREVIEW",';ops.push({from:kind,to:kind+'\n'+member('xc60Tg81ConditionalHistory',history)});
 let next=raw;const groups=[];
 for(const op of ops){assert.equal(next.split(op.from).length,2);const beforeHash=sha(next);next=next.replace(op.from,op.to);groups.push({beforeHash,afterHash:sha(next),op});}
 const updated=JSON.parse(next);assert.equal(updated.newRevisions.length,1971);assert.equal(new Set(updated.newRevisions.map(r=>r.id)).size,1971);assert.deepEqual(updated.newRevisions.slice(4),plan.newRevisions);assert.deepEqual(updated.existingActions,plan.existingActions);
 await writeFile(reportPath,JSON.stringify({parentPlanHash:sha(raw),afterPlanHash:sha(next),groups,summary,added:4,preserved:1967,actionsChanged:0,publicationAllowed:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({afterPlanHash:sha(next),groups:groups.length,added:4,sources:summary.sourceRequirements}));
}else{
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 if(mode==='patch'){
  const g=report.groups[Number(process.argv[3])];assert.ok(g);assert.equal(sha(raw),g.beforeHash);
  process.stdout.write('*** Begin Patch\n*** Update File: '+path+'\n@@\n'+g.op.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+g.op.to.split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n');
 }else if(mode==='verify'){
  assert.equal(sha(raw),report.afterPlanHash);let restored=raw;
  for(const g of [...report.groups].reverse()){assert.equal(restored.split(g.op.to).length,2);restored=restored.replace(g.op.to,g.op.from);}
  assert.equal(sha(restored),report.parentPlanHash);console.log(JSON.stringify({planHash:sha(raw),wholeFileReversalVerified:true,added:4,preserved:1967,actionsChanged:0}));
 }else throw new Error('Unknown mode');
}
