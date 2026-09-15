import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const path=resolve(dir,'plan.json'),reportPath=resolve(dir,'unplanned-scoped-merge-v1.json'),mode=process.argv[2];
const raw=await readFile(path,'utf8');
if(mode==='prepare'){
 const draftRaw=await readFile(resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2/market-reconciled-unplanned-drafts-v1.json'),'utf8'),draft=JSON.parse(draftRaw),plan=JSON.parse(raw);
 assert.equal(sha(raw),draft.planHash);assert.equal(plan.newRevisions.length,1971);
 assert.equal(draft.summary.profileChecks,11565);assert.equal(draft.newRevisions.length,21);
 const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8');assert.equal(sha(liveRaw),draft.legacySnapshotHash);
 const live=JSON.parse(liveRaw);
 for(const r of draft.newRevisions){
  assert.ok(!plan.newRevisions.some(p=>p.id===r.id||p.sourceRequirementId===r.sourceRequirementId&&p.vehicleVariantKey===r.vehicleVariantKey));
  assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.equal(r.state,'STAGED');assert.deepEqual(r.verifiedFieldsJson,[]);assert.deepEqual(r.replacesRevisionIds,[]);
  assert.ok(!live.some(p=>p.sourceRequirementId===r.sourceRequirementId&&p.vehicleVariantKey===r.vehicleVariantKey&&(p.reviewConfirmed||p.applyEligible||p.verificationStatus!=='UNVERIFIED')));
  const fingerprint=sha({policy:r.provenanceJson.catalogPreviewPolicy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technical:r.technicalDataJson});
  assert.equal(fingerprint,r.semanticFingerprint);assert.equal(r.id,`mtar_${fingerprint.slice(0,24)}`);
 }
 const additions=draft.newRevisions,all=[...additions,...plan.newRevisions];
 const summary={...plan.summary,candidateRevisions:all.length,sourceRequirements:new Set(all.map(r=>r.sourceRequirementId)).size,unplannedScopedRevisions:additions.length};
 const history={parentPlanHash:sha(raw),draftHash:sha(draftRaw),legacySnapshotHash:sha(liveRaw),reconciliationHash:draft.reconciliationHash,newRevisionIds:additions.map(r=>r.id),predecessorPolicy:'SCOPED_DISPLAY_ONLY_NO_GLOBAL_SUPERSESSION',publicationAllowed:false};
 const render=x=>JSON.stringify(x,null,2).split('\n').map(l=>'    '+l).join('\n');
 const member=(key,value)=>'  "'+key+'": '+JSON.stringify(value,null,2).split('\n').map((l,i)=>i?'  '+l:l).join('\n')+',';
 const ops=[];
 for(let end=additions.length;end>0;end-=3)ops.push({from:'  "newRevisions": [',to:'  "newRevisions": [\n'+additions.slice(Math.max(0,end-3),end).map(r=>render(r)+',').join('\n')});
 ops.push({from:member('summary',plan.summary),to:member('summary',summary)});
 const kind=member('kind',plan.kind);ops.push({from:kind,to:kind+'\n'+member('unplannedScopedHistory',history)});
 let next=raw;const groups=[];
 for(const op of ops){assert.equal(next.split(op.from).length,2);const beforeHash=sha(next);next=next.replace(op.from,op.to);groups.push({beforeHash,afterHash:sha(next),op});}
 const updated=JSON.parse(next);assert.equal(updated.newRevisions.length,1992);assert.equal(new Set(updated.newRevisions.map(r=>r.id)).size,1992);
 assert.deepEqual(updated.newRevisions.slice(21),plan.newRevisions);assert.deepEqual(updated.existingActions,plan.existingActions);assert.deepEqual(updated.protectedBranches,plan.protectedBranches);
 await writeFile(reportPath,JSON.stringify({parentPlanHash:sha(raw),afterPlanHash:sha(next),groups,summary,added:21,preserved:1971,actionsChanged:0,publicationAllowed:false},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({groups:groups.length,afterPlanHash:sha(next),summary}));
}else{
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 if(mode==='patch'){
  const g=report.groups[Number(process.argv[3])];assert.ok(g);assert.equal(sha(raw),g.beforeHash);
  process.stdout.write('*** Begin Patch\n*** Update File: '+path+'\n@@\n'+g.op.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+g.op.to.split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n');
 }else if(mode==='verify'){
  assert.equal(sha(raw),report.afterPlanHash);let restored=raw;
  for(const g of [...report.groups].reverse()){assert.equal(restored.split(g.op.to).length,2);restored=restored.replace(g.op.to,g.op.from);}
  assert.equal(sha(restored),report.parentPlanHash);console.log(JSON.stringify({wholeFileReversalVerified:true,planHash:sha(raw),added:21,preserved:1971,actionsChanged:0}));
 }else throw Error('Unknown mode');
}
