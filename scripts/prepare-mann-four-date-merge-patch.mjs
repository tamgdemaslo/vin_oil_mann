import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),path=resolve(dir,'plan.json');
const raw=await readFile(path,'utf8'),plan=JSON.parse(raw),draftRaw=await readFile(resolve(dir,'four-date-successors-v1.json'),'utf8'),batch=JSON.parse(draftRaw);
assert.equal(sha(raw),batch.planHash);assert.equal(sha(raw),'781991fac076332ea36461e32f9d05c3e877a9f726d1f663987599851bdbfcbd');
const hold=JSON.parse(await readFile(resolve(dir,'four-date-preview-hold-v1.json'),'utf8'));
const operations=[],ids=new Map();
const render=x=>JSON.stringify(x,null,2).split('\n').map(l=>'    '+l).join('\n')+',';
for(const f of batch.findings){
 const c=hold.changes.find(c=>c.revisionId===f.originalRevisionId),next=batch.drafts.find(d=>d.id===f.successorId);assert.ok(c&&next);
 assert.deepEqual(plan.newRevisions.find(r=>r.id===c.revisionId),c.held);
 assert.equal(next.sourceRequirementId,c.original.sourceRequirementId);assert.equal(next.vehicleVariantKey,c.original.vehicleVariantKey);
 assert.deepEqual(next.technicalDataJson,c.original.technicalDataJson);assert.deepEqual(next.evidenceJson,c.original.evidenceJson);
 assert.deepEqual(next.applicabilityJson.window.intersection,c.held.provenanceJson.sourceDateReviewHold.proposedWindow);
 assert.deepEqual(next.applicabilityJson.requiredEquipment,c.original.applicabilityJson.requiredEquipment);
 const policy=next.provenanceJson.catalogPreviewPolicy??next.provenanceJson.conditionalEquipmentPolicy;
 const fingerprint=policy==='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1'?sha({policy,sourceRequirementId:next.sourceRequirementId,vehicleVariantKey:next.vehicleVariantKey,applicability:next.applicabilityJson,technicalData:next.technicalDataJson}):sha({policy,sourceRequirementId:next.sourceRequirementId,vehicleVariantKey:next.vehicleVariantKey,applicabilityJson:next.applicabilityJson,technicalDataJson:next.technicalDataJson});
 assert.equal(next.semanticFingerprint,fingerprint);assert.equal(next.id,`mtar_${fingerprint.slice(0,24)}`);assert.equal(next.applyEligible,false);assert.equal(next.verificationStatus,'UNVERIFIED');
 const allowed=structuredClone(c.original);for(const k of ['id','semanticFingerprint','applicabilityJson','provenanceJson'])allowed[k]=next[k];assert.deepEqual(allowed,next);
 operations.push({from:render(c.held),to:render(next)});ids.set(c.revisionId,next.id);
}
let updatedActions=0;
for(const a of plan.existingActions)if(ids.has(a.successorId)){operations.push({from:render(a),to:render({...a,successorId:ids.get(a.successorId)})});updatedActions++;}
assert.equal(updatedActions,2);
const history={parentPlanHash:sha(raw),successorBatchHash:sha(draftRaw),replacements:batch.findings,updatedActionReferences:updatedActions,originalHoldArtifact:'four-date-preview-hold-v1.json',sourceQualityStillUnverified:true};
operations.push({from:'  "kind": "PASSAT_INCLUSIVE_OFFLINE_PREVIEW",',to:'  "kind": "PASSAT_INCLUSIVE_OFFLINE_PREVIEW",\n'+JSON.stringify({fourDateScopeRepair:history},null,2).split('\n').slice(1,-1).join('\n')+','});
for(const o of operations){assert.equal(raw.split(o.from).length,2);o.offset=raw.indexOf(o.from);}
operations.sort((a,b)=>a.offset-b.offset);
let patch=`*** Begin Patch\n*** Update File: ${path}\n`;
for(const o of operations)patch+='@@\n'+o.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+o.to.split('\n').map(l=>'+'+l).join('\n')+'\n';
console.log(patch+'*** End Patch');
