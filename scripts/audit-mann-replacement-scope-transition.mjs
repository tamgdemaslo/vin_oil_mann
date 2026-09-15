import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),freshDir=resolve(root,'outputs/mann-live-audit-1789415211923');
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),'df04fc11f498bb6e4c48d0b2976e2f01ecc9442ae6fcbc7c3973c7329224c3e5');
const p=JSON.parse(raw),liveRaw=await readFile(resolve(freshDir,'revisions.json'),'utf8');assert.equal(sha(liveRaw),'53976af26ffa3b016ab3bb49836e15b1529562795c6f3a0577b2eae92cf6bf48');
const old=new Map(JSON.parse(liveRaw).map(r=>[r.id,r])),next=new Map(p.newRevisions.map(r=>[r.id,r]));
const findings=[];
const month=s=>{assert.match(s,/^\d{4}-(0[1-9]|1[0-2])$/);return Number(s.slice(0,4))*12+Number(s.slice(5))-1;};
const stamp=m=>`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
for(const action of p.existingActions.filter(a=>a.action==='REPLACE_WITH_PREVIEW')){
 const before=old.get(action.revisionId),ids=action.successorIds??[action.successorId],after=ids.map(id=>next.get(id));assert.ok(after.every(Boolean));
 assert.equal(before.semanticFingerprint,action.expectedSemanticFingerprint);assert.equal(before.state,action.expectedState);
 const a=before.applicabilityJson,range=a.window?.intersection??{from:Number.isInteger(a.yearFrom)?`${a.yearFrom}-01`:null,to:Number.isInteger(a.yearTo)?`${a.yearTo}-12`:null};
 const scopes=after.flatMap(r=>r.technicalDataJson.capacityBranches?.map(b=>b.applicabilityJson)??[r.applicabilityJson]);
 const finite=range.from&&range.to;let uncovered=[];
 if(finite){
  let start=null;
  for(let m=month(range.from);m<=month(range.to);m++){
   const covered=scopes.some(s=>{const w=s.window?.intersection;return w&&(!w.from||m>=month(w.from))&&(!w.to||m<=month(w.to));});
   if(!covered&&start===null)start=m;
   if(covered&&start!==null){uncovered.push({from:stamp(start),to:stamp(m-1)});start=null;}
  }
  if(start!==null)uncovered.push({from:stamp(start),to:range.to});
 }
 const oldEngines=a.matchedEngineScope??a.engineCodes??[],newEngines=[...new Set(scopes.flatMap(s=>s.matchedEngineScope??[]))];
 findings.push({revisionId:before.id,successorIds:ids,sourceRequirementId:before.sourceRequirementId,vehicleVariantKey:before.vehicleVariantKey,systemCode:before.systemCode,
  protectedBefore:!!before.reviewConfirmed||before.verificationStatus!=='UNVERIFIED'||before.applyEligible,
  heldSuccessorIds:after.filter(r=>r.provenanceJson.sourcePowerReviewHold||r.provenanceJson.sourceDateReviewHold).map(r=>r.id),
  componentChanged:after.some(r=>r.componentModel!==before.componentModel),
  oldDateEnvelope:range,newDateEnvelopes:scopes.map(s=>s.window?.intersection??null),uncoveredDateEnvelopes:uncovered,dateEnvelopeStatus:finite?'FINITE_CHECKED':'OPEN_OR_MISSING_REQUIRES_REVIEW',
  oldEngineTokens:oldEngines,newEngineTokens:newEngines,oldEngineTokensNotInNew:oldEngines.filter(e=>!newEngines.includes(e)),
  addedConditions:scopes.map(s=>Object.fromEntries(['requiredMarket','requiredTransmission','requiredEquipment'].filter(k=>s[k]&&!a[k]).map(k=>[k,s[k]]))).filter(o=>Object.keys(o).length),
  publicationAllowed:false});
}
assert.equal(findings.length,307);
const summary={replacements:findings.length,protectedBefore:findings.filter(f=>f.protectedBefore).length,heldSuccessors:findings.filter(f=>f.heldSuccessorIds.length).length,componentChanges:findings.filter(f=>f.componentChanged).length,dateEnvelopeNarrowed:findings.filter(f=>f.uncoveredDateEnvelopes.length).length,unboundedOldDates:findings.filter(f=>f.dateEnvelopeStatus!=='FINITE_CHECKED').length,oldEngineTokensExcluded:findings.filter(f=>f.oldEngineTokensNotInNew.length).length,addedConditions:findings.filter(f=>f.addedConditions.length).length};
const report={kind:'REPLACEMENT_SCOPE_TRANSITION_OBLIGATIONS',planHash:sha(raw),liveSnapshotHash:sha(liveRaw),summary,findings,productionApplyAllowed:false,limitations:['Date union only, independent of engine/equipment/market; not full applicability coverage proof.','Literal engine token comparison, no new aliases inferred.','Excluded old date/engine scope may be erroneous old matching; not automatically restored.','Narrowing must be traced to source evidence or retained as an explicit unresolved obligation before treating a source as fully resolved.','No existing rows changed or replacement action executed.']};
await writeFile(resolve(dir,'replacement-scope-transition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
