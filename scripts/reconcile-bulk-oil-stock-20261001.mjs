// Owner-authorized initial alignment to completed physical inventory.
// Fixed six products, no warehouse, receipt, fiscal queue or external marking writes.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID, X509Certificate } from 'node:crypto';
const mode=process.argv[2];assert.ok(['--check','--apply'].includes(mode));assert.equal(process.argv.length,3);
const root='/Volumes/KINGSTON/ТГМ/Эко-платформа';
const config=readFileSync(`${root}/vin_oil_mann/.env.local`,'utf8');
const value=(key)=>config.match(new RegExp(`^${key}\\s*=\\s*(.*)$`,'m'))?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');
const raw=value('TIMEWEB_MIGRATION_DATABASE_URL'),token=value('TIMEWEB_CLOUD_TOKEN');assert.ok(raw&&token);
const url=new URL(raw);assert.equal(url.pathname,'/vin_oil');assert.ok(url.hostname.endsWith('twc1.net')||url.hostname.includes('timeweb'));
const ca='/private/tmp/inventory-margin-timeweb-ca.crt';
assert.equal(new X509Certificate(readFileSync(ca)).fingerprint256.replaceAll(':','').toLowerCase(),'17179badb992feb038426ff31ba66ab7fa711f092ca22705bd7251f3011a124d');
const api=async(path)=>{const r=await fetch(`https://api.timeweb.cloud/api/v1${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});assert.ok(r.ok,`Timeweb HTTP ${r.status}`);return r.json();};
const backup=JSON.parse(readFileSync('/private/tmp/unified-oil-backup-20261001.json','utf8'));
const {backup:verified}=await api(`/dbs/4195453/backups/${backup.id}`);assert.equal(verified.status,'done');assert.ok(verified.size>0);assert.ok(Date.now()-Date.parse(verified.created_at)<4*3600_000);
if(mode==='--apply') {const release=JSON.parse(readFileSync('/private/tmp/unified-oil-release-manifest.json','utf8'));const {app}=await api('/apps/235547');assert.equal(app.status,'active');assert.equal(app.commit_sha,release.commit,'Deploy unified accounting before enabling flags');}
const targets=[
 ['cmqqs3ei10063rs0prb7rfim1','branch-main','cmphcywgx00018zks7b15y6dw',170,170,'cmuphgvpn06beox01v8ujxnb0'],
 ['cmqrzv88r00r1rs0ptfvupqdw','branch-main','cmphcywgx00018zks7b15y6dw',205,195,'cmumm737g0019lg012qvz2beq'],
 ['cmphd19v7007m8zks378zo0gz','branch-main','cmphcywgx00018zks7b15y6dw',29,129.3,null],
 ['cmphd3mnh00f58zksi8o3a26o','branch-main','cmphcywgx00018zks7b15y6dw',55,102.6,'cmun0htj400hkl701l0tnwsjy'],
 ['cmphdkc4o01gs8zkskzfqero8','branch-main','cmphcywgx00018zks7b15y6dw',17.16,17.16,'cmun0c31w00fol701ovokrymm'],
 ['cmth1dd8700b9mh0vc9p2tg3o','cmsd9o02w006qmu01u4ij1lhz','cmslptspy003dt40j0osvmccg',58.6,null,null],
];
const q=(v)=>v==null?'NULL':`'${String(v).replaceAll("'","''")}'`;
const batch='unified-oil-inventory-20261001';
const reason=`По поручению владельца: остаток бочки приведён к складскому остатку после фактической инвентаризации. Склад повторно не списывается. Резервная копия Timeweb ${backup.id}.`;
let sql="BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s';\n";
for(const [id,branch,store] of [...targets].sort((a,b)=>`${a[1]}:${a[2]}:${a[0]}`.localeCompare(`${b[1]}:${b[2]}:${b[0]}`)))sql+=`SELECT pg_advisory_xact_lock(hashtextextended(${q(`${branch}:${store}:${id}`)},0));\n`;
for(const [id,branch] of [...targets].sort((a,b)=>a[0].localeCompare(b[0])))sql+=`SELECT id FROM local_products WHERE id=${q(id)} AND branch_id=${q(branch)} FOR UPDATE;\n`;
for(const [id,branch,store,stock,old,barrel] of targets){
 const next=`jsonb_set(jsonb_set(p.marking_settings_json,'{currentVolumeLiters}',to_jsonb(${stock}::numeric),true),'{warehouseLinked}','true'::jsonb,true)`;
 sql+=`DO $guard$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM local_products p JOIN local_stock_balances s ON s.product_id=p.id AND s.branch_id=p.branch_id WHERE p.id=${q(id)} AND p.branch_id=${q(branch)} AND s.store_id=${q(store)} AND s.quantity=${stock} AND p.marking_mode='BULK_OIL_FROM_MARKED_BARREL' AND p.marking_enabled AND (p.marking_settings_json->>'currentVolumeLiters')::numeric IS NOT DISTINCT FROM ${old??'NULL'}::numeric AND COALESCE((p.marking_settings_json->>'warehouseLinked')::boolean,false)=false) THEN RAISE EXCEPTION 'Initial inventory snapshot changed: ${id}'; END IF;
 IF EXISTS(SELECT 1 FROM local_stock_balances WHERE product_id=${q(id)} AND branch_id=${q(branch)} AND store_id<>${q(store)} AND quantity<>0) THEN RAISE EXCEPTION 'Multiple stores require allocation'; END IF;
 ${barrel?`IF NOT EXISTS(SELECT 1 FROM local_bulk_oil_barrels WHERE id=${q(barrel)} AND branch_id=${q(branch)} AND product_id=${q(id)} AND store_id=${q(store)} AND status='OPEN' AND remaining_liters=${old} AND received_liters>=${stock}) OR (SELECT count(*) FROM local_bulk_oil_barrels WHERE product_id=${q(id)} AND branch_id=${q(branch)} AND status IN ('OPEN','SEALED'))<>1 THEN RAISE EXCEPTION 'Barrel snapshot changed'; END IF;`: `IF EXISTS(SELECT 1 FROM local_bulk_oil_barrels WHERE product_id=${q(id)} AND branch_id=${q(branch)} AND status IN ('OPEN','SEALED')) THEN RAISE EXCEPTION 'Unexpected managed barrel'; END IF;`}
 END $guard$;
 INSERT INTO product_marking_audit_logs(id,branch_id,product_id,old_value,new_value,performed_by_login,performed_by_name)
 SELECT ${q(randomUUID())},p.branch_id,p.id,
 jsonb_build_object('markingEnabled',p.marking_enabled,'markingMode',p.marking_mode,'markingStatus',p.marking_status,'markingSettings',p.marking_settings_json),
 jsonb_build_object('markingEnabled',p.marking_enabled,'markingMode',p.marking_mode,'markingStatus',p.marking_status,'markingSettings',${next},'reason',${q(reason)},'batch',${q(batch)}),
 'owner-authorized:codex','По поручению владельца' FROM local_products p WHERE p.id=${q(id)} AND p.branch_id=${q(branch)};
 UPDATE local_products p SET marking_settings_json=${next},updated_at=now() WHERE p.id=${q(id)} AND p.branch_id=${q(branch)};
 ${barrel?`UPDATE local_bulk_oil_barrels SET remaining_liters=${stock} WHERE id=${q(barrel)} AND branch_id=${q(branch)};
 INSERT INTO local_bulk_oil_barrel_events(id,branch_id,barrel_id,action,operation_key,volume_liters,reason,created_by_login)
 VALUES (${q(randomUUID())},${q(branch)},${q(barrel)},'WAREHOUSE_SYNC',${q(`${batch}:${id}`)},${stock-old},${q(reason)},'owner-authorized:codex');`:''}
 `;
}
sql+=`SELECT jsonb_agg(jsonb_build_object('productId',p.id,'name',p.name,'branchId',p.branch_id,'warehouseLiters',s.quantity,'barrelLiters',(p.marking_settings_json->>'currentVolumeLiters')::numeric,'warehouseLinked',p.marking_settings_json->'warehouseLinked')) FROM local_products p JOIN local_stock_balances s ON s.product_id=p.id AND s.branch_id=p.branch_id WHERE p.id IN (${targets.map(t=>q(t[0])).join(',')});\n${mode==='--apply'?'COMMIT':'ROLLBACK'};`;
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG'))),PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:'vin_oil',PGCONNECT_TIMEOUT:'8',PGSSLMODE:'verify-full',PGSSLROOTCERT:ca,PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
const r=spawnSync('/opt/homebrew/bin/psql',['-X','-q','-At','-v','ON_ERROR_STOP=1'],{env,input:sql,encoding:'utf8',timeout:45000,maxBuffer:1024*1024});
if(r.status!==0){let message=r.stderr||r.error?.code||'Reconciliation failed';for(const secret of [raw,url.hostname,url.username,url.password,decodeURIComponent(url.password)])if(secret)message=message.split(secret).join('[redacted]');throw Error(message);}
const rows=r.stdout.trim().split('\n').findLast(line=>line.startsWith('['));assert.ok(rows);const report={applied:mode==='--apply',batch,backupId:backup.id,at:new Date().toISOString(),rows:JSON.parse(rows)};
writeFileSync(`/private/tmp/unified-oil-reconcile-${mode.slice(2)}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
