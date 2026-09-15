import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const dir=resolve(import.meta.dirname,'../outputs/mann-gentra-evidence-review-2026-09-14'),path=resolve(dir,'plan.json');
const reportPath=resolve(dir,'four-engine-merge-operations-v1.json'),mode=process.argv[2],raw=await readFile(path,'utf8');
if(mode==='prepare'){
 const batchRaw=await readFile(resolve(dir,'four-engine-restoration-drafts-v1.json'),'utf8'),batch=JSON.parse(batchRaw);
 const jointRaw=await readFile(resolve(dir,'four-engine-restoration-joint-v1.json'),'utf8'),joint=JSON.parse(jointRaw),plan=JSON.parse(raw);
 assert.equal(sha(raw),batch.planHash);assert.equal(joint.planHash,batch.planHash);assert.equal(joint.draftHash,sha(batchRaw));
 assert.equal(joint.summary.newConflicts,0);assert.equal(joint.summary.restoredRevisionsSeen,4);assert.equal(batch.drafts.length,4);
 const render=x=>JSON.stringify(x,null,2).split('\n').map(l=>'    '+l).join('\n')+',';
 const operations=[],ids=new Map();
 for(const d of batch.drafts){
  assert.deepEqual(plan.newRevisions.find(r=>r.id===d.before.id),d.before);
  const restored=structuredClone(d.after);restored.id=d.before.id;restored.semanticFingerprint=d.before.semanticFingerprint;
  restored.applicabilityJson.matchedEngineScope=d.before.applicabilityJson.matchedEngineScope;delete restored.provenanceJson.engineScopeRestoration;
  assert.deepEqual(restored,d.before);assert.equal(d.after.applyEligible,false);assert.equal(d.after.verificationStatus,'UNVERIFIED');
  const fp=sha({policy:d.after.provenanceJson.catalogPreviewPolicy,sourceRequirementId:d.after.sourceRequirementId,vehicleVariantKey:d.after.vehicleVariantKey,applicability:d.after.applicabilityJson,technicalData:d.after.technicalDataJson});
  assert.equal(fp,d.after.semanticFingerprint);assert.equal(d.after.id,`mtar_${fp.slice(0,24)}`);
  operations.push({from:render(d.before),to:render(d.after)});ids.set(d.before.id,d.after.id);
 }
 let refs=0;for(const a of plan.existingActions)if(ids.has(a.successorId)){assert.equal(a.action,'REPLACE_WITH_PREVIEW');operations.push({from:render(a),to:render({...a,successorId:ids.get(a.successorId)})});refs++;}
 assert.equal(refs,4);
 const history={parentPlanHash:sha(raw),draftHash:sha(batchRaw),jointVerificationHash:sha(jointRaw),replacements:batch.drafts.map(d=>({originalRevisionId:d.before.id,successorId:d.after.id,restoredCodes:d.after.provenanceJson.engineScopeRestoration.restoredCodes})),updatedActionReferences:refs,productionApplyAllowed:false};
 const anchor='  "kind": "PASSAT_INCLUSIVE_OFFLINE_PREVIEW",';
 operations.push({from:anchor,to:anchor+'\n'+JSON.stringify({fourEngineScopeRestoration:history},null,2).split('\n').slice(1,-1).join('\n')+','});
 let next=raw;for(const o of operations){assert.equal(next.split(o.from).length,2);next=next.replace(o.from,o.to);}
 const updated=JSON.parse(next);assert.equal(updated.newRevisions.length,1932);assert.equal(new Set(updated.newRevisions.map(r=>r.id)).size,1932);
 const activeIds=new Set(updated.newRevisions.map(r=>r.id));for(const a of updated.existingActions)if(a.successorId)assert.ok(activeIds.has(a.successorId));
 assert.deepEqual(updated.newRevisions.filter(r=>!new Set(ids.values()).has(r.id)),plan.newRevisions.filter(r=>!ids.has(r.id)));
 assert.deepEqual(updated.summary,plan.summary);assert.deepEqual(updated.protectedBranches,plan.protectedBranches);
 await writeFile(reportPath,JSON.stringify({parentPlanHash:sha(raw),afterPlanHash:sha(next),history,operations,otherRevisionsPreserved:1928},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({afterPlanHash:sha(next),revisions:4,actionReferences:refs,otherRevisionsPreserved:1928}));
}else{
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 if(mode==='patch'){
  assert.equal(sha(raw),report.parentPlanHash);
  const ordered=[...report.operations].sort((a,b)=>raw.indexOf(a.from)-raw.indexOf(b.from));
  process.stdout.write('*** Begin Patch\n*** Update File: '+path+'\n'+ordered.map(o=>'@@\n'+o.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+o.to.split('\n').map(l=>'+'+l).join('\n')).join('\n')+'\n*** End Patch\n');
 }else if(mode==='verify'){
  assert.equal(sha(raw),report.afterPlanHash);let restored=raw;
  for(const o of [...report.operations].reverse()){assert.equal(restored.split(o.to).length,2);restored=restored.replace(o.to,o.from);}
  assert.equal(sha(restored),report.parentPlanHash);console.log(JSON.stringify({planHash:sha(raw),fullFileReversalVerified:true,otherRevisionsPreserved:1928,actionReferences:4}));
 }else throw new Error('Unknown mode');
}
