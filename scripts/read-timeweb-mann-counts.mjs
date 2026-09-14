#!/usr/bin/env node
// Fixed read-only diagnostic. Does not accept SQL, write flags, or expose credentials.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
assert.equal(process.argv.length,2);
const raw=readFileSync('.env.local','utf8').match(/^TIMEWEB_MIGRATION_DATABASE_URL\s*=\s*(.*)$/m)?.[1]?.replace(/^(["'])(.*)\1$/,'$2');
assert.ok(raw,'Timeweb connection is not configured');
const u=new URL(raw);assert.equal(u.pathname,'/vin_oil');
const env={...process.env,PGHOST:u.hostname,PGPORT:u.port||'5432',PGUSER:decodeURIComponent(u.username),
  PGPASSWORD:decodeURIComponent(u.password),PGDATABASE:'vin_oil',PGCONNECT_TIMEOUT:'8',
  PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=15000',
  PGSSLMODE:'verify-full',PGSSLROOTCERT:process.env.TIMEWEB_CA_FILE||'system'};
const sql=`BEGIN READ ONLY;
SELECT json_build_object('mannRows',(SELECT count(*) FROM mann_filter_applications),
'fluidRequirements',(SELECT count(*) FROM vehicle_fluid_requirements),
'technicalRevisions',(SELECT count(*) FROM mann_technical_association_revisions),
'activeRevisions',(SELECT count(*) FROM mann_technical_association_revisions WHERE state='ACTIVE'),
'reviewDecisions',(SELECT coalesce(json_agg(json_build_object('id',id,'revisionId',revision_id,'decision',decision,'actorType',actor_type)), '[]'::json) FROM mann_technical_review_decisions),
'readOnly',current_setting('transaction_read_only'));
ROLLBACK;`;
const result=spawnSync('/opt/homebrew/bin/psql',['-X','-A','-t','-v','ON_ERROR_STOP=1','-c',sql],{env,encoding:'utf8',timeout:25000});
if(result.status===0)console.log(result.stdout);
else{
  let diagnostic=result.stderr||result.error?.code||'connection failed';
  for(const value of[raw,u.hostname,u.username,decodeURIComponent(u.username),u.password,decodeURIComponent(u.password)])if(value)diagnostic=diagnostic.split(value).join('[redacted]');
  console.error(JSON.stringify({status:result.status,diagnostic}));process.exitCode=1;
}
