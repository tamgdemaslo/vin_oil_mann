// Fixed read/lock/rollback check only: no import or schema-write mode.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {lookup} from 'node:dns/promises';
import {spawnSync} from 'node:child_process';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {importSnapshotGuard} from './lib/mann-import-snapshot-guard.mjs';
assert.equal(process.argv.length,2);
const directory='outputs/mann-live-audit-1789469257907',read=p=>JSON.parse(readFileSync(p,'utf8'));
const draftRaw=readFileSync(`${directory}/rio-transmission-drafts-v2.json`,'utf8'),draft=JSON.parse(draftRaw);
assert.equal(sha(draftRaw),'17bfd17c606cc154e773af6fd0d395cf86686bcba36adffc6e323be5e78d0343');
const proof=read(`${directory}/rio-durable-route-proof.json`);assert.equal(proof.draftHash,sha(draftRaw));assert.equal(proof.durableDelta.atomicFailureVerified,true);
assert.equal(sha(readFileSync(`${directory}/revisions.json`,'utf8')),draft.liveHash);
const snake=k=>k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
const typed=rows=>rows.map(({run,reviewConfirmed,...r})=>Object.fromEntries(Object.entries(r).map(([k,v])=>[snake(k),v])));
const tables=Object.fromEntries(Object.entries({canonicalVehicles:'mann_vehicle_variants',runs:'mann_technical_materialization_runs',revisions:'mann_technical_association_revisions',reviewDecisions:'mann_technical_review_decisions'}).map(([file,table])=>[table,typed(read(`${directory}/${file}.json`))]));
const snapshot={databaseName:'vin_oil',capturedAt:read(`${directory}/report.json`).generatedAt,tables};
const sr=readFileSync('/tmp/vehicle_fluid_requirements.sql','utf8'),mr=readFileSync('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sr),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
assert.equal(sha(mr),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const ids=[...new Set(draft.newRevisions.map(r=>r.sourceRequirementId))],keys=[...new Set(draft.newRevisions.map(r=>r.vehicleVariantKey))];assert.equal(ids.length,2);assert.equal(keys.length,2);
const source=typed(parseCopy(sr,'vehicle_fluid_requirements').filter(r=>ids.includes(r.id))),mann=typed(parseCopy(mr,'mann_filter_applications').filter(r=>keys.includes(r.vehicleVariantKey)));
const q=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const config=readFileSync('.env.local','utf8'),get=k=>config.match(new RegExp(`^${k}\\s*=\\s*(.*)$`,'m'))?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');
const raw=get('TIMEWEB_MIGRATION_DATABASE_URL'),token=get('TIMEWEB_CLOUD_TOKEN');assert.ok(raw&&token);const u=new URL(raw);assert.equal(u.pathname,'/vin_oil');
const api=async path=>{const r=await fetch(`https://api.timeweb.cloud/api/v1${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});assert.ok(r.ok,`Timeweb HTTP ${r.status}`);return r.json();};
const {db}=await api('/dbs/4195453');assert.ok((await lookup(u.hostname,{all:true})).some(r=>r.address===db.ip));assert.equal(String(db.port),String(u.port||5432));
const {backup}=await api('/dbs/4195453/backups/103647271');assert.equal(backup.status,'done');assert.ok(backup.size>0);
const commit='797a17eaf5ae7087f1144067b3c6542b12ea454d';
const {app}=await api('/apps/235547');assert.equal(app.status,'active');assert.equal(app.commit_sha,commit);
const {deploys}=await api('/apps/235547/deploys');assert.equal(deploys[0].status,'success');assert.equal(deploys[0].commit_sha,commit);
for(const endpoint of ['/api/health/live','/api/health/ready'])assert.equal((await fetch(`https://tamgdemaslocrm.ru${endpoint}`,{redirect:'error',signal:AbortSignal.timeout(20000)})).status,200);
const guard=[['vehicle_fluid_requirements','id',ids,source],['mann_filter_applications','vehicle_variant_key',keys,mann]].map(([table,key,selected,rows])=>`DO $source$ BEGIN IF (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM ${table} r WHERE ${key} IN(SELECT jsonb_array_elements_text(${q(selected)}))) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM jsonb_populate_recordset(NULL::${table},${q(rows)}) r) THEN RAISE EXCEPTION 'source drift: ${table}'; END IF; END $source$;`).join('\n');
const sql=`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'; LOCK TABLE vehicle_fluid_requirements,mann_filter_applications IN SHARE ROW EXCLUSIVE MODE; ${guard} ${importSnapshotGuard(snapshot)}
DO $receipt$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM _prisma_migrations WHERE migration_name='20260915130000_mann_technical_import_receipts' AND checksum='0f8113fffd7ccc75e1ed7b058337141e2e2c792ace6506e9a1d4ba8d0ad7bc56' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN RAISE EXCEPTION 'receipt migration missing'; END IF;
 IF EXISTS(SELECT 1 FROM mann_technical_import_receipts WHERE batch_id='mann_rio_delta_20260915') THEN RAISE EXCEPTION 'batch already exists'; END IF;
 IF EXISTS(SELECT 1 FROM mann_technical_association_revisions WHERE source_requirement_id IN(SELECT jsonb_array_elements_text(${q(ids)})) AND vehicle_variant_key IN(SELECT jsonb_array_elements_text(${q(keys)}))) THEN RAISE EXCEPTION 'association already exists'; END IF;
END $receipt$; ROLLBACK;`;
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG'))),PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:'vin_oil',PGCONNECT_TIMEOUT:'8',PGSSLMODE:'verify-full',PGSSLROOTCERT:'/tmp/mann-timeweb-ca-20260913.crt',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
const result=spawnSync('/opt/homebrew/bin/psql',['-X','-q','-At','-v','ON_ERROR_STOP=1'],{env,input:sql,encoding:'utf8',timeout:90000,maxBuffer:1024*1024});
if(result.status!==0){let message=result.stderr||'Check failed';for(const secret of[raw,u.hostname,u.username,u.password,decodeURIComponent(u.password)])if(secret)message=message.split(secret).join('[redacted]');throw Error(message);}
const report={kind:'TIMEWEB_RIO_DELTA_LIVE_CHECK_ONLY',applied:false,checkedAt:new Date().toISOString(),draftHash:sha(draftRaw),sqlHash:sha(sql),revisions:4,sourceRows:source.length,mannRows:mann.length,backupId:backup.id,runtimeCommit:commit,fullSnapshotMatches:true,receiptMigrationPresent:true};
writeFileSync(`${directory}/rio-live-check-${Date.now()}.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
