import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),path=resolve(dir,'plan.json'),out=resolve(dir,'logan-oil-merge-v1.json');
const raw=await readFile(path,'utf8'),mode=process.argv[2];
if(mode==='prepare'){
 const plan=JSON.parse(raw),draftRaw=await readFile(resolve(dir,'logan-oil-draft-v1.json'),'utf8'),draft=JSON.parse(draftRaw);assert.equal(sha(raw),draft.planHash);assert.equal(draft.productionApplyAllowed,false);assert.deepEqual(draft.summary,{drafts:1,replacements:1,profileChecks:1888});
 const auditRaw=await readFile(resolve(dir,'logan-complete-fluid-table-v1.json'),'utf8'),audit=JSON.parse(auditRaw);assert.equal(sha(auditRaw),draft.auditHash);for(const [file,hash] of Object.entries(audit.runtimeHashes))assert.equal(sha(await readFile(resolve(root,file),'utf8')),hash);
 for(const [file,hash] of [['data/mann-logan-source-footnote-evidence-v1.json',draft.footnoteHash],['outputs/mann-live-audit-1789415211923/revisions.json',draft.liveHash],['outputs/mann-live-audit-1789415211923/reviewDecisions.json',draft.reviewsHash],['data/mann-technical-association-denylist-v1.json',draft.denylistHash]])assert.equal(sha(await readFile(resolve(root,file),'utf8')),hash);
 const [r]=draft.newRevisions;assert.equal(draft.newRevisions.length,1);assert.ok(!plan.newRevisions.some(x=>x.id===r.id||x.sourceRequirementId===r.sourceRequirementId&&x.vehicleVariantKey===r.vehicleVariantKey));
 assert.equal(r.semanticFingerprint,sha({policy:r.provenanceJson.catalogPreviewPolicy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technical:r.technicalDataJson}));assert.equal(r.id,`mtar_${r.semanticFingerprint.slice(0,24)}`);assert.equal(r.state,'STAGED');assert.equal(r.verificationStatus,'UNVERIFIED');assert.equal(r.applyEligible,false);
 const [action]=draft.existingActionUpdates,old=plan.existingActions.find(a=>a.revisionId===action.revisionId);assert.equal(old.action,'REVIEW_UNREPLACED');assert.equal(old.expectedSemanticFingerprint,action.expectedSemanticFingerprint);assert.deepEqual(r.replacesRevisionIds,[old.revisionId]);assert.equal(action.successorId,r.id);
 const nextActions=plan.existingActions.map(a=>a.revisionId===old.revisionId?action:a),summary={...plan.summary,candidateRevisions:plan.newRevisions.length+1,sourceRequirements:new Set([...plan.newRevisions,r].map(r=>r.sourceRequirementId)).size,actions:{},loganEngineOilRevisions:1};for(const a of nextActions)summary.actions[a.action]=(summary.actions[a.action]??0)+1;
 const member=(k,v)=>'  '+JSON.stringify(k)+': '+JSON.stringify(v,null,2).split('\n').map((l,i)=>i?'  '+l:l).join('\n')+',';
 const render=v=>JSON.stringify(v,null,2).split('\n').map(l=>'    '+l).join('\n')+',';
 const ops=[{from:'  "newRevisions": [',to:'  "newRevisions": [\n'+render(r)},{from:member('summary',plan.summary),to:member('summary',summary)},{from:render(old),to:render(action)}];
 let next=raw;const groups=[];for(const op of ops){assert.equal(next.split(op.from).length,2);const beforeHash=sha(next);next=next.replace(op.from,op.to);groups.push({beforeHash,afterHash:sha(next),op});}
 const updated=JSON.parse(next);assert.deepEqual(updated.newRevisions.slice(1),plan.newRevisions);assert.deepEqual(updated.existingActions,nextActions);assert.deepEqual(updated.protectedBranches,plan.protectedBranches);assert.equal(new Set(updated.newRevisions.map(r=>r.id)).size,2034);
 await writeFile(out,JSON.stringify({parentPlanHash:sha(raw),afterPlanHash:sha(next),draftHash:sha(draftRaw),groups,summary,publicationAllowed:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({afterPlanHash:sha(next),revisions:2034,actionsChanged:1}));
}else{
 const report=JSON.parse(await readFile(out,'utf8'));
 if(mode==='patch'){const g=report.groups[Number(process.argv[3])];assert.equal(sha(raw),g.beforeHash);process.stdout.write('*** Begin Patch\n*** Update File: '+path+'\n@@\n'+g.op.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+g.op.to.split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n');}
 else if(mode==='verify'){assert.equal(sha(raw),report.afterPlanHash);let back=raw;for(const g of [...report.groups].reverse()){assert.equal(back.split(g.op.to).length,2);back=back.replace(g.op.to,g.op.from);}assert.equal(sha(back),report.parentPlanHash);console.log(JSON.stringify({reversalVerified:true,planHash:sha(raw)}));}else throw Error('Unknown mode');
}
