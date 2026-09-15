import assert from 'node:assert/strict';
import {insertOnlyMannDelta} from './mann-insert-only-delta.mjs';

// Additive, explicitly reconciled legacy successors. Never edit or own old rows.
// Caller must bind these inputs into planHash and verify source/provider/authority.
export function scopedSuccessorMannDelta({reconciliations,...input}) {
 const {snapshot,revisions}=input;
 assert.equal(reconciliations.length,revisions.length);
 const allowed=[];
 for(const r of revisions){
  const links=reconciliations.filter(x=>x.newRevisionId===r.id);assert.equal(links.length,1);
  const link=links[0],old=snapshot.tables.mann_technical_association_revisions.find(x=>x.id===link.oldRevisionId);assert.ok(old);
  assert.deepEqual(old,link.expectedOldRow,'Exact reviewed old row required');
  assert.notEqual(r.id,old.id);assert.equal(r.sourceRequirementId,old.source_requirement_id);assert.equal(r.vehicleVariantKey,old.vehicle_variant_key);assert.equal(r.systemCode,old.system_code);assert.equal(r.componentModel,old.component_model);
  assert.equal(old.state,'REVIEW');assert.equal(old.apply_eligible,false);assert.equal(old.verification_status,'UNVERIFIED');assert.deepEqual(old.verified_fields_json,[]);
  assert.equal(snapshot.tables.mann_technical_review_decisions.some(x=>x.revision_id===old.id),false,'Manual review must never be bypassed');
  assert.equal(old.applicability_json?.window,undefined,'Only legacy unscoped rows may be reconciled');
  const samePair=snapshot.tables.mann_technical_association_revisions.filter(x=>x.source_requirement_id===r.sourceRequirementId&&x.vehicle_variant_key===r.vehicleVariantKey);assert.equal(samePair.length,1,'Additional existing association requires fresh review');
  const scope=r.applicabilityJson;assert.ok(scope.sourceVehicleScope?.make&&scope.sourceVehicleScope?.model);assert.ok(scope.window?.intersection?.from);assert.ok(scope.matchedEngineScope?.length);
  assert.equal(r.matchClass,'CONDITIONAL_TRANSMISSION');assert.equal(r.state,'REVIEW');
  assert.equal(r.provenanceJson.conditionalTransmissionEligible,true);assert.equal(input.run.gatesJson.transmissionModelListPolicy,r.provenanceJson.explicitTransmissionModelList?.policy);
  assert.ok(r.provenanceJson.explicitTransmissionModelList?.models?.length);
  assert.equal(scope.componentModel,old.component_model);assert.equal(scope.transmissionType,old.applicability_json.transmissionType);
  if(scope.transmissionType!=='cvt')assert.ok(Number.isInteger(scope.transmissionGearCount));
  allowed.push(old.id);
 }
 assert.equal(new Set(allowed).size,allowed.length);
 const built=insertOnlyMannDelta(input);
 const predicate='a.vehicle_variant_key=e.vehicle_variant_key AND a.source_requirement_id=e.source_requirement_id';
 assert.equal(built.sql.split(predicate).length,2,'Expected unique source-pair guard');
 const ids=allowed.map(id=>`'${id.replaceAll("'","''")}'`).join(',');
 const sql=built.sql.replace(predicate,()=>`${predicate} WHERE a.id NOT IN (${ids})`);
 // Full snapshot guard still locks and compares every old row/decision. The
 // original guard rejects the new IDs on retry, and receipt owns only inserts.
 return {...built,sql,reconciledLegacyIds:allowed};
}
