import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {validateIdentityAudit,identityState,readinessRow,vinHash} from './lib/maintenance-vin-readiness.mjs';
const source=Array.from({length:600},(_,i)=>({vin:'WBA'+String(i+1).padStart(14,'0'),provenance:i<120?{exactVinVerified:true}:i<132?{physicalVinVerified:true,verificationBasis:'explicit_user_confirmed_passport'}:{}}));
const reports=source.map((s,i)=>({vin:s.vin,status:i<25?'MATCHED':i<117?'NEEDS_SELECTION':'NO_MATCH',variantKeys:i<25?['candidate-'+i]:[],candidates:[{variantIds:['alternative-'+i]}]}));
const ambiguous=[0,1,2,3,25,26,27,28,29,30,31,32,117];
const audit={databaseReadOnly:true,scope:{originalVinCount:600,branch:'branch-main'},providerCalls:0,writes:0,rows:[...ambiguous.map(i=>({vinHash:vinHash(source[i].vin),exactVinVerified:true,rawDecryptSucceeded:true,returnedVinCount:1,distinctTechnicalCandidates:2,needsIdentitySelection:true})),{vinHash:vinHash(source[4].vin),exactVinVerified:true,rawDecryptSucceeded:true,returnedVinCount:1,distinctTechnicalCandidates:1,needsIdentitySelection:false}]};
const validated=validateIdentityAudit(audit,source),rows=reports.map((r,i)=>readinessRow(r,source[i],validated));
const count=status=>rows.filter(r=>r.status===status).length;
assert.deepEqual({ready:count('ready'),partial:count('partial'),needs_selection:count('needs_selection'),blocked:count('blocked')},{ready:0,partial:21,needs_selection:97,blocked:482});
assert.equal(rows.filter(r=>r.physicalVinVerified).length,119);
assert.equal(rows.filter(r=>r.actualReturnedVinVerified).length,120);
assert.equal(rows.filter(r=>r.identityAmbiguous).length,13);
assert.equal(rows.filter(r=>!r.physicalVinVerified&&!r.identityAmbiguous).length,468);
for(const i of ambiguous){assert.equal(rows[i].status,'needs_selection');assert.equal(rows[i].physicalVinVerified,false);assert.equal(rows[i].actualReturnedVinVerified,true);assert.equal(rows[i].identityResolved,false);assert.equal(rows[i].reasonCode,'ambiguous_provider_identity');assert.deepEqual(rows[i].variantKeys,[]);assert.equal(rows[i].gapsDiscoveryStatus,'not_evaluated_ambiguous_provider_identity');}
assert.equal(rows[4].status,'partial','unique factory-type result retains identity');
assert.equal(identityState(source[0]).physicalVinVerified,true,'optional audit does not alter legacy invocation');
for(const mutate of [a=>a.providerCalls=1,a=>a.writes=1,a=>a.databaseReadOnly=false,a=>a.scope.branch='other',a=>a.scope.originalVinCount=1867,a=>a.rows[0].vinHash=vinHash('not-original'),a=>a.rows.push(a.rows[0]),a=>a.rows[0].needsIdentitySelection=false,a=>a.rows[0].exactVinVerified=false,a=>a.rows[0].rawDecryptSucceeded=false,a=>a.rows[0].returnedVinCount=2]){const bad=structuredClone(audit);mutate(bad);assert.throws(()=>validateIdentityAudit(bad,source));}
console.log('PASS 600 readiness distinguishes returned VIN from resolved identity: 119 specific,13 identity selection,468 unverified; unsafe/foreign audit rejected');

// Exercise real CLI publication in a synthetic temporary cohort only.
const dir=await mkdtemp(resolve(tmpdir(),'maintenance-readiness-test-'));
try{
 const write=(name,data)=>writeFile(resolve(dir,name),JSON.stringify(data));
 await write('input-600.json',source);await write('normalized-600-with-confirmed-passports.json',source);
 const report={databaseReadOnly:true,config:{mode:'match-only',branch:'branch-main',organization:'cmpmo4c1r00088z0h38fn6k98'},results:reports.map((r,i)=>({...r,vehicleContext:{make:'TEST',vin:source[i].vin}})),summary:{matched:25},startedAt:'2026-11-20T00:00:00Z',updatedAt:'2026-11-20T00:00:01Z'};
 await write('source.json',report);await write('audit.json',audit);
 const names=['matched-600-final.json','standardized-status-600.json','matching-summary-final.json','final-manual-research-queue.json'];
 for(const name of names)await write(name,{oldSnapshot:true});
 const run=(label,auditFile='audit.json')=>spawnSync(process.execPath,['scripts/finalize-maintenance-vin-report.mjs','--directory',dir,'--report',resolve(dir,'source.json'),'--label',label,'--identity-audit',resolve(dir,auditFile)],{encoding:'utf8'});
 const result=run('synthetic-identity');assert.equal(result.status,0,result.stderr);
 const standardized=JSON.parse(await readFile(resolve(dir,'standardized-status-600.json'),'utf8'));
 assert.equal(standardized.summary.physicalVinVerified,119);assert.equal(standardized.summary.ambiguousProviderIdentities,13);
 const final=JSON.parse(await readFile(resolve(dir,'matched-600-final.json'),'utf8'));assert.deepEqual(final.results[0].variantKeys,[]);assert.equal(final.results[0].actualReturnedVinVerified,true);
 const queueRaw=await readFile(resolve(dir,'final-manual-research-queue.json'),'utf8'),queue=JSON.parse(queueRaw);
 assert.equal(queue.rawCatalogMatched,25);assert.equal(queue.matched,21);assert.equal(queue.excludedAmbiguousProviderMatches,4);assert.equal(queue.groups.reduce((n,g)=>n+g.verifiedIdentityOccurrences,0),21);assert.equal(source.some(s=>queueRaw.includes(s.vin)),false,'queue redacts nested VINs');
 for(const name of names)assert.deepEqual(JSON.parse(await readFile(resolve(dir,name.replace('.json','.before-synthetic-identity.json')),'utf8')),{oldSnapshot:true});
 const before=await Promise.all(names.map(name=>readFile(resolve(dir,name),'utf8')));
 assert.notEqual(run('synthetic-identity').status,0,'duplicate backup label must not overwrite snapshots');
 const unsafe=structuredClone(audit);unsafe.providerCalls=1;await write('unsafe.json',unsafe);
 assert.notEqual(run('invalid-evidence','unsafe.json').status,0);
 assert.deepEqual(await Promise.all(names.map(name=>readFile(resolve(dir,name),'utf8'))),before,'invalid audit must fail before changing artifacts');
 assert.equal((await readdir(dir)).some(name=>name.includes('before-invalid-evidence')),false);
 console.log('PASS synthetic-only finalizer CLI preserves unique snapshots, excludes ambiguous queue entries, redacts VINs and rejects unsafe audit before writes');
}finally{await rm(dir,{recursive:true,force:true});}
