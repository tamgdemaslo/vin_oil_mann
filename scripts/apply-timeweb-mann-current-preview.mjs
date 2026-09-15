// Owner-approved bounded import. Default is offline dry-run; no arbitrary SQL.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {lookup} from 'node:dns/promises';
import {spawnSync} from 'node:child_process';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {currentPreviewImport} from './lib/mann-current-preview-import.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&['--check','--source-check','--apply'].includes(process.argv[2])));
const sourceCheckOnly=process.argv[2]==='--source-check';
const directory='outputs/mann-gentra-evidence-review-2026-09-14',snapshotDirectory='outputs/mann-live-audit-1789467727347';
const load=p=>JSON.parse(readFileSync(p,'utf8'));
const payloadRaw=readFileSync(`${directory}/current-staging-payload-v16.json`,'utf8'),payload=JSON.parse(payloadRaw);
assert.equal(sha(payloadRaw),'e713b27d714b94cc03807f015641660841bf8b5aafb5af3756143a836e140585');
assert.equal(sha(readFileSync(`${directory}/plan.json`,'utf8')),payload.planHash);
const parents=load('outputs/mann-live-audit-1789415211923/canonical-parent-drafts-v13.json');assert.equal(parents.payloadHash,sha(payloadRaw));
const evidence=load(`${snapshotDirectory}/receipt-migration-applied.json`);assert.equal(evidence.applied,true);assert.equal(evidence.backup.id,103647271);
const report=load(`${snapshotDirectory}/report.json`);assert.equal(report.transaction.readOnly,'on');
const snake=k=>k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
const toRow=row=>Object.fromEntries(Object.entries(row).map(([key,v])=>[snake(key),v]));
const tables=Object.fromEntries(Object.entries({canonicalVehicles:'mann_vehicle_variants',runs:'mann_technical_materialization_runs',revisions:'mann_technical_association_revisions',reviewDecisions:'mann_technical_review_decisions'}).map(([file,table])=>[table,load(`${snapshotDirectory}/${file}.json`).map(({run,reviewConfirmed,...row})=>toRow(row))]));
const snapshot={databaseName:'vin_oil',capturedAt:report.generatedAt,tables};
const metadata={databaseName:'vin_oil',gitCommit:'797a17eaf5ae7087f1144067b3c6542b12ea454d',matcherVersion:'mann-fluid-matcher-v11',capacityParserVersion:'sha256:'+sha(readFileSync('src/lib/fluid-capacity-conditions.ts','utf8')),backupId:103647271,batchId:'mann_preview_v16_20260915',authorizationRef:'Owner confirmed bounded Timeweb preview import in current thread, 2026-09-15'};
const built=currentPreviewImport({payload,parents,snapshot,metadata});
const sourceRaw=readFileSync('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=readFileSync('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sourceRaw),payload.sourceHash);assert.equal(sha(mannRaw),payload.mannHash);
const sourceIds=new Set(payload.revisions.map(r=>r.originalRevision.sourceRequirementId)),variantKeys=new Set(payload.variants.map(r=>r.vehicleVariantKey));
const sourceRows=parseCopy(sourceRaw,'vehicle_fluid_requirements').filter(r=>sourceIds.has(r.id)).map(toRow);
const mannRows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>variantKeys.has(r.vehicleVariantKey)).map(toRow);
assert.equal(sourceRows.length,1546);assert.equal(new Set(mannRows.map(r=>r.vehicle_variant_key)).size,552);
const q=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`,s=v=>`'${String(v).replaceAll("'","''")}'`;
const sourceGuard=`LOCK TABLE vehicle_fluid_requirements,mann_filter_applications IN SHARE ROW EXCLUSIVE MODE;
${[['vehicle_fluid_requirements','id',sourceRows,[...sourceIds]],['mann_filter_applications','vehicle_variant_key',mannRows,[...variantKeys]]].map(([table,key,rows,ids])=>`DO $$ BEGIN IF (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM ${table} r WHERE ${key} IN(SELECT jsonb_array_elements_text(${q(ids)}))) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM jsonb_populate_recordset(NULL::${table},${q(rows)}) r) THEN RAISE EXCEPTION 'source snapshot drift: ${table}'; END IF; END $$;`).join('\n')}`;
const guarded=built.sql.replace('BEGIN;',()=>`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';\n${sourceGuard}`);assert.notEqual(guarded,built.sql);
assert.ok(guarded.includes(sourceGuard),'Source guard must remain byte-identical, including SQL dollar quoting');
const summary={batchId:metadata.batchId,counts:built.counts,replacements:built.replacementCount,sqlHash:sha(guarded),planHash:payload.planHash,sourceRows:sourceRows.length,mannRows:mannRows.length};
if(process.argv.length===2){console.log(JSON.stringify({...summary,mode:'OFFLINE_DRY_RUN',applied:false},null,2));process.exit(0);}
const config=readFileSync('.env.local','utf8');const get=key=>config.match(new RegExp(`^${key}\\s*=\\s*(.*)$`,'m'))?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');
const raw=get('TIMEWEB_MIGRATION_DATABASE_URL'),token=get('TIMEWEB_CLOUD_TOKEN');assert.ok(raw&&token);const u=new URL(raw);assert.equal(u.pathname,'/vin_oil');
const api=async path=>{const r=await fetch(`https://api.timeweb.cloud/api/v1${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});assert.ok(r.ok,`Timeweb HTTP ${r.status}`);return r.json();};
const {db}=await api('/dbs/4195453');assert.ok((await lookup(u.hostname,{all:true})).some(r=>r.address===db.ip));assert.equal(String(db.port),String(u.port||5432));
const {backup}=await api('/dbs/4195453/backups/103647271');assert.equal(backup.status,'done');assert.ok(backup.size>0);
if(!sourceCheckOnly){
const {app}=await api('/apps/235547');assert.equal(app.status,'active','Deployment not yet active; do not restart or import');assert.equal(app.commit_sha,metadata.gitCommit);
const {deploys}=await api('/apps/235547/deploys');assert.equal(deploys[0].commit_sha,metadata.gitCommit);assert.equal(deploys[0].status,'success');
assert.ok(app.domains.some(d=>d.fqdn==='tamgdemaslocrm.ru'));
for(const endpoint of ['/api/health/live','/api/health/ready']){const r=await fetch(`https://tamgdemaslocrm.ru${endpoint}`,{signal:AbortSignal.timeout(20000),redirect:'error'});assert.equal(r.status,200,`${endpoint} not healthy`);}
}
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG'))),PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:'vin_oil',PGCONNECT_TIMEOUT:'8',PGSSLMODE:'verify-full',PGSSLROOTCERT:'/tmp/mann-timeweb-ca-20260913.crt',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
// --check obtains locks and validates source/four-table snapshots, then rolls
// back without any data writes. It does not run the INSERT/UPDATE statements.
const {importSnapshotGuard}=await import('./lib/mann-import-snapshot-guard.mjs');
const check=`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s'; ${sourceGuard} ${importSnapshotGuard(snapshot)} ROLLBACK;`;
const sql=process.argv[2]!=='--apply'?check:guarded+`\nSELECT jsonb_build_object('batchId',batch_id,'planHash',plan_sha256,'vehicles',jsonb_array_length(journal_json->'vehicles'),'runs',jsonb_array_length(journal_json->'runs'),'revisions',jsonb_array_length(journal_json->'revisions'),'changeImages',jsonb_array_length(journal_json->'revisionChanges')) FROM mann_technical_import_receipts WHERE batch_id=${s(metadata.batchId)};`;
const result=spawnSync('/opt/homebrew/bin/psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'],{env,input:sql,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
if(result.status!==0){let message=result.stderr||result.error?.code||'Response uncertain: inspect persisted batch receipt before retry';for(const secret of[raw,u.hostname,u.username,u.password,decodeURIComponent(u.username),decodeURIComponent(u.password)])if(secret)message=message.split(secret).join('[redacted]');throw Error(message);}
if(process.argv[2]!=='--apply'){console.log(JSON.stringify({...summary,mode:sourceCheckOnly?'SOURCE_CHECK_ONLY':'LIVE_CHECK_ONLY',deploymentChecked:!sourceCheckOnly,applied:false}));process.exit(0);}
const verification=JSON.parse(result.stdout.trim());assert.deepEqual([verification.vehicles,verification.runs,verification.revisions,verification.changeImages],[221,11,2049,638]);assert.equal(verification.planHash,payload.planHash);
const applied={...summary,applied:true,verification,checkedAt:new Date().toISOString(),backupId:backup.id,gitCommit:metadata.gitCommit,automaticProductSelection:false};
writeFileSync(`${snapshotDirectory}/current-preview-applied.json`,JSON.stringify(applied,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(applied,null,2));
