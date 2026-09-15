// Local fixture only. Deliberately not an authorized import/rollback mechanism.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
import {scopedSuccessorMannDelta} from './lib/mann-scoped-successor-delta.mjs';
import {captureImportSnapshotSql} from './lib/mann-import-snapshot-guard.mjs';
import {durableReceiptSchemaDraft} from './lib/mann-durable-import-receipt.mjs';
import {insertedBatchRollback} from './lib/mann-inserted-batch-rollback.mjs';
const skoda=process.argv[2]==='--skoda';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,skoda?'outputs/mann-live-audit-1789479529769':'outputs/mann-live-audit-1789469257907'),load=async f=>JSON.parse(await readFile(resolve(dir,f),'utf8'));
const manual=process.argv[2]==='--manual',combined=process.argv[2]==='--combined',durable=combined||skoda;assert.ok(process.argv.length===2||(process.argv.length===3&&(manual||combined||skoda)));
let draftRaw=await readFile(resolve(dir,skoda?'skoda-service-scoped-drafts.json':manual?'dated-manual-scoped-drafts.json':'legacy-cvt-scoped-drafts.json'),'utf8'),draft=JSON.parse(draftRaw);
if(combined){const extraRaw=await readFile(resolve(dir,'dated-manual-scoped-drafts.json'),'utf8'),extra=JSON.parse(extraRaw);assert.equal(extra.liveHash,draft.liveHash);assert.equal(extra.productionApplyAllowed,false);draft={...draft,inputHashes:[sha(draftRaw),sha(extraRaw)],newRevisions:[...draft.newRevisions,...extra.newRevisions]};draftRaw=JSON.stringify(draft);}
assert.equal(draft.newRevisions.length,combined?4:2);assert.equal(draft.productionApplyAllowed,false);assert.equal(draft.liveHash,sha(await readFile(resolve(dir,'revisions.json'),'utf8')));
const temp=await mkdtemp(resolve(tmpdir(),'mann-legacy-cvt-')),port='55443';
const url=new URL(`postgresql://mann_test@localhost:${port}/mann_fixture`);url.searchParams.set('host',temp);process.env.DATABASE_URL=url.toString();process.env.PRISMA_CONNECTION_LIMIT='2';
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG'))),PGHOST:temp,PGPORT:port,PGUSER:'mann_test',PGDATABASE:'mann_fixture',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
const pg=(sql,success=true)=>{const r=spawnSync('/opt/homebrew/bin/psql',['-X','-q','-At','-v','ON_ERROR_STOP=1'],{env,input:sql,encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024});assert.equal(r.status===0,success,r.stderr);return r.stdout.trim();};
const snake=k=>k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),typed=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!['run','reviewConfirmed','replacesRevisionIds','existingAssociation'].includes(k)).map(([k,v])=>[snake(k),v])),q=x=>`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`;
let started=false;
try{
 execFileSync('/opt/homebrew/bin/initdb',['-D',resolve(temp,'data'),'-U','mann_test','--auth=trust','--no-locale'],{stdio:'pipe'});execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-l',resolve(temp,'server.log'),'-o',`-k ${temp} -p ${port} -c listen_addresses=''`,'-w','start'],{stdio:'pipe'});started=true;execFileSync('/opt/homebrew/bin/createdb',['mann_fixture'],{env,stdio:'pipe'});
 pg(await readFile(resolve(root,'prisma/migrations/20260902400000_mann_unified_technical_catalog_expand/migration.sql'),'utf8'));
 const tables={canonicalVehicles:'mann_vehicle_variants',runs:'mann_technical_materialization_runs',revisions:'mann_technical_association_revisions',reviewDecisions:'mann_technical_review_decisions'};
 for(const [file,table]of Object.entries(tables))pg(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},${q((await load(file+'.json')).map(typed))});`);
 const state=()=>Object.fromEntries(Object.values(tables).map(t=>[t,sha(pg(`SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM ${t} r;`))]));const before=state();
 const j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/branch-api':resolve(root,'scripts/fixtures/mann-local-route-auth.mjs')}}),{POST}=await j.import('../src/app/api/mann-catalog/technical-profile/route.ts');
 const cases=[];
 for(const r of draft.newRevisions){const s=r.applicabilityJson,models=r.provenanceJson.explicitTransmissionModelList.models,hasGears=s.transmissionGearCount!=null,base={...s.sourceVehicleScope,engineCode:s.matchedEngineScope[0],productionMonth:s.window.intersection.from,...(hasGears?{transmissionGearCount:s.transmissionGearCount}:{})};
  const negatives=[{},{engineCode:undefined},{productionMonth:undefined},{engineCode:'WRONG'},...(s.sourceVehicleScope.generation?[{generation:'WRONG'}]:[]),{productionMonth:'2000-01'},{transmissionModel:undefined},{transmissionModel:'WRONG123'},...(hasGears?[{transmissionGearCount:undefined},{transmissionGearCount:s.transmissionGearCount+1}]:[])];
  for(const model of models)for(const patch of negatives)cases.push({r,context:{...base,transmissionModel:model,...patch},type:s.transmissionType,expected:Object.keys(patch).length===0});
  cases.push({r,context:{...base,transmissionModel:models[0]},type:s.transmissionType==='automatic'?'manual':'automatic',expected:false},{r,context:{...base,transmissionModel:models[0]},type:undefined,expected:false});
  if(skoda){const adjacent=(month,delta)=>{const [y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m-1+delta,1));return d.toISOString().slice(0,7);};for(const [productionMonth,expected] of [[s.window.intersection.to,true],[adjacent(s.window.intersection.from,-1),false],[adjacent(s.window.intersection.to,1),false]])cases.push({r,context:{...base,transmissionModel:models[0],productionMonth},type:s.transmissionType,expected});}
 }
 let calls=0;const ask=async c=>{calls++;const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:[c.r.vehicleVariantKey],transmissionType:c.type,vehicleContext:c.context})}));assert.equal(response.status,200);return response.json();};
 const baselines=[];for(const c of cases)baselines.push(await ask(c));
 const runId='mtmr_legacy_cvt_fixture',now=new Date().toISOString(),run={id:runId,status:'COMPLETED',mode:'STAGING',matcherVersion:'mann-fluid-matcher-v11',capacityParserVersion:'local-draft-fixture',gitCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceSnapshotJson:{draftHash:sha(draftRaw)},sourceCountsJson:{revisions:2},gatesJson:{conditionalTransmissionPolicy:'USER_CONFIRMED_TRANSMISSION_V1',transmissionModelListPolicy:'EXPLICIT_ALPHANUMERIC_SOURCE_MODEL_LIST_V1',automaticProductSelection:false},approvalJson:{localFixtureOnly:true},independentHumanSignoff:false,productionApplyAuthorized:false,startedAt:now,completedAt:now,createdAt:now,updatedAt:now};
 let rollback=null;
 if(durable){
  pg(durableReceiptSchemaDraft);run.sourceCountsJson.revisions=draft.newRevisions.length;
  const snapshot=JSON.parse(pg(captureImportSnapshotSql));
  const baselineRows=await load('revisions.json');
  const reconciliations=draft.newRevisions.map(r=>{const old=snapshot.tables.mann_technical_association_revisions.find(x=>x.id===r.existingAssociation.revisionId);assert.ok(old);assert.equal(sha(baselineRows.find(x=>x.id===old.id)),r.existingAssociation.rowHash);return {newRevisionId:r.id,oldRevisionId:old.id,expectedOldRow:structuredClone(old)};});
  const revisions=draft.newRevisions.map(({existingAssociation,...r})=>({...r,runId,createdAt:now}));
  const args={snapshot,revisions,run,reconciliations,planHash:sha({draftRaw,reconciliations}),batchId:'legacy_successor_fixture_20260915',authorizationRef:'Isolated local fixture only; no production permission'};
  const reviewed=structuredClone(args);reviewed.snapshot.tables.mann_technical_review_decisions.push({revision_id:reconciliations[0].oldRevisionId});assert.throws(()=>scopedSuccessorMannDelta(reviewed),/Manual review/);
  const drift=structuredClone(args);drift.reconciliations[0].expectedOldRow.match_score=-1;assert.throws(()=>scopedSuccessorMannDelta(drift),/Exact reviewed/);
  const {sql}=scopedSuccessorMannDelta(args);
  pg(sql.slice(0,-7)+"DO $fail$ BEGIN RAISE EXCEPTION 'injected'; END $fail$; COMMIT;",false);assert.deepEqual(state(),before);assert.equal(pg('SELECT count(*) FROM mann_technical_import_receipts;'),'0');
  pg(sql);const inserted=state();pg(sql,false);assert.deepEqual(state(),inserted);
  const journal=JSON.parse(pg("SELECT journal_json FROM mann_technical_import_receipts WHERE batch_id='legacy_successor_fixture_20260915';"));assert.equal(journal.revisions.length,draft.newRevisions.length);assert.equal(journal.runs.length,1);assert.equal(journal.vehicles.length,0);rollback=insertedBatchRollback(journal);
 }else{
  // Direct fixtures only exercise coexistence; combined mode uses durable SQL.
  pg(`BEGIN; INSERT INTO mann_technical_materialization_runs SELECT * FROM jsonb_populate_record(NULL::mann_technical_materialization_runs,${q(typed(run))}); INSERT INTO mann_technical_association_revisions SELECT * FROM jsonb_populate_recordset(NULL::mann_technical_association_revisions,${q(draft.newRevisions.map(r=>typed({...r,runId,createdAt:now})))}); COMMIT;`);
 }
 const results=[];
 for(let i=0;i<cases.length;i++){const c=cases[i],p=await ask(c),item=p.items.find(x=>x.revisionId===c.r.id);assert.equal(!!item,c.expected);assert.equal(p.items.some(x=>x.revisionId===c.r.existingAssociation.revisionId),false);for(const old of baselines[i].items)assert.ok(p.items.some(x=>sha(x)===sha(old)));if(item){assert.equal(item.automaticSelectionEligible,false);if(skoda){assert.deepEqual(item.capacities.map(x=>[x.serviceContext,x.nominalLiters]),c.r.technicalDataJson.capacities.map(x=>[x.serviceContext,x.nominalLiters]));assert.deepEqual(item.specifications,[c.r.technicalDataJson.specificationText]);if(c.r.applicabilityJson.sourceVehicleScope.model==='kodiaq')assert.equal(item.capacities[1].serviceContextLabel,'полная замена');}else assert.equal(item.capacities.length,1);}results.push({revisionId:c.r.id,expected:c.expected,visible:!!item});}
 pg(`UPDATE mann_technical_materialization_runs SET status='PLANNED' WHERE id='${runId}';`);for(const c of cases.filter(c=>c.expected))assert.equal((await ask(c)).items.some(x=>x.revisionId===c.r.id),false);
 if(durable){pg(`UPDATE mann_technical_materialization_runs SET status='COMPLETED' WHERE id='${runId}';`);pg(rollback);pg(rollback);assert.equal(pg('SELECT count(*) FROM mann_technical_import_receipts;'),'1');}
 else pg(`BEGIN; DELETE FROM mann_technical_association_revisions WHERE run_id='${runId}'; DELETE FROM mann_technical_materialization_runs WHERE id='${runId}'; COMMIT;`);
 assert.deepEqual(state(),before);
 const output=resolve(dir,`${skoda?'skoda-service':combined?'combined-successor':manual?'dated-manual':'legacy-cvt'}-persisted-route-proof-${Date.now()}.json`);await writeFile(output,JSON.stringify({kind:durable?'LOCAL_DURABLE_SCOPED_SUCCESSOR_PROOF':manual?'LOCAL_DATED_MANUAL_PERSISTED_ROUTE_PROOF':'LOCAL_LEGACY_CVT_PERSISTED_ROUTE_PROOF',draftHash:sha(draftRaw),cases:cases.length,calls,results,oldRowsUnchanged:true,plannedRunHidden:true,fullSnapshotRestored:true,durableSuccessorProof:durable,productionApplyAllowed:false,limitations:['Actual local PostgreSQL/Prisma/POST with authentication stub only.','Synthetic source-scoped contexts, not verified VINs or production HTTP.','Production source/provider/backup/runtime checks and explicit approval remain required.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,cases:cases.length,calls,fullSnapshotRestored:true,durableSuccessorProof:durable}));
}finally{try{if(globalThis.prisma)await globalThis.prisma.$disconnect();}finally{if(started)execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-m','fast','-w','stop'],{stdio:'pipe'});}}
