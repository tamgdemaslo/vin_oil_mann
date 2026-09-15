// Fixed read-only schema/privilege inspection. No SQL or write flags accepted.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.argv.length,2);
const raw=readFileSync('.env.local','utf8').match(/^TIMEWEB_MIGRATION_DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.trim().replace(/^(["'])(.*)\1$/,'$2');
assert.ok(raw,'Timeweb connection missing');const u=new URL(raw);assert.equal(u.pathname,'/vin_oil');
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG'))),PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:'vin_oil',PGCONNECT_TIMEOUT:'8',PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=15000',PGSSLMODE:'verify-full',PGSSLROOTCERT:process.env.TIMEWEB_CA_FILE||'system',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
const sql=`BEGIN READ ONLY;
SELECT jsonb_build_object(
'database',current_database(),'readOnly',current_setting('transaction_read_only'),
'schemaCreate',has_schema_privilege(current_user,'public','CREATE'),
'receiptTableExists',to_regclass('public.mann_technical_import_receipts') IS NOT NULL,
'migrations',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',migration_name,'checksum',checksum,'finished',finished_at IS NOT NULL,'rolledBack',rolled_back_at IS NOT NULL)), '[]'::jsonb) FROM _prisma_migrations WHERE migration_name IN ('20260902400000_mann_unified_technical_catalog_expand','20260915130000_mann_technical_import_receipts')),
'tables',(SELECT jsonb_agg(jsonb_build_object('table',name,'select',has_table_privilege(current_user,name,'SELECT'),'insert',has_table_privilege(current_user,name,'INSERT'),'update',has_table_privilege(current_user,name,'UPDATE'),'delete',has_table_privilege(current_user,name,'DELETE'),'ownedByCurrentUser',pg_get_userbyid(c.relowner)=current_user)) FROM unnest(ARRAY['public.mann_vehicle_variants','public.mann_technical_materialization_runs','public.mann_technical_association_revisions','public.mann_technical_review_decisions','public._prisma_migrations']) name JOIN pg_class c ON c.oid=to_regclass(name)),
'columns',(SELECT jsonb_agg(jsonb_build_object('table',table_name,'column',column_name,'type',udt_name,'nullable',is_nullable,'default',column_default) ORDER BY table_name,ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('mann_vehicle_variants','mann_technical_materialization_runs','mann_technical_association_revisions','mann_technical_review_decisions'))
); ROLLBACK;`;
const result=spawnSync('/opt/homebrew/bin/psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],{env,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024});
if(result.status!==0){let message=result.stderr||result.error?.code||'preflight failed';for(const value of[raw,u.hostname,u.username,u.password,decodeURIComponent(u.username),decodeURIComponent(u.password)])if(value)message=message.split(value).join('[redacted]');throw Error(message);}
const report=JSON.parse(result.stdout.trim());assert.equal(report.database,'vin_oil');assert.equal(report.readOnly,'on');
console.log(JSON.stringify({...report,columns:report.columns.map(({default:defaultValue,...column})=>({...column,hasDefault:defaultValue!==null}))},null,2));
