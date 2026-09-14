import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-solaris-ru-restored-preview-2026-09-14');
const [raw,auditRaw,contextRaw,sql,mannRaw,sourceRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'source-market-target-scope-audit-v1.json'),'utf8'),readFile(resolve(dir,'source-market-context-audit-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const parent=JSON.parse(raw),audit=JSON.parse(auditRaw),context=JSON.parse(contextRaw),sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r]));
assert.equal(audit.planHash,sha(raw));assert.equal(audit.inputHash,sha(contextRaw));assert.equal(context.sourceHash,sha(sql));assert.equal(context.rawHash,sha(sourceRaw));assert.equal(audit.mannHash,sha(mannRaw));
for(const [file,hash] of Object.entries(audit.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const byId=new Map(parent.newRevisions.map(r=>[r.id,r])),anchors=new Map(context.findings.map(f=>[f.revisionId,f]));
const build=f=>{
 const revision=byId.get(f.revisionId),originalSource=sources.get(f.sourceRequirementId),anchor=anchors.get(f.revisionId);
 assert.equal(sha(revision),f.revisionHash);assert.equal(sha(originalSource),anchor.sourceHash);assert.equal(sha(anchor.anchor),f.anchorHash);
 assert.ok(['REVIEW','STAGED'].includes(revision.state));assert.equal(revision.verificationStatus,'UNVERIFIED');assert.equal(revision.applyEligible,false);
 return {revision,originalSource,sourceHash:sha(originalSource),sourceAnchor:anchor.anchor,evidence:f,publicationAllowed:false};
};
const held=audit.findings.filter(f=>f.statuses.length===1&&f.statuses[0]==='EXACT_ENGINE_POWER_NOT_IN_SOURCE').map(f=>{
 assert.ok(f.checks.length&&f.checks.every(c=>c.powerHp>0&&c.sourceEngineBranches.length&&!c.matches.length));
 return {...build(f),reason:'SOURCE_MARKET_BRANCH_POWER_MISMATCH_REQUIRES_REVIEW'};
});
assert.equal(held.length,183);const ids=new Set(held.map(h=>h.revision.id));assert.equal(ids.size,held.length);
const review=audit.findings.filter(f=>!ids.has(f.revisionId)&&!(f.statuses.length===1&&f.statuses[0]==='EXISTING_RU_SCOPE_SUPPORTED')).map(f=>({...build(f),reason:'SOURCE_MARKET_SCOPE_RECONCILIATION_REQUIRED'}));
assert.equal(review.length,486);
const actionsHistory=[],existingActions=parent.existingActions.map(a=>{
 const withheld=[...new Set([a.successorId,...(a.proposedSuccessorIds??[])].filter(id=>ids.has(id)))];if(!withheld.length)return a;
 assert.notEqual(a.action,'PRESERVE_PROTECTED');actionsHistory.push(a);
 return {...a,action:'REVIEW_SOURCE_MARKET_POWER',successorId:ids.has(a.successorId)?null:a.successorId,proposedSuccessorIds:(a.proposedSuccessorIds??[]).filter(id=>!ids.has(id)),withheldSuccessorIds:[...new Set([...(a.withheldSuccessorIds??[]),...withheld])]};
});
const newRevisions=parent.newRevisions.filter(r=>!ids.has(r.id));assert.equal(newRevisions.length,1939);
const plan={...parent,newRevisions,existingActions,sourceMarketPowerHeld:[...(parent.sourceMarketPowerHeld??[]),...held],sourceMarketScopeReview:[...(parent.sourceMarketScopeReview??[]),...review],sourceMarketAuditHistory:{previous:parent.sourceMarketAuditHistory??null,parentPath:resolve(dir,'plan.json'),parentHash:sha(raw),auditHash:sha(auditRaw),auditPath:resolve(dir,'source-market-target-scope-audit-v1.json'),actionsHistory,heldIds:[...ids]},summary:{...parent.summary,candidateRevisions:newRevisions.length,sourceRequirements:new Set(newRevisions.map(r=>r.sourceRequirementId)).size,sourceMarketPowerHeld:held.length,sourceMarketScopeReview:review.length,actions:Object.fromEntries([...Map.groupBy(existingActions,a=>a.action)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false};
for(const key of Object.keys(parent).filter(k=>!['newRevisions','existingActions','summary','sourceMarketPowerHeld','sourceMarketScopeReview','sourceMarketAuditHistory'].includes(k)))assert.deepEqual(plan[key],parent[key]);
assert.deepEqual(newRevisions,parent.newRevisions.filter(r=>!ids.has(r.id)));
for(const a of existingActions){assert.ok(!ids.has(a.successorId));assert.ok(!(a.proposedSuccessorIds??[]).some(id=>ids.has(id)));}
const out=resolve(root,'outputs/mann-market-power-held-preview-2026-09-14');await mkdir(out);
const serialized=JSON.stringify(plan,null,2)+'\n';await writeFile(resolve(out,'plan.json'),serialized,{flag:'wx'});
const proof={planHash:sha(serialized),parentHash:sha(raw),retained:newRevisions.length,sources:plan.summary.sourceRequirements,held:held.length,pendingMarketReview:review.length,changedActions:actionsHistory.length,allRemovedRevisionsPreserved:true,productionApplyAllowed:false};
await writeFile(resolve(out,'hold-verification.json'),JSON.stringify(proof,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(proof));
