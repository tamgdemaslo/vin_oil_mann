/** Recover previously unrequested identities only. No MANN/profile/research imports or writes. */
import {readFile,writeFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash,createDecipheriv} from 'node:crypto';
import {createJiti} from 'jiti';
import {createMaintenanceProviderRequestGuard} from './lib/maintenance-provider-request-guard.mjs';
import {createMaintenanceIdentityCacheScope} from './lib/maintenance-identity-cache-scope.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),o={};
for(let i=0;i<args.length;i++){
 if(['--execute','--resume'].includes(args[i]))o[args[i].slice(2)]=true;
 else if(['--cohort','--input','--output','--branch','--organization','--max-requests'].includes(args[i])&&args[i+1])o[args[i].slice(2)]=args[++i];
 else throw Error('Unknown argument');
}
if(!o.cohort||!o.input||!o.output||!o.branch||!o.organization)throw Error('Required cohort/input/output/branch/organization');
const hash=v=>createHash('sha256').update(v).digest('hex');
const cohort=JSON.parse(await readFile(resolve(o.cohort),'utf8')),inputRaw=await readFile(resolve(o.input),'utf8'),input=JSON.parse(inputRaw);
const vinValid=v=>typeof v==='string'&&/^[A-HJ-NPR-Z0-9]{17}$/.test(v);
if(!Array.isArray(cohort)||cohort.length!==600||new Set(cohort.map(r=>r.vin)).size!==600||!cohort.every(r=>vinValid(r.vin)))throw Error('Exact unique original600 cohort required');
const allowed=new Set(cohort.map(r=>r.vin));
if(!Array.isArray(input)||!input.length||new Set(input.map(r=>r.vin)).size!==input.length||!input.every(r=>allowed.has(r.vin)))throw Error('Only unique VINs from original600 allowed');
const budget=Number(o['max-requests']??2);if(!Number.isSafeInteger(budget)||budget<0||budget>100)throw Error('Use a bounded request budget 0..100; no provider limit bypass');
const output=resolve(o.output),ledgerPath=output+'.requests.jsonl';await mkdir(dirname(output),{recursive:true});
const config={cohortHash:hash(JSON.stringify(cohort)),inputHash:hash(inputRaw),branch:o.branch,organization:o.organization,maxRequests:budget};
const lock=await open(output+'.lock','wx',0o600);let db;const nativeFetch=globalThis.fetch;let report;
const save=async()=>{report.updatedAt=new Date().toISOString();await writeFile(output+'.tmp',JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(output+'.tmp',output);};
try{
 report=o.resume?JSON.parse(await readFile(output,'utf8')):{kind:'ORIGINAL600_VIN_IDENTITY_RECOVERY_V1',config,startedAt:new Date().toISOString(),results:[],openaiCalls:0};
 if(JSON.stringify(report.config)!==JSON.stringify(config))throw Error('Resume configuration differs');
 if(!o.resume)await open(output,'wx',0o600).then(f=>f.close());await save();
 if(!o.execute){report.status='PLANNED';report.selectedCount=input.length;await save();console.log(JSON.stringify({status:'PLANNED',selected:input.length,maxRequests:budget,providerCalls:0,writes:0}));}
 else{
  if(!process.env.DATABASE_URL||!process.env.TRONK_API_KEY?.trim()||!(process.env.TRONK_CACHE_ENCRYPTION_KEY?.trim()||process.env.SESSION_SECRET?.trim())||process.env.OPENAI_API_KEY?.trim()||process.env.PARTSAPI_VINDECODE_KEY?.trim())throw Error('Require DB/TRONK credentials in memory and disabled OpenAI/other VIN providers');
  const boot=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});({prisma:db}=await boot.import('../src/lib/db.ts'));
  const j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':resolve(root,'scripts/lib/maintenance-vin-batch-db.mjs')}});
  const {runWithRequestTenant}=await j.import('../src/lib/request-tenant-store.ts');
  const {lookupVehicle,toVehicle,assessTronkReturnedVin}=await j.import('../src/lib/vehicle-identity.ts');
  let events=[];try{events=(await readFile(ledgerPath,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(e){if(e.code!=='ENOENT')throw e;}
  const appendEvent=async event=>{const f=await open(ledgerPath,'a',0o600);try{await f.writeFile(JSON.stringify(event)+'\n');await f.sync();}finally{await f.close();}events.push(event);};
  globalThis.fetch=createMaintenanceProviderRequestGuard({allowedVins:input.map(r=>r.vin),fetchImpl:nativeFetch,maxRequests:budget,previousEvents:events,appendEvent});
  const key=createHash('sha256').update(process.env.TRONK_CACHE_ENCRYPTION_KEY?.trim()||process.env.SESSION_SECRET||'tronk-cache-change-me').digest();
  const decrypt=value=>{if(!value)return null;try{const [iv,tag,data]=value.split('.'),dec=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));dec.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([dec.update(Buffer.from(data,'base64url')),dec.final()]).toString('utf8'));}catch{return null;}};
  await runWithRequestTenant({mode:'branch',branchId:o.branch,organizationId:o.organization,allowedBranchIds:[o.branch]},async()=>{
   const owner=await db.branch.findFirst({where:{id:o.branch,status:'active',legacyOrganizationId:o.organization},select:{id:true}});if(!owner)throw Error('Branch/organization mismatch');
   for(const row of input){
    if(report.results.some(r=>r.vin===row.vin))continue;
    const vinHash=hash(row.vin);
    if(events.some(e=>e.vinHash===vinHash)){report.results.push({vin:row.vin,status:'PREVIOUS_ATTEMPT_HELD',reason:'Durable provider ledger already contains this VIN; no automatic retry'});await save();continue;}
    if(events.filter(e=>e.state==='started').length+2>budget){report.stopReason='BOUNDED_REQUEST_BUDGET';await save();break;}
    // Dedicated connection holds the per-VIN lock; cache writes autocommit on the
    // regular pool, so a later failed method cannot roll back an acquired raw reply.
    const result=await db.$transaction(async lockTx=>{
     await lockTx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${o.organization}),hashtext(${vinHash}))`;
     const scope={branchId:o.branch,organizationId:o.organization,inputType:'vin',normalizedInputHash:vinHash};
     const prior=await lockTx.$queryRaw`SELECT EXISTS (SELECT 1 FROM vehicle_lookup_cache WHERE organization_id=${o.organization} AND input_type='vin' AND normalized_input_hash=${vinHash}) AS present`;
     if(prior[0]?.present)return {vin:row.vin,status:'PREVIOUS_ATTEMPT_HELD',reason:'An organization-scoped provider attempt exists; no cross-branch raw data read'};
     const scopedCache=createMaintenanceIdentityCacheScope(db.vehicleLookupCache,scope);
     globalThis[Symbol.for('maintenance-vin-batch-db')]=scopedCache.db;
     const lookup=await lookupVehicle({organizationId:o.organization,inputType:'vin',input:row.vin,extended:true});
     await scopedCache.drain();
     const stored=await db.vehicleLookupCache.findMany({where:scope,orderBy:{completedAt:'asc'},select:{id:true,method:true,status:true,rawResponseEncrypted:true,errorCode:true}});
     const receipts=stored.map(c=>{const raw=decrypt(c.rawResponseEncrypted);const proof=raw?assessTronkReturnedVin(raw,row.vin,c.method):{status:'absent',returnedVins:[]};return {id:c.id,method:c.method,status:c.status,errorCode:c.errorCode,returnedVinStatus:proof.status,returnedVinHashes:proof.returnedVins.map(hash),requestVinCorrelationStatus:proof.correlationStatus??'absent',requestVinCorrelationHashes:(proof.correlationVins??[]).map(hash),raw};});
     // Prefer independently VIN-bound extended identity, not a merge with a
     // primary catalogue record whose actual VIN was never supplied.
     const exactExtended=receipts.find(c=>c.method==='vindecode2'&&c.status==='success'&&c.returnedVinStatus==='exact');
     const primary=receipts.find(c=>c.method==='vindecode'&&c.status==='success'&&c.returnedVinStatus==='exact');
     let vehicle,sourceCacheId;
     if(exactExtended){const candidate=toVehicle(exactExtended.raw.result,'tronk_vindecode2',{vin:row.vin});if(candidate.makeCanonical&&candidate.modelCanonical){vehicle=candidate;sourceCacheId=exactExtended.id;}}
     if(!vehicle&&primary&&lookup.candidates.length===1&&lookup.vehicle?.sourceMethods.every(m=>m==='tronk_vindecode')){vehicle=lookup.vehicle;sourceCacheId=primary.id;}
     const cleared=await db.vehicleLookupCache.updateMany({where:scope,data:{normalizedVehicleJson:(await import('@prisma/client')).Prisma.JsonNull}});if(cleared.count!==stored.length)throw Error('Incomplete derived-identity cleanup');
     if(vehicle){const saved=await db.vehicleLookupCache.updateMany({where:{...scope,id:sourceCacheId},data:{normalizedVehicleJson:vehicle}});if(saved.count!==1)throw Error('Verified derived identity not saved');}
     return {vin:row.vin,status:vehicle?'VERIFIED_IDENTITY':lookup.candidates.length>1?'NEEDS_IDENTITY_SELECTION':lookup.status==='found'?'UNVERIFIED_PROVIDER_RESPONSE':'NO_DECODE',vehicle,sourceCacheId,candidateCount:lookup.candidates.length,candidates:vehicle?[]:lookup.candidates,diagnostics:lookup.diagnostics,cacheReceipts:receipts.map(({raw,...rest})=>rest)};
    },{maxWait:15000,timeout:90000});
    report.results.push(result);report.providerRequests=events.filter(e=>e.state==='started').length;await save();console.log(JSON.stringify({processed:report.results.length,total:input.length,status:result.status,providerRequests:report.providerRequests}));
    if(!['VERIFIED_IDENTITY','NEEDS_IDENTITY_SELECTION','PREVIOUS_ATTEMPT_HELD'].includes(result.status)){report.stopReason='PROVIDER_OR_PROOF_UNAVAILABLE';await save();break;}
   }
  });
  report.status=report.results.length===input.length?'COMPLETED':'STOPPED';await save();
 }
}finally{globalThis.fetch=nativeFetch;delete globalThis[Symbol.for('maintenance-vin-batch-db')];if(db)await db.$disconnect();await lock.close();await unlink(output+'.lock');}
