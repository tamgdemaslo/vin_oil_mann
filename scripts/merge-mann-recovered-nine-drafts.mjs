import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),path=resolve(dir,'plan.json'),out=resolve(dir,'recovered-nine-merge-v1.json');
const raw=await readFile(path,'utf8'),mode=process.argv[2];
if(mode==='prepare'){
 const plan=JSON.parse(raw),draftRaw=await readFile(resolve(dir,'recovered-nine-fluid-drafts-v1.json'),'utf8'),draft=JSON.parse(draftRaw);assert.equal(sha(raw),draft.planHash);assert.equal(draft.productionApplyAllowed,false);assert.deepEqual(draft.summary,{drafts:9,replacements:9,profileChecks:26784});
 const matchRaw=await readFile(resolve(dir,'recovered-positive-source-rematch-v2.json'),'utf8'),match=JSON.parse(matchRaw);assert.equal(sha(matchRaw),draft.rematchHash);for(const [file,hash] of Object.entries(match.runtimeHashes))assert.equal(sha(await readFile(resolve(root,file),'utf8')),hash);
 for(const [file,hash] of [['outputs/mann-live-audit-1789415211923/revisions.json',draft.liveHash],['outputs/mann-live-audit-1789415211923/reviewDecisions.json',draft.reviewsHash],['data/mann-technical-association-denylist-v1.json',draft.denylistHash]])assert.equal(sha(await readFile(resolve(root,file),'utf8')),hash);
 assert.equal(draft.newRevisions.length,9);assert.equal(draft.existingActionUpdates.length,9);assert.equal(new Set(draft.newRevisions.map(r=>r.id)).size,9);assert.equal(new Set(draft.existingActionUpdates.map(r=>r.revisionId)).size,9);
 for(const r of draft.newRevisions){
  assert.ok(!plan.newRevisions.some(x=>x.id===r.id||x.sourceRequirementId===r.sourceRequirementId&&x.vehicleVariantKey===r.vehicleVariantKey));assert.equal(r.semanticFingerprint,sha({policy:r.provenanceJson.catalogPreviewPolicy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technical:r.technicalDataJson}));assert.equal(r.id,`mtar_${r.semanticFingerprint.slice(0,24)}`);assert.equal(r.state,'STAGED');assert.equal(r.verificationStatus,'UNVERIFIED');assert.equal(r.applyEligible,false);assert.deepEqual(r.verifiedFieldsJson,[]);
  const action=draft.existingActionUpdates.find(a=>a.successorId===r.id);assert.ok(action);const old=plan.existingActions.find(a=>a.revisionId===action.revisionId);assert.ok(old.action.startsWith('REVIEW_'));assert.equal(old.successorId,null);assert.equal(old.expectedSemanticFingerprint,action.expectedSemanticFingerprint);assert.deepEqual(r.replacesRevisionIds,[old.revisionId]);
 }
 const updates=new Map(draft.existingActionUpdates.map(a=>[a.revisionId,a])),nextActions=plan.existingActions.map(a=>updates.get(a.revisionId)??a),all=[...draft.newRevisions,...plan.newRevisions];
 const summary={...plan.summary,candidateRevisions:all.length,sourceRequirements:new Set(all.map(r=>r.sourceRequirementId)).size,actions:{},recoveredPositiveRevisions:9};for(const a of nextActions)summary.actions[a.action]=(summary.actions[a.action]??0)+1;
 const member=(k,v)=>'  '+JSON.stringify(k)+': '+JSON.stringify(v,null,2).split('\n').map((l,i)=>i?'  '+l:l).join('\n')+',';
 const render=v=>JSON.stringify(v,null,2).split('\n').map(l=>'    '+l).join('\n')+',';
 const ops=[{from:'  "newRevisions": [',to:'  "newRevisions": [\n'+draft.newRevisions.map(render).join('\n')},{from:member('summary',plan.summary),to:member('summary',summary)},...draft.existingActionUpdates.map(a=>({from:render(plan.existingActions.find(x=>x.revisionId===a.revisionId)),to:render(a)}))];
 let next=raw;const groups=[];for(const op of ops){assert.equal(next.split(op.from).length,2);const beforeHash=sha(next);next=next.replace(op.from,op.to);groups.push({beforeHash,afterHash:sha(next),op});}
 const updated=JSON.parse(next);assert.deepEqual(updated.newRevisions.slice(9),plan.newRevisions);assert.deepEqual(updated.existingActions,nextActions);assert.deepEqual(updated.protectedBranches,plan.protectedBranches);assert.equal(new Set(updated.newRevisions.map(r=>r.id)).size,2043);
 await writeFile(out,JSON.stringify({parentPlanHash:sha(raw),afterPlanHash:sha(next),draftHash:sha(draftRaw),groups,summary,publicationAllowed:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({afterPlanHash:sha(next),revisions:2043,actionsChanged:9,groups:groups.length}));
}else{
 const report=JSON.parse(await readFile(out,'utf8'));
 if(mode==='patch'){const g=report.groups[Number(process.argv[3])];assert.equal(sha(raw),g.beforeHash);process.stdout.write('*** Begin Patch\n*** Update File: '+path+'\n@@\n'+g.op.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+g.op.to.split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n');}
 else if(mode==='verify'){assert.equal(sha(raw),report.afterPlanHash);let back=raw;for(const g of [...report.groups].reverse()){assert.equal(back.split(g.op.to).length,2);back=back.replace(g.op.to,g.op.from);}assert.equal(sha(back),report.parentPlanHash);console.log(JSON.stringify({reversalVerified:true,planHash:sha(raw)}));}else throw Error('Unknown mode');
}
