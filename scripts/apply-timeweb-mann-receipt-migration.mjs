// Bounded owner-authorized operation: receipt table only, no fluid data import.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {spawnSync} from 'node:child_process';
import {importSnapshotGuard} from './lib/mann-import-snapshot-guard.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--apply'));
const name='20260915130000_mann_technical_import_receipts';
const migration=readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8');
const checksum=createHash('sha256').update(migration).digest('hex');
assert.equal(checksum,'0f8113fffd7ccc75e1ed7b058337141e2e2c792ace6506e9a1d4ba8d0ad7bc56');
const manifest={migration:name,checksum,databaseId:4195453,backupId:103647271,scope:'CREATE_RECEIPT_TABLE_ONLY',authorization:'User explicitly confirmed bounded Timeweb operation in this thread on 2026-09-15',fluidDataWrites:false};
if(process.argv.length===2){console.log(JSON.stringify({...manifest,mode:'DRY_RUN'},null,2));process.exit(0);}
const config=readFileSync('.env.local','utf8');
const value=key=>config.match(new RegExp(`^${key}\\s*=\\s*(.*)$`,'m'))?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');
const raw=value('TIMEWEB_MIGRATION_DATABASE_URL'),token=value('TIMEWEB_CLOUD_TOKEN');assert.ok(raw&&token);
const u=new URL(raw);assert.equal(u.pathname,'/vin_oil');
const api=async path=>{const r=await fetch(`https://api.timeweb.cloud/api/v1${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});assert.ok(r.ok,`Timeweb HTTP ${r.status}`);return r.json();};
const {db}=await api('/dbs/4195453');assert.ok((await lookup(u.hostname,{all:true})).some(row=>row.address===db.ip));assert.equal(String(db.port),String(u.port||5432));
const {backup}=await api('/dbs/4195453/backups/103647271');assert.equal(backup.id,103647271);assert.equal(backup.status,'done');assert.ok(backup.size>0);assert.equal(backup.type,'manual');
const snapshotDirectory='outputs/mann-live-audit-1789467727347';
const snapshotReport=JSON.parse(readFileSync(`${snapshotDirectory}/report.json`));assert.equal(snapshotReport.transaction.readOnly,'on');
const mappings={canonicalVehicles:'mann_vehicle_variants',runs:'mann_technical_materialization_runs',revisions:'mann_technical_association_revisions',reviewDecisions:'mann_technical_review_decisions'};
const tables=Object.fromEntries(Object.entries(mappings).map(([file,table])=>[table,JSON.parse(readFileSync(`${snapshotDirectory}/${file}.json`)).map(({run,reviewConfirmed,...row})=>Object.fromEntries(Object.entries(row).map(([key,v])=>[key.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),v])))]));
const guard=importSnapshotGuard({databaseName:'vin_oil',capturedAt:snapshotReport.generatedAt,tables});
const q=value=>`'${String(value).replaceAll("'","''")}'`;
const sql=`BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';
${guard}
LOCK TABLE _prisma_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF to_regclass('public.mann_technical_import_receipts') IS NOT NULL OR EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name=${q(name)}) THEN RAISE EXCEPTION 'receipt migration already present: inspect, do not repeat'; END IF;
 IF (SELECT count(*) FROM _prisma_migrations WHERE migration_name='20260902400000_mann_unified_technical_catalog_expand' AND checksum='0ded8fba9d14ef93f499fdee2b634ad88ff39812d0394df74e767895a7590122' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)<>1 THEN RAISE EXCEPTION 'base migration mismatch'; END IF;
END $$;
${migration}
INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,logs,rolled_back_at,started_at,applied_steps_count)
VALUES (${q(randomUUID())},${q(checksum)},CURRENT_TIMESTAMP,${q(name)},${q(JSON.stringify({...manifest,backupStatus:'done'}))},NULL,CURRENT_TIMESTAMP,1);
${guard}
COMMIT;
SELECT jsonb_build_object('migration',${q(name)},'checksum',(SELECT checksum FROM _prisma_migrations WHERE migration_name=${q(name)} AND finished_at IS NOT NULL AND rolled_back_at IS NULL),'receiptRows',(SELECT count(*) FROM mann_technical_import_receipts));`;
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG'))),PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:'vin_oil',PGCONNECT_TIMEOUT:'8',PGSSLMODE:'verify-full',PGSSLROOTCERT:'/tmp/mann-timeweb-ca-20260913.crt',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
const r=spawnSync('/opt/homebrew/bin/psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env,input:sql,encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
if(r.status!==0){let error=r.stderr||r.error?.code||'Migration response uncertain; inspect before retry';for(const secret of[raw,u.hostname,u.username,u.password,decodeURIComponent(u.username),decodeURIComponent(u.password)])if(secret)error=error.split(secret).join('[redacted]');throw Error(error);}
const verified=JSON.parse(r.stdout.trim());assert.equal(verified.checksum,checksum);assert.equal(verified.receiptRows,0);
const report={...manifest,applied:true,verified,backup:{id:backup.id,status:backup.status,createdAt:backup.created_at},checkedAt:new Date().toISOString(),backupVerification:'Provider reports completed physical backup; restoration not rehearsed.'};
writeFileSync(`${snapshotDirectory}/receipt-migration-applied.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report,null,2));
