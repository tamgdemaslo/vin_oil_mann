import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {sha} from './lib/mann-offline-scope.mjs';
import {localStagingLifecycle} from './lib/mann-local-staging-lifecycle.mjs';
import {localSupersession} from './lib/mann-local-supersession.mjs';
import {durableReceiptSchemaDraft,persistInsertedReceiptSql} from './lib/mann-durable-import-receipt.mjs';
import {changedBatchRollback} from './lib/mann-changed-batch-rollback.mjs';
import {auditCombinedProfiles} from './lib/mann-combined-profile-audit.mjs';
import {captureImportSnapshotSql,importSnapshotGuard} from './lib/mann-import-snapshot-guard.mjs';
import {currentPreviewImport} from './lib/mann-current-preview-import.mjs';
const productionBuilder=process.argv[2]==='--production-builder';
assert.ok(process.argv.length===2||(process.argv.length===3&&productionBuilder));

const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),snapshot=resolve(root,'outputs/mann-live-audit-1789415211923');
const payloadRaw=await readFile(resolve(dir,'current-staging-payload-v16.json'),'utf8'),payload=JSON.parse(payloadRaw);
assert.equal(sha(payloadRaw),'e713b27d714b94cc03807f015641660841bf8b5aafb5af3756143a836e140585');
assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),payload.planHash);
const parents=JSON.parse(await readFile(resolve(snapshot,'canonical-parent-drafts-v13.json'),'utf8'));
assert.equal(parents.payloadHash,sha(payloadRaw));
const insertion=localStagingLifecycle(payload,parents),replacement=localSupersession(payload,319);
assert.deepEqual(insertion.counts,[221,11,2049]);
const body=sql=>{assert.ok(sql.startsWith('BEGIN;'));assert.ok(sql.endsWith('COMMIT;'));return sql.slice(6,-7);};
const q=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
let apply=`BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';
${body(insertion.apply)}
${body(replacement.apply)}
CREATE TEMP TABLE _mann_current_receipt ON COMMIT DROP AS SELECT jsonb_build_object(
'kind','INSERTED_ROWS_WITH_REVISION_CHANGES','planSha256',${q(payload.planHash)}#>>'{}',
'vehicles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.variant_key) FROM mann_vehicle_variants r JOIN mann_local_import_journal j ON j.table_name='mann_vehicle_variants' AND j.row_key=r.variant_key),
'runs',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM mann_technical_materialization_runs r JOIN mann_local_import_journal j ON j.table_name='mann_technical_materialization_runs' AND j.row_key=r.id),
'revisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM mann_technical_association_revisions r JOIN mann_local_import_journal j ON j.table_name='mann_technical_association_revisions' AND j.row_key=r.id),
'revisionChanges',(SELECT jsonb_agg(to_jsonb(j) ORDER BY j.id) FROM mann_local_supersession_journal j)) AS journal;
${persistInsertedReceiptSql({batchId:'local_current_v16',planHash:payload.planHash,authorizationRef:'LOCAL_FIXTURE_ONLY',receiptRelation:'_mann_current_receipt'})}
DROP TABLE mann_local_supersession_journal,mann_local_import_journal;
COMMIT;`;
const temp=await mkdtemp(resolve(tmpdir(),'mann-current-durable-'));
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG'))),PGHOST:temp,PGPORT:'55443',PGUSER:'mann_test',PGDATABASE:'mann_fixture',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
assert.equal(globalThis.prisma,undefined);
const localUrl=new URL('postgresql://mann_test@localhost:55443/mann_fixture');localUrl.searchParams.set('host',temp);
process.env.DATABASE_URL=localUrl.toString();process.env.PRISMA_CONNECTION_LIMIT='2';
const pg=(sql,ok=true)=>{const r=spawnSync('/opt/homebrew/bin/psql',['-X','-q','-v','ON_ERROR_STOP=1','-At'],{env,input:sql,encoding:'utf8',maxBuffer:128*1024*1024});if(ok)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0);return r;};
const tables={canonicalVehicles:'mann_vehicle_variants',runs:'mann_technical_materialization_runs',revisions:'mann_technical_association_revisions',reviewDecisions:'mann_technical_review_decisions'};
const snake=key=>key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),camel=key=>key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
const state=()=>Object.fromEntries(Object.values(tables).map(table=>[table,sha(pg(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM ${table} r;`).stdout.trim())]));
let started=false;
try {
 execFileSync('/opt/homebrew/bin/initdb',['-D',resolve(temp,'data'),'-U','mann_test','--auth=trust','--no-locale'],{stdio:'pipe'});
 execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-l',resolve(temp,'server.log'),'-o',`-k ${temp} -p 55443 -c listen_addresses=''`,'-w','start'],{stdio:'pipe'});started=true;
 execFileSync('/opt/homebrew/bin/createdb',['mann_fixture'],{env,stdio:'pipe'});
 pg(await readFile(resolve(root,'prisma/migrations/20260902400000_mann_unified_technical_catalog_expand/migration.sql'),'utf8'));
 pg(durableReceiptSchemaDraft);
 if(productionBuilder) pg("CREATE TABLE _prisma_migrations(migration_name text,checksum text,finished_at timestamptz,rolled_back_at timestamptz); INSERT INTO _prisma_migrations VALUES ('20260915130000_mann_technical_import_receipts','0f8113fffd7ccc75e1ed7b058337141e2e2c792ace6506e9a1d4ba8d0ad7bc56',CURRENT_TIMESTAMP,NULL);");
 for(const [file,table] of Object.entries(tables)){
  const rows=JSON.parse(await readFile(resolve(snapshot,file+'.json'),'utf8')).map(({run,reviewConfirmed,...row})=>Object.fromEntries(Object.entries(row).map(([key,value])=>[snake(key),value])));
  pg(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},${q(rows)});`);
 }
 const before=state();
 const reviewedSnapshot=JSON.parse(pg(captureImportSnapshotSql).stdout.trim());
 const guard=importSnapshotGuard(reviewedSnapshot);
 const firstRevision=reviewedSnapshot.tables.mann_technical_association_revisions[0];
 // Identity/fingerprint can stay unchanged while technical data changes.
 pg(`UPDATE mann_technical_association_revisions SET technical_data_json=technical_data_json||'{"snapshotTest":true}'::jsonb WHERE id=${q(firstRevision.id)}#>>'{}';`);
 const changedBeforeImport=state();
 assert.match(pg(`BEGIN; ${guard} COMMIT;`,false).stderr,/import snapshot drift/);
 assert.deepEqual(state(),changedBeforeImport);
 pg(`UPDATE mann_technical_association_revisions SET technical_data_json=${q(firstRevision.technical_data_json)} WHERE id=${q(firstRevision.id)}#>>'{}';`);
 pg(`INSERT INTO mann_technical_review_decisions(id,revision_id,decision,actor_type,reason) VALUES ('snapshot_new_review',${q(firstRevision.id)}#>>'{}','REJECT','HUMAN','Local fixture');`);
 const reviewedBeforeImport=state();
 assert.match(pg(`BEGIN; ${guard} COMMIT;`,false).stderr,/import snapshot drift/);assert.deepEqual(state(),reviewedBeforeImport);
 pg("DELETE FROM mann_technical_review_decisions WHERE id='snapshot_new_review';");
 assert.deepEqual(state(),before);
 const wrongDatabase=importSnapshotGuard({...reviewedSnapshot,databaseName:'wrong_database'});
 assert.match(pg(`BEGIN; ${wrongDatabase} COMMIT;`,false).stderr,/database mismatch/);
 if(productionBuilder){
  const built=currentPreviewImport({payload,parents,snapshot:reviewedSnapshot,metadata:{gitCommit:'797a17eaf5ae7087f1144067b3c6542b12ea454d',capacityParserVersion:'sha256:'+sha(await readFile(resolve(root,'src/lib/fluid-capacity-conditions.ts'),'utf8')),matcherVersion:'mann-fluid-matcher-v11',databaseName:'mann_fixture',backupId:103647271,batchId:'local_current_v16',authorizationRef:'LOCAL_FIXTURE_ONLY'}});
  assert.deepEqual(built.counts,[221,11,2049]);assert.equal(built.replacementCount,319);apply=built.sql;
 }else apply=apply.replace("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';",`SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';\n${guard}`);
 const injected=apply.replace(/COMMIT;\s*$/,'SELECT 1/0; COMMIT;');assert.notEqual(injected,apply);
 const failed=pg(injected,false);
 assert.match(failed.stderr,/division by zero/);assert.deepEqual(state(),before);
 assert.equal(pg('SELECT count(*) FROM mann_technical_import_receipts;').stdout.trim(),'0');
 pg(apply);const after=state();assert.notDeepEqual(after,before);
 const receipt=JSON.parse(pg("SELECT to_jsonb(r) FROM mann_technical_import_receipts r WHERE batch_id='local_current_v16';").stdout.trim());
 assert.deepEqual([receipt.journal_json.vehicles.length,receipt.journal_json.runs.length,receipt.journal_json.revisions.length,receipt.journal_json.revisionChanges.length],[221,11,2049,638]);
 pg(apply,false);assert.deepEqual(state(),after);
 const persisted=JSON.parse(pg("SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('run',to_jsonb(m),'reviewConfirmed',EXISTS(SELECT 1 FROM mann_technical_review_decisions d WHERE d.revision_id=r.id AND d.decision='CONFIRM'))) FROM mann_technical_association_revisions r JOIN mann_technical_materialization_runs m ON r.run_id=m.id WHERE r.state IN ('ACTIVE','STAGED','REVIEW');").stdout).map(row=>({...Object.fromEntries(Object.entries(row).filter(([key])=>key!=='run').map(([key,value])=>[camel(key),value])),run:Object.fromEntries(Object.entries(row.run).map(([key,value])=>[camel(key),value])),createdAt:new Date(row.created_at)}));
 const profiles=await auditCombinedProfiles(root,persisted,payload,true,true,true);
 assert.equal(profiles.contextsWithDifferences,0);
 const rollback=changedBatchRollback(receipt);
 const old=receipt.journal_json.revisionChanges.find(row=>!receipt.journal_json.revisions.some(inserted=>inserted.id===row.id));
 pg(`UPDATE mann_technical_association_revisions SET provenance_json=provenance_json||'{"manualTest":true}'::jsonb WHERE id=${q(old.id)}#>>'{}';`);
 const edited=state();assert.match(pg(rollback,false).stderr,/row changed or missing/);assert.deepEqual(state(),edited);
 pg(`UPDATE mann_technical_association_revisions SET provenance_json=${q(old.after_image.provenance_json)} WHERE id=${q(old.id)}#>>'{}';`);
 pg(`INSERT INTO mann_technical_review_decisions(id,revision_id,decision,actor_type,reason) VALUES ('local_durable_review',${q(old.id)}#>>'{}','REJECT','HUMAN','Local fixture');`);
 const reviewed=state();assert.match(pg(rollback,false).stderr,/review decisions exist/);assert.deepEqual(state(),reviewed);
 pg("DELETE FROM mann_technical_review_decisions WHERE id='local_durable_review';");assert.deepEqual(state(),after);
 pg(rollback);assert.deepEqual(state(),before);
 assert.deepEqual(JSON.parse(pg("SELECT to_jsonb(r) FROM mann_technical_import_receipts r WHERE batch_id='local_current_v16';").stdout.trim()),receipt,'Audit receipt retained after rollback');
 const report={kind:'CURRENT_V16_LOCAL_DURABLE_IMPORT_AND_REPLACEMENT',payloadHash:sha(payloadRaw),insertedRows:insertion.counts,replacements:319,changeImages:638,atomicFailureVerified:true,receiptRecoveredFromNewConnection:true,repeatImportRejected:true,changedOldRowRollbackRejected:true,anyReviewRollbackRejected:true,fullFourTableSnapshotRestored:true,profiles,productionApplyAllowed:false,limitations:['Local fixture with synthetic completed STAGING metadata, not a production importer or authorization.','Saved snapshot only; fresh Timeweb data and backup not checked.','Profile contexts probe applicability; they do not prove all fluids for every VIN.','Receipt schema draft not deployed.']};
 report.productionBuilderTested=productionBuilder;
 if(productionBuilder) report.limitations[0]='Production SQL builder tested only on local fixture; authorization/backup metadata are test inputs, not production execution proof.';
 await writeFile(resolve(temp,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({result:resolve(temp,'result.json'),insertedRows:report.insertedRows,replacements:319,contexts:profiles.uniqueContexts,actualDatabaseProfilesChecked:profiles.actualDatabaseProfilesChecked,actualRouteProfilesChecked:profiles.actualRouteProfilesChecked,fullFourTableSnapshotRestored:true}));
} finally {
 try{if(globalThis.prisma)await globalThis.prisma.$disconnect();}finally{if(started)execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-m','fast','-w','stop'],{stdio:'pipe'});}
}
