import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const path=resolve(dir,'plan.json'),reportPath=resolve(dir,'recovered-volvo-merge-v1.json'),mode=process.argv[2];
const raw=await readFile(path,'utf8');
if(mode==='prepare'){
 const plan=JSON.parse(raw), inputs=[];
 for(const name of ['recovered-volvo-fluid-drafts-v1.json','recovered-volvo-conditional-drafts-v1.json','recovered-volvo-2wd-drafts-v1.json']){
  const content=await readFile(resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2',name),'utf8'),data=JSON.parse(content);
  assert.equal(data.planHash,sha(raw));assert.equal(data.productionApplyAllowed,false);
  inputs.push({name,hash:sha(content),data});
 }
 assert.deepEqual(inputs.map(i=>i.data.newRevisions.length),[1,2,4]);
 assert.deepEqual(inputs.map(i=>i.data.summary.profileChecks??i.data.summary.checks),[342,702,23328]);
 const draft={newRevisions:inputs.flatMap(i=>i.data.newRevisions)},draftRaw=JSON.stringify(inputs.map(({name,hash})=>({name,hash})));
 assert.equal(plan.newRevisions.length,2018);assert.equal(new Set(draft.newRevisions.map(r=>r.id)).size,7);
 const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8');
 for(const i of inputs)assert.equal(sha(liveRaw),i.data.liveHash??i.data.legacySnapshotHash);
 const live=JSON.parse(liveRaw);
 for(const r of draft.newRevisions){
  assert.ok(!plan.newRevisions.some(p=>p.id===r.id||p.sourceRequirementId===r.sourceRequirementId&&p.vehicleVariantKey===r.vehicleVariantKey));
  assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.equal(r.state,'STAGED');assert.deepEqual(r.verifiedFieldsJson,[]);assert.deepEqual(r.replacesRevisionIds,[]);
  assert.ok(!live.some(p=>p.sourceRequirementId===r.sourceRequirementId&&p.vehicleVariantKey===r.vehicleVariantKey&&(p.reviewConfirmed||p.applyEligible||p.verificationStatus!=='UNVERIFIED')));
  const policy=r.provenanceJson.catalogPreviewPolicy; const fingerprint=sha({policy,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,applicability:r.applicabilityJson,technical:r.technicalDataJson});
  assert.equal(fingerprint,r.semanticFingerprint);assert.equal(r.id,`mtar_${fingerprint.slice(0,24)}`);
 }
 const additions=draft.newRevisions,all=[...additions,...plan.newRevisions];
 const summary={...plan.summary,candidateRevisions:all.length,sourceRequirements:new Set(all.map(r=>r.sourceRequirementId)).size,recoveredVolvoRevisions:additions.length};
 const history={parentPlanHash:sha(raw),draftHash:sha(draftRaw),legacySnapshotHash:sha(liveRaw),inputDrafts:JSON.parse(draftRaw),newRevisionIds:additions.map(r=>r.id),predecessorPolicy:'SCOPED_DISPLAY_ONLY_NO_GLOBAL_SUPERSESSION',publicationAllowed:false};
 const render=x=>JSON.stringify(x,null,2).split('\n').map(l=>'    '+l).join('\n');
 const member=(key,value)=>'  "'+key+'": '+JSON.stringify(value,null,2).split('\n').map((l,i)=>i?'  '+l:l).join('\n')+',';
 const ops=[];
 for(let end=additions.length;end>0;end-=3)ops.push({from:'  "newRevisions": [',to:'  "newRevisions": [\n'+additions.slice(Math.max(0,end-3),end).map(r=>render(r)+',').join('\n')});
 ops.push({from:member('summary',plan.summary),to:member('summary',summary)});
 const kind=member('kind',plan.kind);ops.push({from:kind,to:kind+'\n'+member('recoveredVolvoHistory',history)});
 let next=raw;const groups=[];
 for(const op of ops){assert.equal(next.split(op.from).length,2);const beforeHash=sha(next);next=next.replace(op.from,op.to);groups.push({beforeHash,afterHash:sha(next),op});}
 const updated=JSON.parse(next);assert.equal(updated.newRevisions.length,2025);assert.equal(new Set(updated.newRevisions.map(r=>r.id)).size,2025);
 assert.deepEqual(updated.newRevisions.slice(7),plan.newRevisions);assert.deepEqual(updated.existingActions,plan.existingActions);assert.deepEqual(updated.protectedBranches,plan.protectedBranches);
 await writeFile(reportPath,JSON.stringify({parentPlanHash:sha(raw),afterPlanHash:sha(next),groups,summary,added:7,preserved:2018,actionsChanged:0,publicationAllowed:false},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({groups:groups.length,afterPlanHash:sha(next),summary}));
}else{
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 if(mode==='patch'){
  const g=report.groups[Number(process.argv[3])];assert.ok(g);assert.equal(sha(raw),g.beforeHash);
  process.stdout.write('*** Begin Patch\n*** Update File: '+path+'\n@@\n'+g.op.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+g.op.to.split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n');
 }else if(mode==='verify'){
  assert.equal(sha(raw),report.afterPlanHash);let restored=raw;
  for(const g of [...report.groups].reverse()){assert.equal(restored.split(g.op.to).length,2);restored=restored.replace(g.op.to,g.op.from);}
  assert.equal(sha(restored),report.parentPlanHash);console.log(JSON.stringify({wholeFileReversalVerified:true,planHash:sha(raw),added:7,preserved:2018,actionsChanged:0}));
 }else throw Error('Unknown mode');
}
