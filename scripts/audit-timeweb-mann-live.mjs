#!/usr/bin/env node
// Fixed SELECTs, repeatable-read read-only snapshot; never accepts SQL or apply flags.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
assert.equal(process.argv.length,2);
const root=resolve(import.meta.dirname,'..');
const raw=(await readFile(resolve(root,'.env.local'),'utf8')).match(/^TIMEWEB_MIGRATION_DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.replace(/^(["'])(.*)\1$/,'$2');
assert.ok(raw);const u=new URL(raw);assert.equal(u.pathname,'/vin_oil');
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG'))),PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:'vin_oil',PGCONNECT_TIMEOUT:'8',PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=30000',PGSSLMODE:'verify-full',PGSSLROOTCERT:process.env.TIMEWEB_CA_FILE||'system',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
const sql=`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object('table','mann_filter_applications','row',to_jsonb(t)) FROM mann_filter_applications t ORDER BY id;
SELECT json_build_object('table','vehicle_fluid_requirements','row',to_jsonb(t)) FROM vehicle_fluid_requirements t ORDER BY id;
SELECT json_build_object('table','canonicalVehicles','row',to_jsonb(t)) FROM mann_vehicle_variants t ORDER BY variant_key;
SELECT json_build_object('table','runs','row',to_jsonb(t)) FROM mann_technical_materialization_runs t ORDER BY id;
SELECT json_build_object('table','reviewDecisions','row',to_jsonb(t)) FROM mann_technical_review_decisions t ORDER BY id;
SELECT json_build_object('table','revisions','row',to_jsonb(r),
'run',json_build_object('status',m.status,'mode',m.mode,'independentHumanSignoff',m.independent_human_signoff,'productionApplyAuthorized',m.production_apply_authorized,'gatesJson',m.gates_json),
'reviewConfirmed',EXISTS(SELECT 1 FROM mann_technical_review_decisions d WHERE d.revision_id=r.id AND d.decision='CONFIRM'))
FROM mann_technical_association_revisions r JOIN mann_technical_materialization_runs m ON m.id=r.run_id ORDER BY r.id;
SELECT json_build_object('table','transaction','readOnly',current_setting('transaction_read_only'),'isolation',current_setting('transaction_isolation'));
ROLLBACK;`;
env.PGOPTIONS='-c default_transaction_read_only=on -c statement_timeout=90000';
const result=spawnSync('/opt/homebrew/bin/psql',['-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],{env,encoding:'utf8',timeout:240000,maxBuffer:160*1024*1024});
if(result.status!==0){
  let message=result.stderr||result.error?.code||'read failed';
  for(const value of[raw,u.hostname,u.username,decodeURIComponent(u.username),u.password,decodeURIComponent(u.password)])if(value)message=message.split(value).join('[redacted]');
  throw Error(message);
}
const camel=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase()),v]));
const live=new Map(),revisions=[],integration={canonicalVehicles:[],runs:[],reviewDecisions:[]};let transaction;
for(const line of result.stdout.trim().split('\n')){
  const record=JSON.parse(line);
  if(record.table==='transaction'){transaction=record;continue;}
  if(record.table==='revisions'){revisions.push({...camel(record.row),run:record.run,reviewConfirmed:record.reviewConfirmed});continue;}
  if(Object.hasOwn(integration,record.table)){integration[record.table].push(camel(record.row));continue;}
  if(!live.has(record.table))live.set(record.table,new Map());
  const row=camel(record.row);assert.ok(!live.get(record.table).has(row.id));live.get(record.table).set(row.id,row);
}
assert.equal(transaction.readOnly,'on');assert.equal(transaction.isolation,'repeatable read');
const stable=v=>v&&typeof v==='object'?(Array.isArray(v)?v.map(stable):Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))):v;
const reports={};
for(const [table,path]of[['mann_filter_applications','/tmp/mann_filter_applications.sql'],['vehicle_fluid_requirements','/tmp/vehicle_fluid_requirements.sql']]){
  const sourceRaw=await readFile(path,'utf8'),source=parseCopy(sourceRaw,table),current=live.get(table);
  const ids=new Set(source.map(r=>r.id)),missing=[],changed=[];
  for(const row of source){
    const other=current.get(row.id);if(!other){missing.push(row.id);continue;}
    const fields=[];
    for(const [key,value]of Object.entries(row)){
      let old=value,now=other[key];
      // COPY and PostgreSQL JSON use different timestamp/number encodings.
      if(key.endsWith('At')&&typeof old==='string'&&typeof now==='string'){old=new Date(old).toISOString();now=new Date(now).toISOString();}
      if(typeof now==='number'&&typeof old==='string'&&old.trim()!==''&&Number.isFinite(Number(old)))old=Number(old);
      if(typeof now==='boolean'&&['t','f'].includes(old))old=old==='t';
      if(JSON.stringify(stable(old))!==JSON.stringify(stable(now)))fields.push(key);
    }
    if(fields.length)changed.push({id:row.id,fields});
  }
  reports[table]={snapshotRows:source.length,liveRows:current.size,snapshotSha256:sha(sourceRaw),missing,added:[...current.keys()].filter(id=>!ids.has(id)),changed};
}
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {buildMannUnifiedTechnicalProfile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const states={},profileStatuses={},systems={};
for(const r of revisions){const key=[r.state,r.verificationStatus,r.matchClass].join(' / ');states[key]=(states[key]??0)+1;}
for(const rows of Map.groupBy(revisions,r=>r.vehicleVariantKey).values()){
  const profile=buildMannUnifiedTechnicalProfile(rows.map(r=>({...r,createdAt:new Date(r.createdAt)})));
  profileStatuses[profile.status]=(profileStatuses[profile.status]??0)+1;
  for(const item of profile.items)systems[item.systemCode]=(systems[item.systemCode]??0)+1;
}
const output=resolve(root,'outputs',`mann-live-audit-${Date.now()}`);await mkdir(output);
const report={kind:'TIMEWEB_READ_ONLY_CONTENT_AND_PROFILE_AUDIT',generatedAt:new Date().toISOString(),transaction,sourceTables:reports,
  revisions:revisions.length,revisionStates:states,profileStatuses,visibleItemsBySystem:systems,
  profileEvaluation:'Current local profile code, per-variant, no manual transmission or engine/month context. Not a production HTTP/UI test.',
  integrationCounts:Object.fromEntries(Object.entries(integration).map(([key,rows])=>[key,rows.length])),
  liveDataChanged:false};
await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');
await writeFile(resolve(output,'revisions.json'),JSON.stringify(revisions,null,2)+'\n');
for(const [table,rows]of live)await writeFile(resolve(output,`${table}.json`),JSON.stringify([...rows.values()])+'\n',{flag:'wx'});
for(const [name,rows]of Object.entries(integration))await writeFile(resolve(output,`${name}.json`),JSON.stringify(rows,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,sourceTables:Object.fromEntries(Object.entries(reports).map(([k,v])=>[k,{...v,missing:v.missing.length,added:v.added.length,changed:v.changed.length}])),output},null,2));
