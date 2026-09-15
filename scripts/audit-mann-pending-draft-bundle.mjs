import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {sha} from './lib/mann-offline-scope.mjs';
const older='outputs/mann-live-audit-1789469257907',latest='outputs/mann-live-audit-1789479529769';
const read=p=>JSON.parse(readFileSync(p,'utf8'));
const live=read(`${latest}/revisions.json`),vehicles=read(`${latest}/canonicalVehicles.json`),sources=read(`${latest}/vehicle_fluid_requirements.json`);
const parents=read(`${older}/fabia-canonical-parent-drafts.json`).parents;
const files=['rio-transmission-drafts-v2','fabia-scoped-drafts','fabia-02t-draft','legacy-cvt-scoped-drafts','dated-manual-scoped-drafts'].map(n=>`${older}/${n}.json`).concat(`${latest}/skoda-service-scoped-drafts.json`);
const records=[],ids=new Set(),pairs=new Set();
for(const file of files){const raw=readFileSync(file,'utf8'),a=JSON.parse(raw);assert.equal(a.productionApplyAllowed,false);
 for(const r of a.newRevisions){
  assert.equal(ids.has(r.id),false);ids.add(r.id);assert.equal(live.some(x=>x.id===r.id),false);
  const pair=`${r.sourceRequirementId}:${r.vehicleVariantKey}`;assert.equal(pairs.has(pair),false);pairs.add(pair);
  assert.ok(sources.some(s=>s.id===r.sourceRequirementId));
  const parent=vehicles.find(v=>v.variantKey===r.vehicleVariantKey),pendingParent=parents.find(v=>v.data.variantKey===r.vehicleVariantKey);
  assert.ok(parent||pendingParent,'Missing vehicle parent '+r.id);
  const old=live.filter(x=>x.sourceRequirementId===r.sourceRequirementId&&x.vehicleVariantKey===r.vehicleVariantKey);
  if(r.existingAssociation){assert.equal(old.length,1);assert.equal(old[0].id,r.existingAssociation.revisionId);assert.equal(sha(old[0]),r.existingAssociation.rowHash);assert.equal(old[0].reviewConfirmed,false);}
  else assert.equal(old.length,0,'Insert-only draft has existing source/vehicle pair');
  assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');
  records.push({id:r.id,sourceId:r.sourceRequirementId,key:r.vehicleVariantKey,file,inputHash:sha(raw),kind:old.length?'SCOPED_LEGACY_SUCCESSOR':'INSERT_ONLY',parent:parent?'EXISTING':'PENDING_FABIA',capacityContexts:(r.technicalDataJson?.capacities??[]).map(c=>({kind:c.kind,serviceContext:c.serviceContext,nominalLiters:c.nominalLiters})),runtimeV7Required:(r.technicalDataJson?.capacities??[]).some(c=>c.kind==='FULL_REPLACEMENT')});
 }
}
assert.equal(records.length,16);assert.equal(parents.length,2);
const summary={revisions:records.length,insertOnly:records.filter(r=>r.kind==='INSERT_ONLY').length,legacySuccessors:records.filter(r=>r.kind==='SCOPED_LEGACY_SUCCESSOR').length,pendingParents:parents.length,requiresV7:records.filter(r=>r.runtimeV7Required).length};
const output=`${latest}/pending-bundle-audit-${Date.now()}.json`;
writeFileSync(output,JSON.stringify({generatedAt:new Date().toISOString(),snapshot:latest,summary,records,productionApplyAllowed:false,limitations:['Snapshot reconciliation only, not a new production read.','Not a combined import or production authorization.','Separate insert-only and legacy reconciliation policies must remain enforced.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,summary}));
