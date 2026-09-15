import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
import {insertOnlyMannDelta} from './lib/mann-insert-only-delta.mjs';
import {captureImportSnapshotSql} from './lib/mann-import-snapshot-guard.mjs';
import {durableReceiptSchemaDraft} from './lib/mann-durable-import-receipt.mjs';
import {insertedBatchRollback} from './lib/mann-inserted-batch-rollback.mjs';
const with02t=process.argv[2]==='--fabia-02t';
const fabia=process.argv[2]==='--fabia'||with02t;assert.ok(process.argv.length===2||(process.argv.length===3&&fabia));
const expectedRevisionCount=with02t?6:fabia?5:4;
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-live-audit-1789469257907');
let raw=await readFile(resolve(dir,fabia?'fabia-scoped-drafts.json':'rio-transmission-drafts-v2.json'),'utf8'),draft=JSON.parse(raw);
const baseDraftHash=sha(raw);
if(with02t){const extraRaw=await readFile(resolve(dir,'fabia-02t-draft.json'),'utf8'),extra=JSON.parse(extraRaw);assert.equal(extra.baseDraftHash,baseDraftHash);assert.equal(extra.liveHash,draft.liveHash);draft={...draft,baseDraftHash,extraDraftHash:sha(extraRaw),newRevisions:[...draft.newRevisions,...extra.newRevisions]};raw=JSON.stringify(draft);}
assert.equal(draft.newRevisions.length,expectedRevisionCount);assert.equal(draft.productionApplyAllowed,false);
assert.equal(sha(await readFile(resolve(dir,'revisions.json'),'utf8')),draft.liveHash);
const replay=JSON.parse(await readFile(resolve(dir,'recorded-vin-fluid-transmission-replay.json'),'utf8'));
const sample=replay.findings.find(f=>f.sampleRef==='5d2f01e54866ee1b');assert.ok(sample);
const candidates=fabia?[...new Map(draft.newRevisions.flatMap(r=>r.applicabilityJson.matchedEngineScope.map(engineCode=>[JSON.stringify([r.vehicleVariantKey,engineCode]),{variantIds:[r.vehicleVariantKey],vehicleContext:{...r.applicabilityJson.sourceVehicleScope,engineCode,productionMonth:'2013-06'}}]))).values()]:sample.evaluations.flatMap(e=>e.candidates).filter(c=>draft.newRevisions.some(r=>c.variantIds.includes(r.vehicleVariantKey)));assert.equal(candidates.length,fabia?4:2);
const temp=await mkdtemp(resolve(tmpdir(),'mann-rio-route-'));
assert.equal(globalThis.prisma,undefined);
const url=new URL('postgresql://mann_test@localhost:55442/mann_fixture');url.searchParams.set('host',temp);process.env.DATABASE_URL=url.toString();process.env.PRISMA_CONNECTION_LIMIT='2';
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG'))),PGHOST:temp,PGPORT:'55442',PGUSER:'mann_test',PGDATABASE:'mann_fixture',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
const pg=(sql,ok=true)=>{const r=spawnSync('/opt/homebrew/bin/psql',['-X','-q','-At','-v','ON_ERROR_STOP=1'],{env,input:sql,encoding:'utf8',timeout:60000,maxBuffer:64*1024*1024});assert.equal(r.status===0,ok,r.stderr);return r.stdout.trim();};
const q=x=>`'${JSON.stringify(x).replaceAll("'","''")}'::jsonb`,snake=k=>k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
const typed=rows=>rows.map(({run,reviewConfirmed,replacesRevisionIds,...r})=>Object.fromEntries(Object.entries(r).map(([k,v])=>[snake(k),v])));
const tables={canonicalVehicles:'mann_vehicle_variants',runs:'mann_technical_materialization_runs',revisions:'mann_technical_association_revisions',reviewDecisions:'mann_technical_review_decisions'};
let started=false;let calls=0;
try{
 execFileSync('/opt/homebrew/bin/initdb',['-D',resolve(temp,'data'),'-U','mann_test','--auth=trust','--no-locale'],{stdio:'pipe'});
 execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-l',resolve(temp,'server.log'),'-o',`-k ${temp} -p 55442 -c listen_addresses=''`,'-w','start'],{stdio:'pipe'});started=true;
 execFileSync('/opt/homebrew/bin/createdb',['mann_fixture'],{env,stdio:'pipe'});
 pg(await readFile(resolve(root,'prisma/migrations/20260902400000_mann_unified_technical_catalog_expand/migration.sql'),'utf8'));
 for(const [file,table]of Object.entries(tables))pg(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},${q(typed(JSON.parse(await readFile(resolve(dir,file+'.json'),'utf8'))))});`);
 const state=()=>Object.fromEntries(Object.values(tables).map(t=>[t,sha(pg(`SELECT jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text) FROM ${t} r;`))]));
 pg(durableReceiptSchemaDraft);
 const before=state(),snapshot=JSON.parse(pg(captureImportSnapshotSql));
 const j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/branch-api':resolve(root,'scripts/fixtures/mann-local-route-auth.mjs')}});
 const {POST}=await j.import('../src/app/api/mann-catalog/technical-profile/route.ts');
 const ask=async(c,type,patch={})=>{calls++;const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:c.variantIds,transmissionType:type,vehicleContext:{...c.vehicleContext,...patch}})}));assert.equal(response.status,200);return response.json();};
 const cases=fabia?candidates.flatMap(c=>[{}, {engineCode:undefined},{engineCode:'WRONG'},{generation:'III'},{productionMonth:'2015-01'},{productionMonth:undefined}].map(patch=>({c,type:undefined,patch}))):candidates.flatMap(c=>['automatic','manual'].flatMap(type=>[{}, {transmissionGearCount:6},{transmissionGearCount:5},{transmissionGearCount:6,confirmedMarket:'EU'},{transmissionGearCount:6,engineCode:'WRONG'}].map(patch=>({c,type,patch}))));
 const recordedCases=[];
 if(fabia){
  const saved=replay.findings.find(f=>f.sampleRef==='4a9b52c189f3eacc');assert.ok(saved);
  for(const c of saved.evaluations.flatMap(e=>e.candidates)){
   recordedCases.push({c,type:undefined,patch:{},expectedIds:[],recorded:true});
   for(const choice of c.engineChoices){
    assert.equal(c.vehicleContext.engineCode,undefined);assert.equal(c.vehicleContext.productionMonth,undefined);assert.equal(c.vehicleContext.year,2013);
    const expectedIds=draft.newRevisions.filter(r=>r.matchClass!=='CONDITIONAL_TRANSMISSION'&&c.variantIds.includes(r.vehicleVariantKey)&&r.applicabilityJson.matchedEngineScope.includes(choice.engineCode)).map(r=>r.id);
    assert.equal(expectedIds.length,3);
    recordedCases.push({c,type:undefined,patch:{engineCode:choice.engineCode},expectedIds,recorded:true});
   }
  }
  assert.equal(recordedCases.length,7);cases.push(...recordedCases);
 }
 const gearboxCases=[];
 if(with02t){
  const transmission=draft.newRevisions.find(r=>r.matchClass==='CONDITIONAL_TRANSMISSION');assert.ok(transmission);
  const selected=replay.findings.find(f=>f.sampleRef==='4a9b52c189f3eacc').evaluations.flatMap(e=>e.candidates).find(c=>c.variantIds.includes(transmission.vehicleVariantKey));assert.ok(selected);
  for(const choice of selected.engineChoices){
   const ordinary=draft.newRevisions.filter(r=>r.matchClass!=='CONDITIONAL_TRANSMISSION'&&selected.variantIds.includes(r.vehicleVariantKey)&&r.applicabilityJson.matchedEngineScope.includes(choice.engineCode)).map(r=>r.id);
   for(const change of [{},{engineCode:undefined},{year:undefined},{year:2015},{transmissionModel:undefined},{transmissionModel:'MQ200'},{transmissionModel:'02J'},{transmissionGearCount:undefined},{transmissionGearCount:6}]){
    const patch={engineCode:choice.engineCode,transmissionModel:'02T',transmissionGearCount:5,...change};
    const identityOkay=!('engineCode'in change)&&!('year'in change),expectedIds=identityOkay?[...ordinary,...(Object.keys(change).length===0?[transmission.id]:[])]:[];
    gearboxCases.push({c:selected,type:'manual',patch,expectedIds,recorded:true});
   }
  }
  assert.equal(gearboxCases.length,18);cases.push(...gearboxCases);
 }
 const baseline=[];for(const c of cases)baseline.push(await ask(c.c,c.type,c.patch));
 const runId='mtmr_rio_local_'+sha(raw).slice(0,16),timestamp=new Date().toISOString();
 const run={id:runId,status:'COMPLETED',mode:'STAGING',matcherVersion:'mann-fluid-matcher-v11',capacityParserVersion:'local-fixture',gitCommit:'797a17eaf5ae7087f1144067b3c6542b12ea454d',sourceSnapshotJson:{localFixture:true},sourceCountsJson:{revisions:4},gatesJson:{conditionalTransmissionPolicy:'USER_CONFIRMED_TRANSMISSION_V1',automaticProductSelection:false},approvalJson:{localFixture:true},independentHumanSignoff:false,productionApplyAuthorized:false,startedAt:timestamp,completedAt:timestamp,createdAt:timestamp,updatedAt:timestamp};
 const revisions=draft.newRevisions.map(r=>({...r,runId,createdAt:timestamp}));
 if(fabia){run.sourceCountsJson.revisions=expectedRevisionCount;run.gatesJson={catalogPreviewPolicy:'MANN_ENGINE_DATE_SCOPED_PREVIEW_V1',automaticProductSelection:false};}
 if(with02t)run.gatesJson.conditionalTransmissionPolicy='USER_CONFIRMED_TRANSMISSION_V1';
 const batchId='rio_fixture_delta_20260915';
 const parentProof=fabia?JSON.parse(await readFile(resolve(dir,'fabia-canonical-parent-drafts.json'),'utf8')):null;
 if(parentProof){assert.equal(parentProof.draftHash,baseDraftHash);assert.equal(parentProof.liveParentsHash,sha(await readFile(resolve(dir,'canonicalVehicles.json'),'utf8')));}
 const vehicles=parentProof?.parents.map(p=>({...p.data,canonicalPayloadHash:p.canonicalPayloadHash}))??[];
 const {sql:apply}=insertOnlyMannDelta({snapshot,revisions,run,vehicles,planHash:sha(raw),batchId,authorizationRef:'Local fixture only, no production authorization'});
 assert.ok(apply.endsWith('COMMIT;'));
 pg(apply.slice(0,-7)+"DO $failure$ BEGIN RAISE EXCEPTION 'injected failure'; END $failure$; COMMIT;",false);
 assert.deepEqual(state(),before);assert.equal(pg('SELECT count(*) FROM mann_technical_import_receipts;'),'0');
 pg(apply);const inserted=state();pg(apply,false);assert.deepEqual(state(),inserted);
 for(let i=0;i<cases.length;i++){
  const c=cases[i],after=await ask(c.c,c.type,c.patch),newItems=after.items.filter(x=>revisions.some(r=>r.id===x.revisionId));
  const expected=c.recorded?c.expectedIds.length>0:fabia?Object.keys(c.patch).length===0:c.patch.transmissionGearCount===6&&!c.patch.engineCode&&!c.patch.confirmedMarket;
  const expectedItems=fabia?revisions.filter(r=>r.matchClass!=='CONDITIONAL_TRANSMISSION'&&c.c.variantIds.includes(r.vehicleVariantKey)&&r.applicabilityJson.matchedEngineScope.includes(c.c.vehicleContext.engineCode)):[];
  assert.equal(newItems.length,c.recorded?c.expectedIds.length:expected?(fabia?expectedItems.length:1):0);
  if(c.recorded)assert.deepEqual(newItems.map(x=>x.revisionId).sort(),[...c.expectedIds].sort());
  else if(fabia&&expected)assert.deepEqual(newItems.map(x=>x.revisionId).sort(),expectedItems.map(r=>r.id).sort());
  for(const old of baseline[i].items)assert.ok(after.items.some(x=>sha(x)===sha(old)));
  if(expected){assert.equal(newItems[0].automaticSelectionEligible,false);assert.equal(newItems[0].capacities.length,1);assert.equal(newItems[0].sourceStatus,'catalog_preview');}
 }
 pg(`UPDATE mann_technical_materialization_runs SET status='PLANNED' WHERE id='${runId}';`);
 for(const c of candidates)assert.equal((await ask(c,'automatic',{transmissionGearCount:6})).items.some(x=>revisions.some(r=>r.id===x.revisionId)),false);
 pg(`UPDATE mann_technical_materialization_runs SET status='COMPLETED' WHERE id='${runId}';`);
 // New psql process recovers actual INSERT RETURNING ownership from database.
 const journal=JSON.parse(pg(`SELECT journal_json FROM mann_technical_import_receipts WHERE batch_id='${batchId}';`));
 assert.equal(journal.runs.length,1);assert.equal(journal.revisions.length,expectedRevisionCount);assert.equal(journal.vehicles.length,fabia?2:0);
 const rollback=insertedBatchRollback(journal);
 const victim=journal.revisions[0];
 pg(`UPDATE mann_technical_association_revisions SET provenance_json=provenance_json||'{"tampered":true}'::jsonb WHERE id='${victim.id}';`);
 const tampered=state();pg(rollback,false);assert.deepEqual(state(),tampered);
 pg(`UPDATE mann_technical_association_revisions SET provenance_json=${q(victim.provenance_json)} WHERE id='${victim.id}';`);
 assert.deepEqual(state(),inserted);
 pg(rollback);assert.deepEqual(state(),before);pg(rollback);assert.deepEqual(state(),before);
 assert.equal(pg('SELECT count(*) FROM mann_technical_import_receipts;'),'1');
 const report={kind:'RIO_LOCAL_POSTGRES_PRISMA_ROUTE_PROOF',draftHash:sha(raw),cases:cases.length,routeCalls:calls,recordedCandidates:candidates.length,duplicateRejected:true,plannedRunHidden:true,fullSnapshotRestored:true,productionApplyAllowed:false,limitations:['Real local PostgreSQL/Prisma/route; authentication stubbed, no production HTTP.','Recorded Rio context plus hypothetical six-speed gearbox confirmation; actual installed transmission unproven.','SQL is a local fixture, not production importer or durable receipt proof.']};
 report.durableDelta={atomicFailureVerified:true,receiptRecoveredFromNewConnection:true,insertedRuns:1,insertedRevisions:expectedRevisionCount,editedRowRollbackRejected:true,repeatedRollbackSafe:true,receiptRetained:true};
 report.durableDelta.insertedVehicles=vehicles.length;
 if(fabia){report.kind='FABIA_LOCAL_POSTGRES_PRISMA_ROUTE_PROOF';report.recordedCandidates=0;report.syntheticEngineContexts=candidates.length;report.limitations[1]='Four source-derived engine contexts, not decoded real VINs. Missing engine remains hidden.';}
 if(fabia){report.recordedVinProbe={sampleRef:'4a9b52c189f3eacc',cases:recordedCases.length,unchosenEngineCases:5,hypotheticalOfferedEngineChoices:2,newItemsPerConfirmedEngine:3};report.limitations.push('One recorded VIN context retains year2013 and missing build month; BXW/CGGB choices were already offered, but installed engine is not independently confirmed.');}
 report.limitations[2]='Pure delta builder tested locally with durable receipt; live source/provider/deployment/backup/authorization checks remain external requirements.';
 if(with02t){report.gearboxCases=gearboxCases.length;report.fourSystemCases=2;report.baseDraftHash=baseDraftHash;report.extraDraftHash=draft.extraDraftHash;}
 const proofName=with02t?'fabia-02t-durable-route-proof':fabia?'fabia-recorded-durable-route-proof':'rio-durable-route-proof';
 await writeFile(resolve(dir,`${proofName}-${Date.now()}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}finally{try{if(globalThis.prisma)await globalThis.prisma.$disconnect();}finally{if(started)execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-m','fast','-w','stop'],{stdio:'pipe'});}}
