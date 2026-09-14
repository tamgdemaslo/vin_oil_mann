import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-nissan-xtrail-cvt-list-preview-2026-09-14');
const [raw,auditRaw,sql]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'transmission-chassis-identity-audit-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8')]);
const parent=JSON.parse(raw),audit=JSON.parse(auditRaw),sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r]));assert.equal(audit.planHash,sha(raw));assert.equal(audit.sourceHash,sha(sql));assert.equal(audit.mannHash,sha(await readFile('/tmp/mann_filter_applications.sql','utf8')));
for(const [file,hash] of Object.entries(audit.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const findings=audit.results.filter(r=>r.status==='MISSING_EXPLICIT_CHASSIS_IDENTITY');assert.equal(findings.length,87);assert.equal(audit.results.length,301);
const byId=new Map(parent.newRevisions.map(r=>[r.id,r])),held=findings.map(f=>{
 const revision=byId.get(f.revisionId);assert.ok(revision);assert.equal(sha(revision),f.revisionHash);assert.equal(revision.state,'REVIEW');assert.equal(revision.verificationStatus,'UNVERIFIED');assert.equal(revision.applyEligible,false);
 const originalSource=sources.get(f.sourceRequirementId);assert.equal(sha(originalSource),f.sourceHash);
 return {revision,originalSource,sourceHash:f.sourceHash,reason:f.status,evidence:f,publicationAllowed:false};
});
const ids=new Set(held.map(h=>h.revision.id)),actionsHistory=[];
const existingActions=parent.existingActions.map(a=>{
 const withheld=[...new Set([a.successorId,...(a.proposedSuccessorIds??[])].filter(id=>ids.has(id)))];if(!withheld.length)return a;
 assert.notEqual(a.action,'PRESERVE_PROTECTED');actionsHistory.push(a);
 return {...a,action:'REVIEW_SOURCE_CHASSIS_IDENTITY',successorId:ids.has(a.successorId)?null:a.successorId,proposedSuccessorIds:(a.proposedSuccessorIds??[]).filter(id=>!ids.has(id)),withheldSuccessorIds:withheld};
});
const newRevisions=parent.newRevisions.filter(r=>!ids.has(r.id));assert.equal(newRevisions.length,2120);
const plan={...parent,newRevisions,existingActions,transmissionIdentityHeld:[...(parent.transmissionIdentityHeld??[]),...held],transmissionIdentityHistory:{previous:parent.transmissionIdentityHistory??null,parentPath:resolve(dir,'plan.json'),parentHash:sha(raw),auditHash:sha(auditRaw),actionsHistory,heldIds:[...ids]},summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,transmissionIdentityHeld:(parent.summary.transmissionIdentityHeld??0)+held.length,actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
for(const key of Object.keys(parent).filter(k=>!['newRevisions','existingActions','summary','transmissionIdentityHeld','transmissionIdentityHistory'].includes(k)))assert.deepEqual(plan[key],parent[key]);
assert.deepEqual(newRevisions,parent.newRevisions.filter(r=>!ids.has(r.id)));for(const a of existingActions){assert.ok(!ids.has(a.successorId));assert.ok(!(a.proposedSuccessorIds??[]).some(id=>ids.has(id)));}
const out=resolve(root,'outputs/mann-transmission-chassis-held-preview-2026-09-14');await mkdir(out);const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
const proof={planHash:sha(serialized),parentHash:sha(raw),held:held.length,retained:newRevisions.length,sources:plan.summary.sourceRequirements,changedActions:actionsHistory.length,allHeldRevisionsPreserved:true,productionApplyAllowed:false};await writeFile(resolve(out,'hold-verification.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(proof));
