import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {insertedBatchRollback} from './lib/mann-inserted-batch-rollback.mjs';
import {durableReceiptSchemaDraft,persistInsertedReceiptSql} from './lib/mann-durable-import-receipt.mjs';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const temp=await mkdtemp(resolve(tmpdir(),'mann-isolated-pg-'));
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG'))),PGHOST:temp,PGPORT:'55439',PGUSER:'mann_test',PGDATABASE:'vin_oil',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
const pg=(sql,ok=true)=>{const r=spawnSync('/opt/homebrew/bin/psql',['-X','-v','ON_ERROR_STOP=1','-At'],{env,input:sql,encoding:'utf8'});if(ok)assert.equal(r.status,0,r.stderr);return r;};
let started=false;
try{
 execFileSync('/opt/homebrew/bin/initdb',['-D',resolve(temp,'data'),'-U','mann_test','--auth=trust','--no-locale'],{stdio:'pipe'});
 execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-l',resolve(temp,'server.log'),'-o',`-k ${temp} -p 55439 -c listen_addresses=''`,'-w','start'],{stdio:'pipe'});started=true;
 execFileSync('/opt/homebrew/bin/createdb',['vin_oil'],{env,stdio:'pipe'});
 const fixtureOutput=execFileSync(process.execPath,[resolve(root,'scripts/test-mann-unified-technical-full-staging.mjs'),'--report-fixture'],{encoding:'utf8'});
 const fixture=JSON.parse(fixtureOutput.trim().split('\n').at(-1));
 const migration=await readFile(resolve(root,'prisma/migrations/20260902400000_mann_unified_technical_catalog_expand/migration.sql'),'utf8');
 pg(migration);
 pg(durableReceiptSchemaDraft); // Isolated fixture only, not a deployed migration.
 const nullKind=pg(`INSERT INTO mann_technical_import_receipts(batch_id,plan_sha256,authorization_ref,journal_json) VALUES ('invalid_test','${'a'.repeat(64)}','ISOLATED_TEST_ONLY',jsonb_build_object('kind',null,'planSha256','${'a'.repeat(64)}','vehicles','[]'::jsonb,'runs','[]'::jsonb,'revisions','[]'::jsonb));`,false);
 assert.notEqual(nullKind.status,0);assert.match(nullKind.stderr,/check constraint/);
 pg(`CREATE TABLE _prisma_migrations(migration_name text,finished_at timestamptz,rolled_back_at timestamptz);
 INSERT INTO _prisma_migrations VALUES ('20260902400000_mann_unified_technical_catalog_expand',now(),null);
 CREATE TABLE mann_filter_applications(id text); CREATE TABLE vehicle_fluid_requirements(id text); CREATE TABLE fluid_source_rows(id text);`);
 const originalSql=await readFile(fixture.sqlPath,'utf8'),planRaw=await readFile(fixture.planPath,'utf8'),plan=JSON.parse(planRaw);
 const planHash=createHash('sha256').update(planRaw).digest('hex');
 assert.equal(originalSql.split('\nCOMMIT;').length,2);
 const withReceipt=batchId=>originalSql.replace('\nCOMMIT;',`\n${persistInsertedReceiptSql({batchId,planHash,authorizationRef:'ISOLATED_TEST_ONLY',receiptRelation:'_mann_full_staging_receipt'})}\nCOMMIT;`);
 let sql=withReceipt('fixture_attempt_1');
 const storedReceipt=()=>JSON.parse(pg("SELECT journal_json FROM mann_technical_import_receipts WHERE batch_id='fixture_attempt_1';").stdout.trim());
 const snapshot=()=>pg(`SELECT jsonb_build_object('vehicles',(SELECT jsonb_agg(to_jsonb(t) ORDER BY variant_key) FROM mann_vehicle_variants t),'runs',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM mann_technical_materialization_runs t),'revisions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM mann_technical_association_revisions t),'reviews',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM mann_technical_review_decisions t));`).stdout.trim();
 const empty=snapshot();
 // Inject a failing statement inside the generated transaction to prove atomicity.
 const injected=pg(sql.replace('\nCOMMIT;','\nSELECT 1/0;\nCOMMIT;'),false);
 assert.notEqual(injected.status,0);assert.match(injected.stderr,/division by zero/);assert.equal(snapshot(),empty);
 assert.equal(pg('SELECT count(*) FROM mann_technical_import_receipts;').stdout.trim(),'0');
 const importJournal=()=>JSON.parse(pg(sql).stdout.trim().split('\n').at(-1)).insertedJournal;
 const journal=importJournal(),applied=snapshot();
 assert.deepEqual(storedReceipt(),journal,'New psql connection recovers committed receipt after import connection closes');
 assert.equal(journal.vehicles.length,2);assert.equal(journal.runs.length,1);assert.equal(journal.revisions.length,2);
 const repeated=importJournal();
 assert.deepEqual([repeated.vehicles,repeated.runs,repeated.revisions],[[],[],[]]);
 assert.equal(snapshot(),applied,'Repeat import must not change timestamps or payloads');
 assert.deepEqual(storedReceipt(),journal,'Empty retry receipt must never overwrite original ownership');
 const conflict=pg(sql.replaceAll('ISOLATED_TEST_ONLY','OTHER_TEST_AUTHORITY'),false);
 assert.notEqual(conflict.status,0);assert.match(conflict.stderr,/receipt batch identity conflict/);
 assert.equal(snapshot(),applied);assert.deepEqual(storedReceipt(),journal);
 for(const key of ['vehicles','runs','revisions'])assert.deepEqual(journal[key],JSON.parse(applied)[key]);
 const runId=plan.materializationRun.id;assert.match(runId,/^[a-z0-9_]+$/);
 for(const [field,changed,original] of [
  ['status',"'RUNNING'","'COMPLETED'"],
  ['gates_json',"gates_json || '{\"unexpected\":true}'::jsonb","gates_json - 'unexpected'"],
 ]){
  pg(`UPDATE mann_technical_materialization_runs SET ${field}=${changed} WHERE id='${runId}';`);
  const beforeRetry=snapshot(),denied=pg(sql,false);
  assert.notEqual(denied.status,0);assert.match(denied.stderr,/existing run conflicts/);assert.equal(snapshot(),beforeRetry);
  pg(`UPDATE mann_technical_materialization_runs SET ${field}=${original} WHERE id='${runId}';`);
 }
 assert.equal(snapshot(),applied,'Only artificial run mutations were restored');
 const rollback=insertedBatchRollback(journal);
 // A partial disappearance must not be mistaken for an idempotent rollback.
 const missingRevision=journal.revisions[0];
 const quotedImage=`'${JSON.stringify(missingRevision).replaceAll("'","''")}'::jsonb`;
 pg(`DELETE FROM mann_technical_association_revisions WHERE id=${quotedImage}->>'id';`);
 const partiallyMissing=snapshot(),partialRollback=pg(rollback,false);
 assert.notEqual(partialRollback.status,0);assert.match(partialRollback.stderr,/partially missing/);
 assert.equal(snapshot(),partiallyMissing,'Partial rollback rejection must preserve every remaining row');
 pg(`INSERT INTO mann_technical_association_revisions SELECT (jsonb_populate_record(NULL::mann_technical_association_revisions,${quotedImage})).*;`);
 assert.equal(snapshot(),applied);
 const sentinel='f'.repeat(64);
 pg(`INSERT INTO mann_vehicle_variants SELECT (jsonb_populate_record(NULL::mann_vehicle_variants, to_jsonb(v)||jsonb_build_object('variant_key','${sentinel}'))).* FROM mann_vehicle_variants v LIMIT 1;`);
 pg(rollback);
 const afterRollback=JSON.parse(snapshot());
 assert.equal(afterRollback.vehicles.length,1);assert.equal(afterRollback.vehicles[0].variant_key,sentinel);
 assert.equal(afterRollback.runs,null);assert.equal(afterRollback.revisions,null);
 const reverted=snapshot();pg(rollback);assert.equal(snapshot(),reverted,'Repeated rollback preserves unrelated row');
 const reusedAttempt=pg(sql,false);
 assert.notEqual(reusedAttempt.status,0);assert.match(reusedAttempt.stderr,/receipt batch ownership conflict/);
 assert.equal(snapshot(),reverted);assert.deepEqual(storedReceipt(),journal);
 sql=withReceipt('fixture_attempt_2');
 const reimportedJournal=importJournal();
 assert.ok(reimportedJournal.vehicles.every(v=>v.variant_key!==sentinel));
 const currentRollback=insertedBatchRollback(reimportedJournal);
 const id=plan.revisions[0].id;assert.match(id,/^[a-z0-9_]+$/);
 pg(`UPDATE mann_technical_association_revisions SET technical_data_json=technical_data_json||'{"manualCorrection":"retain"}'::jsonb WHERE id='${id}';
 INSERT INTO mann_technical_review_decisions(id,revision_id,decision,actor_type,reason) VALUES ('test_manual_review','${id}','CONFIRM','HUMAN','Isolated test fixture');`);
 const edited=snapshot(),collision=pg(sql,false);assert.notEqual(collision.status,0);assert.match(collision.stderr,/existing revision payload conflict/);assert.equal(snapshot(),edited);
 const deniedRollback=pg(currentRollback,false);assert.notEqual(deniedRollback.status,0);assert.match(deniedRollback.stderr,/review decisions exist/);assert.equal(snapshot(),edited);
 // Remove only the test-authored review to exercise the independent edit guard.
 pg("DELETE FROM mann_technical_review_decisions WHERE id='test_manual_review';");
 const correctionOnly=snapshot(),editRollback=pg(currentRollback,false);assert.notEqual(editRollback.status,0);assert.match(editRollback.stderr,/association_revisions changed/);assert.equal(snapshot(),correctionOnly);
 const report={kind:'ISOLATED_POSTGRES_FULL_STAGING_TEST',postgres:execFileSync('/opt/homebrew/bin/postgres',['--version'],{encoding:'utf8'}).trim(),temporaryCluster:temp,fixtureRows:2,firstImport:true,exactIdempotency:true,injectedTransactionFailureRolledBack:true,editedPayloadConflictRejected:true,manualReviewAndCorrectionPreserved:true,committedRollbackPreservesUnrelatedVehicle:true,repeatRollback:true,rollbackRejectsPartialMissingBatch:true,rollbackRejectsReview:true,rollbackRejectsPayloadEdit:true,actualReturningJournal:true,repeatImportJournalEmpty:true,limitations:['Old-format two-row fixture, not current2049plan import.','Real expand migration; legacy tables are minimal count-only fixtures.','Receipt emitted after commit; durable production receipt storage and crash recovery not implemented.','No production connection or concurrent race test.']};
 Object.assign(report,{durableReceiptAtomic:true,receiptRecoveredInNewConnection:true,emptyRetryPreservesOriginalReceipt:true,receiptAuthorizationConflictRejected:true,reusedAttemptAfterRollbackRejected:true});
 report.limitations[2]='Durable receipt schema installed only in isolated fixture; production schema approval and current2049 importer integration remain outstanding.';
 await writeFile(resolve(temp,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}finally{
 if(started)execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-m','fast','-w','stop'],{stdio:'pipe'});
}
