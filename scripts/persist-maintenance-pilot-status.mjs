/** Immutable scoped pilot outcomes; never creates mappings, passports, or technical recommendations. */
import { readFile, writeFile, mkdir, rename, open, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createJiti } from 'jiti';
import { batchHash, parseBatchInput } from './lib/maintenance-vin-batch.mjs';
import { planPilotAudit, PILOT_STATUS_FACT } from './lib/maintenance-pilot-audit.mjs';
const root=resolve(import.meta.dirname,'..'),args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
 if(args[i]==='--apply')options.apply=true;
 else if(['--input','--output','--organization','--branch'].includes(args[i])&&args[i+1]&&!args[i+1].startsWith('--'))options[args[i].slice(2)]=args[++i];
 else throw new Error('Use --input statuses600.json --output private-audit.json --organization ID --branch ID [--apply]');
}
if(!options.input||!options.output||!options.organization||!options.branch)throw new Error('Input, output, organization and branch are required');
const raw=await readFile(resolve(options.input),'utf8'),sourceHash=batchHash(raw),payload=parseBatchInput(raw);
const planned=planPilotAudit(payload,{organizationId:options.organization,branchId:options.branch,sourceHash});
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required; no provider/API key needed');
const output=resolve(options.output);await mkdir(dirname(output),{recursive:true});
const lock=await open(output+'.lock','wx',0o600),savedFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Provider/network calls forbidden in pilot status audit');};
let prisma;
const report={kind:PILOT_STATUS_FACT,mode:options.apply?'apply':'dry-run',organizationId:options.organization,branchId:options.branch,sourceHash,sourceUrl:'urn:sha256:'+sourceHash,startedAt:new Date().toISOString(),recordCount:planned.length,statusCounts:Object.fromEntries([...new Set(planned.map(r=>r.facts.status))].map(status=>[status,planned.filter(r=>r.facts.status===status).length])),physicalVinVerified:planned.filter(r=>r.facts.physicalVinVerified).length};
const save=async()=>{report.updatedAt=new Date().toISOString();await writeFile(output+'.tmp',JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(output+'.tmp',output);};
try{
 await open(output,'wx',0o600).then(h=>h.close());await save();
 const boot=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});({prisma}=await boot.import('../src/lib/db.ts'));
 const {runWithRequestTenant}=await boot.import('../src/lib/request-tenant-store.ts');
 await runWithRequestTenant({mode:'branch',branchId:options.branch,organizationId:options.organization,allowedBranchIds:[options.branch]},()=>prisma.$transaction(async tx=>{
  if(!options.apply){await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');const readOnly=await tx.$queryRawUnsafe('SHOW transaction_read_only');if(readOnly[0]?.transaction_read_only!=='on')throw new Error('Read-only transaction not established');report.databaseReadOnly=true;}
  const branch=await tx.branch.findFirst({where:{id:options.branch,status:'active'},select:{id:true,legacyOrganizationId:true}});
  if(!branch||(branch.legacyOrganizationId??branch.id)!==options.organization)throw new Error('Branch/organization mismatch');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${options.organization}), hashtext(${PILOT_STATUS_FACT+sourceHash}))`;
  const ids=planned.map(r=>r.id);
  const before=await tx.aIAgentTechnicalEvidence.findMany({where:{id:{in:ids},organizationId:options.organization,factType:PILOT_STATUS_FACT},select:{id:true,status:true,confidence:true}});
  report.before={capturedAt:new Date().toISOString(),records:before};report.plannedIds=ids;await save();
  if(options.apply)await tx.aIAgentTechnicalEvidence.createMany({data:planned,skipDuplicates:true});
  const after=await tx.aIAgentTechnicalEvidence.findMany({where:{id:{in:ids},organizationId:options.organization,factType:PILOT_STATUS_FACT},select:{id:true,status:true,confidence:true}});
  if(options.apply&&(after.length!==600||after.some(r=>r.status!=='audit_only'||r.confidence!==0)))throw new Error('Pilot audit verification failed');
  report.after={capturedAt:new Date().toISOString(),records:after};report.insertedIds=after.filter(r=>!before.some(b=>b.id===r.id)).map(r=>r.id);report.result=options.apply?'PERSISTED_AUDIT_ONLY':'DRY_RUN';
 },{maxWait:15000,timeout:600000}));
 report.committed=Boolean(options.apply);await save();console.log(JSON.stringify({result:report.result,records:planned.length,newRecords:report.insertedIds.length,statusCounts:report.statusCounts,physicalVinVerified:report.physicalVinVerified}));
}catch(error){report.result='FAILED';report.errorType=error?.name??'Error';report.errorCode=error?.code??null;report.committed=false;await save();throw new Error('Pilot audit failed; see private audit error type/code');}
finally{globalThis.fetch=savedFetch;if(prisma)await prisma.$disconnect();await lock.close();await unlink(output+'.lock');}
