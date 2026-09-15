import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
import {localStagingLifecycle} from './lib/mann-local-staging-lifecycle.mjs';
import {localSupersession} from './lib/mann-local-supersession.mjs';
import {auditCombinedProfiles} from './lib/mann-combined-profile-audit.mjs';
const rearAir=process.argv[2]==='--route-read-v9';
const complete=process.argv[2]==='--route-read-v8'||rearAir;
const expanded=process.argv[2]==='--route-read-v7'||complete;
const routeRead=process.argv[2]==='--route-read'||expanded;
const runtimeRead=process.argv[2]==='--runtime-read'||routeRead;
const sourceDate=process.argv[2]==='--combined-profile-source-date'||runtimeRead;
const transmissionPrecedence=process.argv[2]==='--combined-profile-transmission'||sourceDate;
const precedence=process.argv[2]==='--combined-profile-precedence'||transmissionPrecedence;
const combined=process.argv[2]==='--combined-profile'||precedence;
const withSupersession=process.argv[2]==='--supersession'||combined;
assert.ok(process.argv.length===2||(process.argv.length===3&&withSupersession));
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),snapshot=resolve(root,'outputs/mann-live-audit-1789415211923');
const payloadRaw=await readFile(resolve(dir,rearAir?'current-staging-payload-v9.json':complete?'current-staging-payload-v8.json':expanded?'current-staging-payload-v7.json':'current-staging-payload-v6.json'),'utf8'),payload=JSON.parse(payloadRaw);
assert.equal(sha(payloadRaw),rearAir?'632591070521adeaa0c3a93818fe787bda52a551ca96042c27326f25ee5d6452':complete?'8b718f46a200c20e38c2196ca07d3423a549c4a5601a39ab399640b78a70e710':expanded?'fdc807b615f6992ed77c0975f129f7f33c716b5848d5b55acb19c867bc74514e':'5e03354b16c41c324bb636b26a5ec7663be1bfa5ca64a5f8454592b481a64c77');
const parents=JSON.parse(await readFile(resolve(snapshot,rearAir?'canonical-parent-drafts-v6.json':complete?'canonical-parent-drafts-v5.json':expanded?'canonical-parent-drafts-v4.json':'canonical-parent-drafts-v3.json'),'utf8'));assert.equal(parents.payloadHash,sha(payloadRaw));
const lifecycle=localStagingLifecycle(payload,parents);assert.deepEqual(lifecycle.counts,[217,11,rearAir?2018:complete?2007:expanded?1992:1971]);
const temp=await mkdtemp(resolve(tmpdir(),'mann-lifecycle-pg-'));
if(runtimeRead){
 assert.equal(globalThis.prisma,undefined,'No pre-existing database client allowed in fixture');
 const localUrl=new URL('postgresql://mann_test@localhost:55441/mann_fixture');
 localUrl.searchParams.set('host',temp);
 process.env.DATABASE_URL=localUrl.toString();
 process.env.PRISMA_CONNECTION_LIMIT='2';
}
const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG'))),PGHOST:temp,PGPORT:'55441',PGUSER:'mann_test',PGDATABASE:'mann_fixture',PGSERVICEFILE:'/dev/null',PGPASSFILE:'/dev/null'};
const pg=(sql,success=true)=>{const r=spawnSync('/opt/homebrew/bin/psql',['-X','-q','-v','ON_ERROR_STOP=1','-At'],{env,input:sql,encoding:'utf8',maxBuffer:128*1024*1024});if(success)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0);return r.stdout.trim();};
const q=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const snake=k=>k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase());
const camel=k=>k.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
const tables={canonicalVehicles:'mann_vehicle_variants',runs:'mann_technical_materialization_runs',revisions:'mann_technical_association_revisions',reviewDecisions:'mann_technical_review_decisions'};
let started=false;
try{
 execFileSync('/opt/homebrew/bin/initdb',['-D',resolve(temp,'data'),'-U','mann_test','--auth=trust','--no-locale'],{stdio:'pipe'});
 execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-l',resolve(temp,'server.log'),'-o',`-k ${temp} -p 55441 -c listen_addresses=''`,'-w','start'],{stdio:'pipe'});started=true;
 execFileSync('/opt/homebrew/bin/createdb',['mann_fixture'],{env,stdio:'pipe'});
 pg(await readFile(resolve(root,'prisma/migrations/20260902400000_mann_unified_technical_catalog_expand/migration.sql'),'utf8'));
 for(const [file,table] of Object.entries(tables)){
  const rows=JSON.parse(await readFile(resolve(snapshot,file+'.json'),'utf8')).map(({run,reviewConfirmed,...r})=>Object.fromEntries(Object.entries(r).map(([k,v])=>[snake(k),v])));
  pg(`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},${q(rows)});`);
 }
 const state=()=>Object.fromEntries(Object.values(tables).map(t=>[t,sha(pg(`SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM ${t} r;`))]));
 const before=state();
 pg(lifecycle.apply);
 const after=state();assert.notDeepEqual(before,after);
 // Reapplication must fail atomically and preserve the committed result.
 pg(lifecycle.apply,false);assert.deepEqual(state(),after);
 let supersessionProof=null,combinedProof=null;
 if(withSupersession){
  const replacement=localSupersession(payload);
  pg(replacement.apply);
  assert.equal(pg("SELECT count(*) FROM mann_local_supersession_journal;"),'614');
  assert.equal(pg("SELECT count(*) FROM mann_technical_association_revisions r JOIN mann_local_supersession_journal j ON r.id=j.id WHERE r.state='SUPERSEDED';"),'307');
  const replaced=state();pg(replacement.apply,false);assert.deepEqual(state(),replaced);
  if(combined){
   const persisted=JSON.parse(pg("SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('run',to_jsonb(m),'reviewConfirmed',EXISTS(SELECT 1 FROM mann_technical_review_decisions d WHERE d.revision_id=r.id AND d.decision='CONFIRM'))) FROM mann_technical_association_revisions r JOIN mann_technical_materialization_runs m ON r.run_id=m.id WHERE r.state IN ('ACTIVE','STAGED','REVIEW');")).map(r=>({...Object.fromEntries(Object.entries(r).filter(([k])=>k!=='run').map(([k,v])=>[camel(k),v])),run:Object.fromEntries(Object.entries(r.run).map(([k,v])=>[camel(k),v])),createdAt:new Date(r.created_at)}));
   combinedProof=await auditCombinedProfiles(root,persisted,payload,runtimeRead,routeRead,complete);
   combinedProof.profileRuntimeHash=sha(await readFile(resolve(root,'src/lib/mann-unified-technical-profile.ts'),'utf8'));
   if(sourceDate){assert.equal(combinedProof.contextsWithDifferences,0);combinedProof.sourceDateHelperHash=sha(await readFile(resolve(root,'src/lib/mann-source-date-exclusions.ts'),'utf8'));}
await writeFile(resolve(dir,rearAir?'current-persisted-route-read-v9.json':complete?'current-persisted-route-read-v8.json':expanded?'current-persisted-route-read-v7.json':routeRead?'current-persisted-route-read-v1.json':runtimeRead?'current-persisted-runtime-read-v1.json':sourceDate?'current-persisted-combined-profile-v4.json':transmissionPrecedence?'current-persisted-combined-profile-v3.json':precedence?'current-persisted-combined-profile-v2.json':'current-persisted-combined-profile-v1.json'),JSON.stringify(combinedProof,null,2)+'\n',{flag:'wx'});
  }
  const one=payload.existingActions.find(a=>a.action==='REPLACE_WITH_PREVIEW').successorId;
  pg(`UPDATE mann_technical_association_revisions SET provenance_json=provenance_json||'{"supersessionTamper":true}'::jsonb WHERE id=${q(one)}#>>'{}';`);
  const modified=state();pg(replacement.rollback,false);assert.deepEqual(state(),modified);
  pg("UPDATE mann_technical_association_revisions r SET provenance_json=j.after_image->'provenance_json' FROM mann_local_supersession_journal j WHERE r.id=j.id;");
  assert.deepEqual(state(),replaced);
  pg(replacement.rollback);assert.deepEqual(state(),after);
  supersessionProof={replacements:replacement.count,journaledBeforeAfterRows:614,repeatRejected:true,changedSuccessorRollbackRejected:true,fullSnapshotRestored:true};
 }
 const rows=JSON.parse(pg(`SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('run',to_jsonb(m))) FROM mann_technical_association_revisions r JOIN mann_technical_materialization_runs m ON r.run_id=m.id WHERE r.id IN (SELECT jsonb_array_elements_text(${q(payload.revisions.map(r=>r.originalRevision.id))}));`)).map(r=>({...Object.fromEntries(Object.entries(r).filter(([k])=>k!=='run').map(([k,v])=>[camel(k),v])),run:Object.fromEntries(Object.entries(r.run).map(([k,v])=>[camel(k),v])),reviewConfirmed:false}));
 assert.equal(rows.length,rearAir?2018:complete?2007:expanded?1992:1971);
 // Match Prisma's Date representation after reading JSON from psql.
 for(const row of rows){row.createdAt=new Date(row.createdAt);assert.ok(Number.isFinite(row.createdAt.getTime()));}
 const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
 let visibleProfiles=0,items=0,contextCases=0,visibleContextCases=0;
 const contextVisibleVariants=new Set();
 for(const group of Map.groupBy(rows,r=>r.vehicleVariantKey).values()){
  const result=profile(group);if(result.items.length)visibleProfiles++;items+=result.items.length;
  assert.ok(result.items.every(i=>!i.automaticSelectionEligible));
  assert.equal(profile(group.map(r=>({...r,run:{...r.run,status:'PLANNED'}}))).items.length,0);
  for(const row of group){
   const a=row.applicabilityJson;
   const context={...a.sourceVehicleScope,engineCode:a.matchedEngineScope?.[0],productionMonth:a.window?.intersection?.from,confirmedMarket:a.requiredMarket,transmissionGearCount:a.transmissionGearCount??a.requiredTransmission?.gearCount,transmissionModel:a.componentModel};
   const transmissionType=a.requiredTransmission?.type??a.transmissionType;
   const contextual=profile(group,transmissionType,context);contextCases++;
   if(contextual.items.length){visibleContextCases++;contextVisibleVariants.add(row.vehicleVariantKey);}
   assert.ok(contextual.items.every(i=>!i.automaticSelectionEligible));
   assert.equal(profile(group.map(r=>({...r,run:{...r.run,status:'PLANNED'}})),transmissionType,context).items.length,0);
  }
 }
 assert.ok(visibleContextCases>0,'Committed local staging with matching test context must reach actual profile builder');
 // Any concurrent edit must prevent rollback, including changes to provenance.
 const id=rows[0].id;pg(`UPDATE mann_technical_association_revisions SET provenance_json=provenance_json||'{"rollbackTamper":true}'::jsonb WHERE id=${q(id)}#>>'{}';`);
 const tampered=state();pg(lifecycle.rollback,false);assert.deepEqual(state(),tampered);
 pg(`UPDATE mann_technical_association_revisions r SET provenance_json=j.row_image->'provenance_json' FROM mann_local_import_journal j WHERE j.table_name='mann_technical_association_revisions' AND r.id=j.row_key;`);
 assert.deepEqual(state(),after);
 pg(lifecycle.rollback);assert.deepEqual(state(),before);
 const report={kind:'LOCAL_CURRENT_STAGING_COMMIT_PROFILE_ROLLBACK',payloadHash:sha(payloadRaw),counts:lifecycle.counts,profileVariants:rearAir?542:expanded?541:529,visibleWithoutVehicleContext:visibleProfiles,itemsWithoutVehicleContext:items,contextCases,visibleContextCases,contextVisibleVariants:contextVisibleVariants.size,duplicateImportRejected:true,changedRowRollbackRejected:true,fullSnapshotRestored:true,productionApplyAllowed:false,limitations:['Local fixture only; completed import runs are not technical signoff.','Contexts are synthetic applicability probes, not decoded real VINs; equipment confirmation cases are not exhaustive.','Scoped items still need exact vehicle/equipment context.','Existing replacement actions not executed; no production or VIN HTTP proof.']};
 if(supersessionProof){report.supersessionProof=supersessionProof;report.limitations[3]='307 explicit replacement actions tested and rolled back locally; remaining review/protected actions unchanged; no production or VIN HTTP proof.';}
 if(combinedProof)report.combinedProfile={uniqueContexts:combinedProof.uniqueContexts,visibleLegacyRevisions:combinedProof.visibleLegacyRevisions,contextsWithDifferences:combinedProof.contextsWithDifferences};
 if(runtimeRead)report.actualDatabaseProfilesChecked=combinedProof.actualDatabaseProfilesChecked;
 if(routeRead)report.actualRouteProfilesChecked=combinedProof.actualRouteProfilesChecked;
 await writeFile(resolve(dir,rearAir?'current-staging-lifecycle-route-read-v9.json':complete?'current-staging-lifecycle-route-read-v8.json':expanded?'current-staging-lifecycle-route-read-v7.json':routeRead?'current-staging-lifecycle-route-read-v1.json':runtimeRead?'current-staging-lifecycle-runtime-read-v1.json':sourceDate?'current-staging-lifecycle-combined-v4.json':transmissionPrecedence?'current-staging-lifecycle-combined-v3.json':precedence?'current-staging-lifecycle-combined-v2.json':combined?'current-staging-lifecycle-combined-v1.json':withSupersession?'current-staging-lifecycle-supersession-v1.json':'current-staging-lifecycle-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
}finally{try{if(runtimeRead&&globalThis.prisma)await globalThis.prisma.$disconnect();}finally{if(started)execFileSync('/opt/homebrew/bin/pg_ctl',['-D',resolve(temp,'data'),'-m','fast','-w','stop'],{stdio:'pipe'});}}
