import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const fullSnapshot=process.argv[2]==='--full-snapshot';
const realParents=process.argv[2]==='--real-parents'||fullSnapshot;
const latest=process.argv[3]==='v3',current=process.argv[3]==='v2'||latest;assert.ok(process.argv.length===2||(process.argv.length===3&&realParents)||(process.argv.length===4&&fullSnapshot&&current));
const revisionCount=latest?1971:current?1958:1932,parentCount=latest?217:current?213:203,totalParents=470+parentCount,totalRevisions=1455+revisionCount;
const raw=await readFile(resolve(dir,`current-staging-payload-${latest?'v6':current?'v4':'v2'}.json`),'utf8'),p=JSON.parse(raw);
const plan=JSON.parse(await readFile(resolve(dir,'plan.json'),'utf8'));
assert.equal(p.planHash,latest?'6b436120dd91f8b1ca909fe1fc51556cdb1906b946c2cccc895e9cc03a18e032':current?'f0ea2b6ece3d08ce654b5d3e3b8d536ca0b419e7f996ee82f2997421f7ac4339':'df04fc11f498bb6e4c48d0b2976e2f01ecc9442ae6fcbc7c3973c7329224c3e5');
assert.deepEqual(p.revisions.map(x=>x.originalRevision),plan.newRevisions);
assert.equal(p.productionApplyAllowed,false);
const temp=await mkdtemp(resolve(tmpdir(),'mann-current-pg-'));
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG'))),PGHOST:temp,PGPORT:'55439',PGUSER:'mann_test',PGDATABASE:'mann_fixture',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
const pg=sql=>{const r=spawnSync('/opt/homebrew/bin/psql',['-X','-q','-v','ON_ERROR_STOP=1','-At'],{env,input:sql,encoding:'utf8',maxBuffer:96*1024*1024});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
const q=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const snake=k=>k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
const fields=['id','sourceRequirementId','vehicleVariantKey','systemCode','componentModel','applicabilityJson','technicalDataJson','verifiedFieldsJson','fieldConfidenceJson','evidenceJson','provenanceJson','matchClass','matchScore','semanticFingerprint','state','verificationStatus','applyEligible'];
const rows=p.revisions.map(x=>Object.fromEntries([...fields.map(k=>[snake(k),x.originalRevision[k]]),['run_id',x.runId]]));
let started=false;
let parentEvidence;
let existingEvidence,existingSnapshot,beforeExisting;
try{
 execFileSync('/opt/homebrew/bin/initdb',['-D',resolve(temp,'data'),'-U','mann_test','--auth=trust','--no-locale'],{stdio:'pipe'});
 execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-l',resolve(temp,'server.log'),'-o',`-k ${temp} -p 55439 -c listen_addresses=''`,'-w','start'],{stdio:'pipe'});started=true;
 execFileSync('/opt/homebrew/bin/createdb',['mann_fixture'],{env,stdio:'pipe'});
 const migration=await readFile(resolve(root,'prisma/migrations/20260902400000_mann_unified_technical_catalog_expand/migration.sql'),'utf8');pg(migration);
 if(realParents){
  const snapshotDir=resolve(root,'outputs/mann-live-audit-1789415211923');
  const parentRaw=await readFile(resolve(snapshotDir,`canonical-parent-drafts-${latest?'v3':current?'v2':'v1'}.json`),'utf8'),parents=JSON.parse(parentRaw);
  assert.equal(parents.payloadHash,sha(raw));
  const existingRaw=await readFile(resolve(snapshotDir,'canonicalVehicles.json'),'utf8');assert.equal(sha(existingRaw),parents.liveVehiclesHash);assert.equal(parents.planHash,p.planHash);
  const convert=r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[snake(k),v]));
  const originals=JSON.parse(existingRaw).map(convert);
  pg(`INSERT INTO mann_vehicle_variants SELECT * FROM jsonb_populate_recordset(NULL::mann_vehicle_variants,${q(originals)});`);
  const originalIds=originals.map(r=>r.variant_key);
  const oldSnapshot=()=>pg(`SELECT jsonb_agg(to_jsonb(v) ORDER BY variant_key) FROM mann_vehicle_variants v WHERE variant_key IN (SELECT jsonb_array_elements_text(${q(originalIds)}));`);
  const before=oldSnapshot();
  const drafts=parents.drafts.map(d=>convert({...d.data,canonicalPayloadHash:d.canonicalPayloadHash,firstSeenAt:'2026-09-14T00:00:00Z',lastSeenAt:'2026-09-14T00:00:00Z'}));
  const cols=Object.keys(drafts[0]);assert.equal(drafts.length,parentCount);
  pg(`BEGIN; INSERT INTO mann_vehicle_variants(${cols.join(',')}) SELECT ${cols.join(',')} FROM jsonb_populate_recordset(NULL::mann_vehicle_variants,${q(drafts)}); COMMIT;`);
  assert.equal(oldSnapshot(),before,'All 470 pre-existing vehicle rows must remain byte-identical in DB representation');
  const mismatches=pg(`SELECT count(*) FROM jsonb_populate_recordset(NULL::mann_vehicle_variants,${q(drafts)}) expected LEFT JOIN mann_vehicle_variants actual USING(variant_key) WHERE actual.variant_key IS NULL OR ${cols.map(c=>`actual.${c} IS DISTINCT FROM expected.${c}`).join(' OR ')};`);
  assert.equal(mismatches,'0');assert.equal(pg('SELECT count(*) FROM mann_vehicle_variants;'),String(totalParents));
  parentEvidence={draftFileHash:sha(parentRaw),liveVehiclesHash:sha(existingRaw),existingVehicleRowsPreserved:originals.length,newParents:parentCount,totalParents,newParentFieldsExact:true,testOnlySeenTimestamps:true};
 }else{
  // Minimal synthetic FK parents only; not a proposed canonical vehicle import.
  pg(`INSERT INTO mann_vehicle_variants(variant_key,make,make_normalized,model,model_normalized,canonical_payload_hash,first_seen_at,last_seen_at)
  SELECT value->>'vehicleVariantKey','TEST','test','TEST','test',value->>'vehicleVariantKey',now(),now() FROM jsonb_array_elements(${q(p.variants)});`);
 }
 if(fullSnapshot){
  const snapshotDir=resolve(root,'outputs/mann-live-audit-1789415211923'),hashes={},ids={};
  const comparison=JSON.parse(await readFile(resolve(snapshotDir,`integration-comparison-${latest?'v3':current?'v2':'v1'}.json`),'utf8'));assert.equal(comparison.planHash,p.planHash);
  for(const [name,table] of [['runs','mann_technical_materialization_runs'],['revisions','mann_technical_association_revisions'],['reviewDecisions','mann_technical_review_decisions']]){
   const text=await readFile(resolve(snapshotDir,`${name}.json`),'utf8');hashes[name]=sha(text);assert.equal(hashes[name],comparison.freshHashes[name]);
   const originals=JSON.parse(text).map(({run,reviewConfirmed,...r})=>Object.fromEntries(Object.entries(r).map(([k,v])=>[snake(k),v])));
   ids[table]=originals.map(r=>r.id);
   pg(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},${q(originals)});`);
  }
  existingSnapshot=()=>Object.fromEntries(Object.entries(ids).map(([table,list])=>[table,pg(`SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM ${table} r WHERE id IN (SELECT jsonb_array_elements_text(${q(list)}));`)]));
  beforeExisting=existingSnapshot();
  existingEvidence={hashes,counts:Object.fromEntries(Object.entries(ids).map(([table,list])=>[table,list.length]))};
 }
 // PLANNED and unapproved remain unchanged. No artificial COMPLETED state here.
 pg(`INSERT INTO mann_technical_materialization_runs(id,status,mode,matcher_version,capacity_parser_version,git_commit,gates_json)
 SELECT value->>'id',value->>'status',value->>'mode','TEST','TEST',repeat('0',40),value->'gatesJson' FROM jsonb_array_elements(${q(p.runs)});`);
 const columns=Object.keys(rows[0]);
 pg(`BEGIN; INSERT INTO mann_technical_association_revisions(${columns.join(',')}) SELECT ${columns.join(',')} FROM jsonb_populate_recordset(NULL::mann_technical_association_revisions,${q(rows)}); COMMIT;`);
 const newIds=rows.map(r=>r.id),newRunIds=p.runs.map(r=>r.id);
 const actual=JSON.parse(pg(`SELECT jsonb_agg(to_jsonb(r)-'created_at'-'supersedes_revision_id' ORDER BY id) FROM mann_technical_association_revisions r WHERE id IN (SELECT jsonb_array_elements_text(${q(newIds)}));`));
 assert.deepEqual(actual,rows.toSorted((a,b)=>a.id.localeCompare(b.id)));
 const runRows=JSON.parse(pg(`SELECT jsonb_agg(jsonb_build_object('id',id,'status',status,'mode',mode,'gatesJson',gates_json,'independentHumanSignoff',independent_human_signoff,'productionApplyAuthorized',production_apply_authorized) ORDER BY id) FROM mann_technical_materialization_runs WHERE id IN (SELECT jsonb_array_elements_text(${q(newRunIds)}));`));
 assert.deepEqual(runRows,p.runs.map(({revisionIds,...r})=>r).toSorted((a,b)=>a.id.localeCompare(b.id)));
 const report={kind:'CURRENT_PAYLOAD_REAL_POSTGRES_ROUNDTRIP',payloadHash:sha(raw),migrationHash:sha(migration),revisions:actual.length,runs:runRows.length,syntheticVehicleParents:p.variants.length,allPersistedRevisionFieldsExact:true,runGatesAndPlannedStateExact:true,explicitPowerHoldsPreserved:actual.filter(r=>r.provenance_json.sourcePowerReviewHold).length,temporaryCluster:temp,productionApplyAllowed:false,limitations:['Test inserts only into a new empty local DB with synthetic vehicle parents.','Not a production importer, live snapshot reconciliation, supersession implementation, rollback or VIN HTTP test.','Non-column revision audit metadata remains in original payload; only actual schema fields round-tripped.','PLANNED runs are intentionally not visible previews.']};
 assert.equal(report.revisions,revisionCount);assert.equal(report.runs,11);assert.equal(report.explicitPowerHoldsPreserved,3);
 if(realParents){
  report.kind='CURRENT_PAYLOAD_WITH_REAL_PARENT_DRAFTS_POSTGRES';
  report.syntheticVehicleParents=0;report.parentEvidence=parentEvidence;
  report.limitations[0]=`Local DB restored from 470 existing vehicle rows plus ${parentCount} actual MANN-derived drafts; new draft seen timestamps are test-only.`;
 }
 if(fullSnapshot){
  assert.deepEqual(existingSnapshot(),beforeExisting,'Every pre-existing revision/run/review must remain unchanged');
  assert.equal(pg('SELECT count(*) FROM mann_technical_association_revisions;'),String(totalRevisions));
  assert.equal(pg('SELECT count(*) FROM mann_technical_materialization_runs;'),'14');
  assert.equal(pg('SELECT count(*) FROM mann_technical_review_decisions;'),'5');
  report.kind='CURRENT_PAYLOAD_ALONGSIDE_FULL_TECHNICAL_SNAPSHOT_POSTGRES';
  report.existingEvidence={...existingEvidence,allExistingRowsPreserved:true,totalRevisions,totalRuns:14};
  report.limitations.push('Existing actions intentionally not executed; coexistence is not a safe published combined profile or complete replacement proof.');
 }
 await writeFile(resolve(dir,latest?'current-payload-full-snapshot-postgres-v3.json':current?'current-payload-full-snapshot-postgres-v2.json':fullSnapshot?'current-payload-full-snapshot-postgres-v1.json':realParents?'current-payload-real-parents-postgres-v1.json':'current-payload-postgres-roundtrip-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}finally{if(started)execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-m','fast','-w','stop'],{stdio:'pipe'});}
