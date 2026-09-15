import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const logan=process.argv.includes('--logan'),tepee=process.argv.includes('--tepee'),added=logan?2:tepee?1:5,preserved=logan?2031:tepee?2030:2025;
const path=resolve(dir,'plan.json'),reportPath=resolve(dir,logan?'logan-fluid-merge-v1.json':tepee?'vin-priority-tepee-merge-v1.json':'vin-priority-merge-v1.json'),mode=process.argv[2];
const raw=await readFile(path,'utf8');
if(mode==='prepare'){
  const plan=JSON.parse(raw),draftRaw=await readFile(resolve(dir,logan?'logan-fluid-drafts-v2.json':tepee?'vin-priority-tepee-fluid-draft-v2.json':'vin-priority-fluid-drafts-v1.json'),'utf8'),draft=JSON.parse(draftRaw);
  assert.equal(sha(raw),draft.planHash);assert.equal(draft.productionApplyAllowed,false);
  assert.deepEqual(draft.summary,logan?{drafts:2,replacements:2,profileChecks:1416,canonicalChanged:false}:{drafts:added,checks:tepee?1368:2520,variantKeys:tepee?1:2});assert.equal(plan.newRevisions.length,preserved);
  const rematchRaw=await readFile(resolve(dir,logan?'logan-source-coverage-rematch-v3.json':tepee?'vin-priority-scoped-rematch-v6.json':'vin-priority-scoped-rematch-v3.json'),'utf8'),rematch=JSON.parse(rematchRaw);
  assert.equal(sha(rematchRaw),draft.rematchHash);
  for(const [file,hash] of Object.entries(rematch.codeHashes??rematch.runtimeHashes))assert.equal(sha(await readFile(resolve(root,file),'utf8')),hash,file);
  const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8');assert.equal(sha(liveRaw),draft.liveHash);
  const live=JSON.parse(liveRaw),additions=draft.newRevisions;
  assert.equal(additions.length,added);assert.equal(new Set(additions.map(r=>r.id)).size,added);
  for(const r of additions){
    assert.ok(!plan.newRevisions.some(p=>p.id===r.id||p.sourceRequirementId===r.sourceRequirementId&&p.vehicleVariantKey===r.vehicleVariantKey));
    assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.equal(r.state,'STAGED');assert.deepEqual(r.verifiedFieldsJson,[]);
    if(logan){
      assert.equal(r.replacesRevisionIds.length,1);const old=live.find(p=>p.id===r.replacesRevisionIds[0]);assert.ok(old);assert.equal(sha(old),r.provenanceJson.predecessorHash);assert.equal(old.sourceRequirementId,r.sourceRequirementId);assert.equal(old.vehicleVariantKey,r.vehicleVariantKey);
      const reviewsRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/reviewDecisions.json'),'utf8');assert.equal(sha(reviewsRaw),draft.reviewsHash);assert.ok(!JSON.parse(reviewsRaw).some(d=>d.revisionId===old.id));
    }else{assert.deepEqual(r.replacesRevisionIds,[]);assert.ok(!live.some(p=>p.sourceRequirementId===r.sourceRequirementId&&p.vehicleVariantKey===r.vehicleVariantKey));}
    const policy=r.provenanceJson.catalogPreviewPolicy;
    const fingerprint=sha({policy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technical:r.technicalDataJson});
    assert.equal(fingerprint,r.semanticFingerprint);assert.equal(r.id,`mtar_${fingerprint.slice(0,24)}`);
    const f=rematch.findings.find(f=>f.sourceRequirementId===r.sourceRequirementId&&f.vehicleVariantKey===r.vehicleVariantKey);
    if(logan){assert.equal(f.target.independentlyValidated,true);assert.equal(r.provenanceJson.datePartitionEvidence.rematchHash,sha(rematchRaw));}
    else{assert.equal(f.targetValidated,true);assert.deepEqual(f.scope,r.applicabilityJson);assert.deepEqual(f.predecessors,[]);}
  }
  const all=[...additions,...plan.newRevisions],summary={...plan.summary,candidateRevisions:all.length,sourceRequirements:new Set(all.map(r=>r.sourceRequirementId)).size,...(logan?{loganDatePartitionRevisions:2}:tepee?{tepeeReviewedModelRevisions:1}:{vinPriorityRevisions:5})};
  const history={parentPlanHash:sha(raw),draftHash:sha(draftRaw),rematchHash:sha(rematchRaw),legacySnapshotHash:sha(liveRaw),newRevisionIds:additions.map(r=>r.id),publicationAllowed:false};
  if(logan){summary.actions={};for(const old of plan.existingActions){const action=draft.existingActionUpdates.find(a=>a.revisionId===old.revisionId)??old;summary.actions[action.action]=(summary.actions[action.action]??0)+1;}}
  const member=(key,value)=>'  "'+key+'": '+JSON.stringify(value,null,2).split('\n').map((l,i)=>i?'  '+l:l).join('\n')+',';
  const render=x=>JSON.stringify(x,null,2).split('\n').map(l=>'    '+l).join('\n');
  const kind=member('kind',plan.kind),ops=[
    {from:'  "newRevisions": [',to:'  "newRevisions": [\n'+additions.map(r=>render(r)+',').join('\n')},
    {from:member('summary',plan.summary),to:member('summary',summary)},
    {from:kind,to:kind+'\n'+member(logan?'loganDatePartitionHistory':tepee?'tepeeReviewedModelHistory':'vinPriorityHistory',history)}
  ];
  if(logan)for(const update of draft.existingActionUpdates){const old=plan.existingActions.find(a=>a.revisionId===update.revisionId);assert.equal(old.action,'REVIEW_UNREPLACED');assert.equal(old.expectedSemanticFingerprint,update.expectedSemanticFingerprint);assert.ok(additions.some(r=>r.id===update.successorId&&r.replacesRevisionIds.includes(old.revisionId)));ops.push({from:render(old),to:render(update)});}
  let next=raw;const groups=[];
  for(const op of ops){assert.equal(next.split(op.from).length,2);const beforeHash=sha(next);next=next.replace(op.from,op.to);groups.push({beforeHash,afterHash:sha(next),op});}
  const updated=JSON.parse(next);assert.equal(new Set(updated.newRevisions.map(r=>r.id)).size,preserved+added);
  assert.deepEqual(updated.newRevisions.slice(added),plan.newRevisions);assert.deepEqual(updated.existingActions,logan?plan.existingActions.map(a=>draft.existingActionUpdates.find(u=>u.revisionId===a.revisionId)??a):plan.existingActions);assert.deepEqual(updated.protectedBranches,plan.protectedBranches);
  await writeFile(reportPath,JSON.stringify({parentPlanHash:sha(raw),afterPlanHash:sha(next),groups,summary,variantKeys:new Set(all.map(r=>r.vehicleVariantKey)).size,added,preserved,actionsChanged:logan?2:0,publicationAllowed:false},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({groups:groups.length,afterPlanHash:sha(next),revisions:all.length,sourceRequirements:summary.sourceRequirements,variantKeys:new Set(all.map(r=>r.vehicleVariantKey)).size}));
}else{
  const report=JSON.parse(await readFile(reportPath,'utf8'));
  if(mode==='patch'){
    const g=report.groups[Number(process.argv[3])];assert.ok(g);assert.equal(sha(raw),g.beforeHash);
    process.stdout.write('*** Begin Patch\n*** Update File: '+path+'\n@@\n'+g.op.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+g.op.to.split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n');
  }else if(mode==='verify'){
    assert.equal(sha(raw),report.afterPlanHash);let restored=raw;
    for(const g of [...report.groups].reverse()){assert.equal(restored.split(g.op.to).length,2);restored=restored.replace(g.op.to,g.op.from);}
    assert.equal(sha(restored),report.parentPlanHash);console.log(JSON.stringify({wholeFileReversalVerified:true,planHash:sha(raw),added:report.added,preserved:report.preserved,actionsChanged:report.actionsChanged}));
  }else throw Error('Unknown mode');
}
