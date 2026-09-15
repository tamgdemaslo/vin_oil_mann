import assert from 'node:assert/strict';
import {sha} from './mann-offline-scope.mjs';
const quote=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const snake=k=>k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
const guard=`DO $$ BEGIN IF current_database()<>'mann_fixture' OR inet_server_addr() IS NOT NULL THEN RAISE EXCEPTION 'LOCAL FIXTURE ONLY'; END IF; END $$;`;
const tables=['mann_vehicle_variants','mann_technical_materialization_runs','mann_technical_association_revisions'];
const keys=['variant_key','id','id'];
// Deliberately local-only: this is not a production authorization or migration.
export function localStagingLifecycle(payload,parents){
 assert.equal(payload.productionApplyAllowed,false);
 assert.equal(payload.writeMode,'DRY_RUN_ONLY');
 assert.equal(parents.planHash,payload.planHash);
 const fields=['id','sourceRequirementId','vehicleVariantKey','systemCode','componentModel','applicabilityJson','technicalDataJson','verifiedFieldsJson','fieldConfidenceJson','evidenceJson','provenanceJson','matchClass','matchScore','semanticFingerprint','state','verificationStatus','applyEligible'];
 const revisions=payload.revisions.map(x=>{
  const r=x.originalRevision;assert.equal(sha(r),x.originalRevisionHash);assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.ok(['STAGED','REVIEW'].includes(r.state));
  return Object.fromEntries([...fields.map(k=>[snake(k),r[k]]),['run_id',x.runId]]);
 });
 const runs=payload.runs.map(r=>{
  assert.equal(r.status,'PLANNED');assert.equal(r.independentHumanSignoff,false);assert.equal(r.productionApplyAuthorized,false);
  return {id:r.id,status:'COMPLETED',mode:'STAGING',matcher_version:'LOCAL_FIXTURE',capacity_parser_version:'LOCAL_FIXTURE',git_commit:'0'.repeat(40),gates_json:r.gatesJson,source_snapshot_json:{localFixtureOnly:true,planHash:payload.planHash},independent_human_signoff:false,production_apply_authorized:false};
 });
 const vehicles=parents.drafts.map(d=>Object.fromEntries(Object.entries({...d.data,canonicalPayloadHash:d.canonicalPayloadHash,firstSeenAt:'2026-09-14T00:00:00Z',lastSeenAt:'2026-09-14T00:00:00Z'}).map(([k,v])=>[snake(k),v])));
 const batches=[vehicles,runs,revisions];
 let apply=`BEGIN;\n${guard}\nCREATE TABLE mann_local_import_journal(table_name text NOT NULL,row_key text NOT NULL,row_image jsonb NOT NULL,PRIMARY KEY(table_name,row_key));\n`;
 for(let i=0;i<tables.length;i++){
  const rows=batches[i],table=tables[i],key=keys[i];assert.ok(rows.length);assert.equal(new Set(rows.map(r=>r[key])).size,rows.length);
  const cols=Object.keys(rows[0]);for(const r of rows)assert.deepEqual(Object.keys(r),cols);
  apply+=`INSERT INTO ${table}(${cols.join(',')}) SELECT ${cols.join(',')} FROM jsonb_populate_recordset(NULL::${table},${quote(rows)});\n`;
  apply+=`INSERT INTO mann_local_import_journal SELECT '${table}',r.${key},to_jsonb(r) FROM ${table} r WHERE r.${key} IN (SELECT jsonb_array_elements_text(${quote(rows.map(r=>r[key]))}));\n`;
 }
 apply+='COMMIT;';
 let rollback=`BEGIN;\n${guard}\n`;
 for(let i=tables.length-1;i>=0;i--){
  const table=tables[i],key=keys[i];
  rollback+=`LOCK TABLE ${table} IN EXCLUSIVE MODE;\nDO $$ BEGIN IF EXISTS(SELECT 1 FROM mann_local_import_journal j LEFT JOIN ${table} r ON r.${key}=j.row_key WHERE j.table_name='${table}' AND to_jsonb(r) IS DISTINCT FROM j.row_image) THEN RAISE EXCEPTION 'Rollback refused: imported row changed or missing in ${table}'; END IF; END $$;\n`;
 }
 for(let i=tables.length-1;i>=0;i--)rollback+=`DELETE FROM ${tables[i]} r USING mann_local_import_journal j WHERE j.table_name='${tables[i]}' AND r.${keys[i]}=j.row_key;\n`;
 rollback+='DROP TABLE mann_local_import_journal; COMMIT;';
 return {apply,rollback,counts:batches.map(r=>r.length)};
}
