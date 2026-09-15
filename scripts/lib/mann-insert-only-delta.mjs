import assert from 'node:assert/strict';
import {importSnapshotGuard} from './mann-import-snapshot-guard.mjs';
import {persistInsertedReceiptSql} from './mann-durable-import-receipt.mjs';

// Pure SQL builder. Provider, backup, source identity, deployed runtime and
// owner authorization must be verified by the caller before execution.
export function insertOnlyMannDelta({snapshot,revisions,run,vehicles=[],planHash,batchId,authorizationRef}) {
 assert.ok(revisions.length>0&&revisions.length<=100);
 assert.equal(run.status,'COMPLETED');assert.equal(run.mode,'STAGING');
 assert.equal(run.independentHumanSignoff,false);assert.equal(run.productionApplyAuthorized,false);
 assert.equal(run.gatesJson.automaticProductSelection,false);
 assert.equal(new Set(revisions.map(r=>r.id)).size,revisions.length);
 assert.ok(vehicles.length<=100);assert.equal(new Set(vehicles.map(v=>v.variantKey)).size,vehicles.length);
 for(const v of vehicles){assert.match(v.variantKey,/^[a-f0-9]{64}$/);assert.ok(revisions.some(r=>r.vehicleVariantKey===v.variantKey));assert.equal(snapshot.tables.mann_vehicle_variants.some(r=>r.variant_key===v.variantKey),false,'New parent must not overwrite existing');}
 const snake=k=>k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
 const typed=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['run','reviewConfirmed','replacesRevisionIds'].includes(k)).map(([k,v])=>[snake(k),v]));
 for(const r of revisions){
  assert.equal(r.runId,run.id);assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');
  assert.ok(['STAGED','REVIEW'].includes(r.state));assert.deepEqual(r.verifiedFieldsJson,[]);
  assert.ok(!r.supersedesRevisionId);assert.equal(r.replacesRevisionIds?.length??0,0);
 }
 const q=x=>`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`;
 const expectedRevisions=revisions.map(typed),expectedRun=typed(run);
 const sql=`BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
${importSnapshotGuard(snapshot)}
CREATE TEMP TABLE _delta_expected_vehicles ON COMMIT DROP AS SELECT * FROM jsonb_populate_recordset(NULL::mann_vehicle_variants,${q(vehicles.map(typed))});
UPDATE _delta_expected_vehicles SET first_seen_at=CURRENT_TIMESTAMP,last_seen_at=CURRENT_TIMESTAMP,created_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP;
CREATE TEMP TABLE _delta_expected_runs ON COMMIT DROP AS SELECT * FROM jsonb_populate_recordset(NULL::mann_technical_materialization_runs,${q([expectedRun])});
CREATE TEMP TABLE _delta_expected_revisions ON COMMIT DROP AS SELECT * FROM jsonb_populate_recordset(NULL::mann_technical_association_revisions,${q(expectedRevisions)});
UPDATE _delta_expected_runs SET started_at=CURRENT_TIMESTAMP,completed_at=CURRENT_TIMESTAMP,created_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP;
UPDATE _delta_expected_revisions SET created_at=CURRENT_TIMESTAMP;
DO $delta$ BEGIN
 IF EXISTS(SELECT 1 FROM mann_technical_association_revisions a JOIN _delta_expected_revisions e ON a.vehicle_variant_key=e.vehicle_variant_key AND a.source_requirement_id=e.source_requirement_id) THEN
  RAISE EXCEPTION 'insert-only delta source/vehicle association already exists';
 END IF;
END $delta$;
CREATE TEMP TABLE _delta_inserted_vehicles ON COMMIT DROP AS WITH inserted AS(INSERT INTO mann_vehicle_variants SELECT * FROM _delta_expected_vehicles RETURNING *) SELECT * FROM inserted;
CREATE TEMP TABLE _delta_inserted_runs ON COMMIT DROP AS WITH inserted AS(INSERT INTO mann_technical_materialization_runs SELECT * FROM _delta_expected_runs RETURNING *) SELECT * FROM inserted;
CREATE TEMP TABLE _delta_inserted_revisions ON COMMIT DROP AS WITH inserted AS(INSERT INTO mann_technical_association_revisions SELECT * FROM _delta_expected_revisions RETURNING *) SELECT * FROM inserted;
DO $delta$ BEGIN
 IF (SELECT jsonb_agg(to_jsonb(r) ORDER BY variant_key) FROM _delta_inserted_vehicles r) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(r) ORDER BY variant_key) FROM _delta_expected_vehicles r)
 OR (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM _delta_inserted_runs r) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM _delta_expected_runs r)
 OR (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM _delta_inserted_revisions r) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM _delta_expected_revisions r) THEN
  RAISE EXCEPTION 'delta inserted row images differ';
 END IF;
END $delta$;
CREATE TEMP TABLE _delta_receipt ON COMMIT DROP AS SELECT jsonb_build_object('kind','INSERTED_ROWS_ONLY','planSha256',${q(planHash)}#>>'{}','vehicles',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY variant_key),'[]'::jsonb) FROM _delta_inserted_vehicles r),'runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM _delta_inserted_runs r),'revisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM _delta_inserted_revisions r)) AS journal;
${persistInsertedReceiptSql({batchId,planHash,authorizationRef,receiptRelation:'_delta_receipt'})}
COMMIT;`;
 return {sql,counts:{runs:1,revisions:revisions.length,vehicles:vehicles.length,replacements:0}};
}
