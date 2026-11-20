import { createMaintenanceVinProfileLoader } from './lib/maintenance-vin-profile.mjs';
/** Resumable maintenance enrichment. No deployment, migration, or manual match confirmation. */
import { readFile, writeFile, mkdir, rename, open, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createJiti } from 'jiti';
import { batchHash, batchInputRows, batchSummary, isBatchNormalizedVehicle, parseBatchInput } from './lib/maintenance-vin-batch.mjs';

const root=resolve(import.meta.dirname,'..');
const args = process.argv.slice(2), flags = new Set(['--execute','--match-only','--research','--decode-missing','--resume','--retry-incomplete','--partsapi-only']);
const options = {};
for (let i=0;i<args.length;i++) {
  const key=args[i];
  if(flags.has(key)) options[key.slice(2)]=true;
  else if(['--input','--output','--branch','--organization','--limit'].includes(key) && args[i+1] && !args[i+1].startsWith('--')) options[key.slice(2)]=args[++i];
  else throw new Error(`Unknown option or missing argument: ${key}`);
}
if(!options.input || !options.output) throw new Error('Required: --input private.json --output private-checkpoint.json [--execute --branch ID --organization ID] [--research] [--decode-missing] [--resume]');
const inputRaw=await readFile(resolve(options.input),'utf8'), parsed=batchInputRows(parseBatchInput(inputRaw));
const limit=options.limit === undefined ? parsed.rows.length : Number(options.limit);
if(!Number.isSafeInteger(limit)||limit<1) throw new Error('--limit must be a positive integer');
const rows=parsed.rows.slice(0,limit), inputHash=batchHash(inputRaw), output=resolve(options.output);
if(options.execute && options['match-only']) throw new Error('--match-only and --execute are mutually exclusive');
const active=options.execute || options['match-only'];
const mode=options['match-only']?'match-only':options.execute?'execute':'inventory';
if(options.research && !options.execute) throw new Error('--research requires --execute');
if(options['decode-missing'] && !options.execute) throw new Error('--decode-missing requires --execute');
if(options['partsapi-only'] && options['decode-missing']) throw new Error('PartsAPI-only batch requires preloaded responses; implicit network decoding is forbidden');
if(active && (!options.branch || !options.organization || !process.env.DATABASE_URL)) throw new Error('Execution requires --branch, --organization and DATABASE_URL in environment');
if(options.research && !process.env.OPENAI_API_KEY) throw new Error('Research requires server-side OPENAI_API_KEY in environment');
await mkdir(dirname(output),{recursive:true});
const lock=await open(`${output}.lock`,'wx',0o600).catch(()=>{throw new Error('Checkpoint is locked; another run may still be active');});
let report;
const config={mode,inputHash,branch:options.branch??null,organization:options.organization??null,research:Boolean(options.research),decodeMissing:Boolean(options['decode-missing']),...(options['partsapi-only']?{partsApiOnly:true}:{})};
const save=async()=>{report.updatedAt=new Date().toISOString();report.summary=batchSummary(report.results);await writeFile(`${output}.tmp`,JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(`${output}.tmp`,output);};
let prisma, stopRequested=false;
const requestStop=()=>{stopRequested=true;};
process.on('SIGINT',requestStop);process.on('SIGTERM',requestStop);
try {
  if(options.resume) {
    report=JSON.parse(await readFile(output,'utf8'));
    if(JSON.stringify(report.config)!==JSON.stringify(config)) throw new Error('Resume configuration/input differs from checkpoint');
  } else {
    await open(output,'wx',0o600).then(handle=>handle.close());
    report={kind:'MAINTENANCE_VIN_ENRICHMENT_V1',config,startedAt:new Date().toISOString(),inputCount:parsed.rows.length,selectedCount:rows.length,rejected:parsed.rejected,results:[]};
  }
  await save();
  if(!active) {report.results=rows.map(({vin})=>({vin,status:'INVENTORIED'}));await save();console.log(JSON.stringify(report.summary));}
  else {
    const boot=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
    ({prisma}=await boot.import('../src/lib/db.ts'));
    const processRows=async db=>{
    globalThis[Symbol.for('maintenance-vin-batch-db')]=db;
    const j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':resolve(root,'scripts/lib/maintenance-vin-batch-db.mjs')}});
    const {runWithRequestTenant}=await j.import('../src/lib/request-tenant-store.ts');
    const {lookupVehicle}=await j.import('../src/lib/vehicle-identity.ts');
    const {resolveMannVehicle}=await j.import('../src/lib/mann-vehicle-resolver.ts');
    const {mannTechnicalContextFromVehicle}=await j.import('../src/lib/mann-technical-request-context.ts');
    const {loadSavedVehicleTechnicalConfirmation}=await j.import('../src/lib/mann-saved-vehicle-confirmation.ts');
    const {getMannUnifiedTechnicalProfile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
    const {withMannEngineOilReference}=await j.import('../src/lib/mann-engine-oil-reference.ts');
    const {addMannResearchCatalogToProfile,mannResearchIdentity,mannResearchEngineCode}=await j.import('../src/lib/mann-research-catalog.ts');
    const {loadSelectedMannApplications}=await j.import('../src/lib/mann-selected-applications.ts');
    const {missingMannFluids,researchMissingMannFluids}=await j.import('../src/lib/mann-fluid-research.ts');
    const {MANN_FLUID_GROUP_IDS,MANN_FLUID_GROUPS}=await j.import('../src/lib/mann-fluid-systems.ts');
    const tenant={mode:'branch',branchId:options.branch,organizationId:options.organization,allowedBranchIds:[options.branch]};
    await runWithRequestTenant(tenant,async()=>{
      // Validate scoped ownership before any provider request or research write.
      const branch=await db.branch.findFirst({where:{id:options.branch,status:'active'},select:{id:true,legacyOrganizationId:true}});
      if(!branch || (branch.legacyOrganizationId??branch.id)!==options.organization) throw new Error('Branch does not belong to requested organization');
      if(options.execute && !report.beforeSnapshot){
        const [evidence,requirements,links,sources]=await Promise.all([
          db.aIAgentTechnicalEvidence.findMany({where:{organizationId:options.organization,factType:'VIN_FLUID_RESEARCH_V1'}}),
          db.vehicleFluidRequirement.findMany({where:{rawRequirementJson:{path:['organizationId'],equals:options.organization},id:{startsWith:'ai-fluid:'}},select:{id:true}}),
          db.mannFluidRequirementLink.findMany({where:{evidenceJson:{path:['organizationId'],equals:options.organization},id:{startsWith:'ai-fluid:'}},select:{id:true}}),
          db.fluidSourceRow.findMany({where:{parsedRowJson:{path:['organizationId'],equals:options.organization},id:{startsWith:'ai-fluid:'}},select:{id:true}}),
        ]);
        report.beforeSnapshot={capturedAt:new Date().toISOString(),evidence,requirementIds:requirements.map(r=>r.id),linkIds:links.map(r=>r.id),sourceIds:sources.map(r=>r.id)};await save();
      }
      const researchSeen=new Map();
      for(const old of report.results)for(const group of old.research??[])if(group.dedupKey)researchSeen.set(group.dedupKey,group);
      const load=createMaintenanceVinProfileLoader(options,{getMannUnifiedTechnicalProfile,withMannEngineOilReference,addMannResearchCatalogToProfile});
      for(const row of rows){
        if(stopRequested){report.stopReason='INTERRUPTED';await save();break;}
        const previous=report.results.find(r=>r.vin===row.vin);
        if(previous && (!options['retry-incomplete'] || ['MATCHED','ENRICHED','NEEDS_SELECTION','NO_MATCH','NO_DECODE'].includes(previous.status))) continue;
        const startedAt=new Date().toISOString();let result={vin:row.vin,startedAt};
        try {
          if(options['match-only'])await db.$executeRawUnsafe('SAVEPOINT maintenance_vin');
          let vehicle=row.vehicle;
          if(!vehicle && !options['partsapi-only']){
            const cached=await db.vehicleLookupCache.findFirst({where:{organizationId:options.organization,inputType:'vin',status:'success',normalizedInputHash:batchHash(row.vin)},orderBy:{createdAt:'desc'},select:{normalizedVehicleJson:true}});
            vehicle=cached?.normalizedVehicleJson;
          }
          if(!vehicle && options['decode-missing']) {
            const lookup=await lookupVehicle({organizationId:options.organization,inputType:'vin',input:row.vin});
            if(lookup.status==='found' && lookup.candidates?.length===1 && lookup.vehicle) vehicle=lookup.vehicle;
            else {result={...result,status:lookup.candidates?.length?'NEEDS_SELECTION':'NO_DECODE',lookupStatus:lookup.status};}
          }
          if(!vehicle){result={...result,status:result.status??'NO_DECODE'};}
          else if(!isBatchNormalizedVehicle(vehicle)){result={...result,status:'INVALID_NORMALIZED_VEHICLE'};}
          else if(vehicle.vin?.toUpperCase()!==row.vin){result={...result,status:'VIN_MISMATCH'};}
          else {
            const resolution=await resolveMannVehicle({organizationId:options.organization,vehicle});
            result={...result,vehicle,resolutionStatus:resolution.status,candidates:resolution.candidates};
            if(resolution.status!=='resolved'||!resolution.selectedApplication) result.status=resolution.candidates.length?'NEEDS_SELECTION':'NO_MATCH';
            else {
              const candidate=resolution.selectedApplication,variantKeys=candidate.variantIds;
              const initialContext=mannTechnicalContextFromVehicle(vehicle,{},candidate);
              const savedConfirmation=await loadSavedVehicleTechnicalConfirmation({branchId:options.branch,vin:row.vin,vehicleContext:{...initialContext,transmissionType:vehicle.transmissionType,transmissionName:vehicle.transmissionName,driveType:vehicle.driveType}});
              const transmissionType=savedConfirmation.transmissionType;
              const vehicleContext={...initialContext,...(savedConfirmation.confirmedDrive?{confirmedDrive:savedConfirmation.confirmedDrive}:{}),...(transmissionType?{confirmedTransmissionType:transmissionType}:{})};
              let profile=await load(variantKeys,vehicleContext,transmissionType);
              result={...result,status:'MATCHED',variantKeys,vehicleContext,savedConfirmation,filters:resolution.filters,profileBefore:profile,gapsBefore:missingMannFluids(profile,transmissionType),research:[]};
              const applications=options.research?await loadSelectedMannApplications(variantKeys):[];
              const researchIdentity=options.research?mannResearchIdentity(applications,transmissionType,mannResearchEngineCode(applications,vehicleContext.engineCode),vehicleContext):undefined;
              if(options.research) for(const group of MANN_FLUID_GROUP_IDS){
                if(!missingMannFluids(profile).some(g=>MANN_FLUID_GROUPS[group].systems.includes(g.systemCode))) continue;
                const dedupKey=batchHash(JSON.stringify({researchIdentity,group}));
                if(researchSeen.has(dedupKey)){result.research.push({group,dedupKey,status:'deduplicated',items:[],reusedStatus:researchSeen.get(dedupKey).status});continue;}
                const research=await researchMissingMannFluids({organizationId:options.organization,variantKeys,transmissionType,vehicleContext,profile,group,batch:{skipHourlyLimit:true,reuseAnyGroupResult:true}});
                result.research.push({group,dedupKey,...research});
                researchSeen.set(dedupKey,research);
                profile=await load(variantKeys,vehicleContext,transmissionType);
                if(research.status==='unavailable'||research.status==='searching') {result.status='INCOMPLETE';if(!research.fromCache&&['quota','access','storage','network','rate_limit'].includes(research.errorCode))break;}
              }
              result.profile=profile;result.gapsAfter=missingMannFluids(profile);
              if(options.research) result.status=result.gapsAfter.length||result.status==='INCOMPLETE'?'PARTIAL':'ENRICHED';
            }
          }
          if(options['match-only'])await db.$executeRawUnsafe('RELEASE SAVEPOINT maintenance_vin');
        }catch(error){
          if(options['match-only']){await db.$executeRawUnsafe('ROLLBACK TO SAVEPOINT maintenance_vin');await db.$executeRawUnsafe('RELEASE SAVEPOINT maintenance_vin');}
          result={...result,status:'ERROR',errorType:error?.name??'Error',errorCode:error?.code??null};
        }
        result.finishedAt=new Date().toISOString();
        report.results=report.results.filter(r=>r.vin!==row.vin);report.results.push(result);await save();
        console.log(JSON.stringify({processed:report.results.length,total:rows.length,status:result.status}));
        if(result.research?.some(r=>!r.fromCache && ['quota','access','storage','network','rate_limit'].includes(r.errorCode))) {report.stopReason='PROVIDER_OR_STORAGE_UNAVAILABLE';await save();break;}
      }
      if(options.execute){
        const [evidence,requirements,links,sources]=await Promise.all([
          db.aIAgentTechnicalEvidence.findMany({where:{organizationId:options.organization,factType:'VIN_FLUID_RESEARCH_V1'},select:{id:true,status:true}}),
          db.vehicleFluidRequirement.findMany({where:{rawRequirementJson:{path:['organizationId'],equals:options.organization},id:{startsWith:'ai-fluid:'}},select:{id:true}}),
          db.mannFluidRequirementLink.findMany({where:{evidenceJson:{path:['organizationId'],equals:options.organization},id:{startsWith:'ai-fluid:'}},select:{id:true}}),
          db.fluidSourceRow.findMany({where:{parsedRowJson:{path:['organizationId'],equals:options.organization},id:{startsWith:'ai-fluid:'}},select:{id:true}}),
        ]);
        report.afterSnapshot={capturedAt:new Date().toISOString(),evidence,requirementIds:requirements.map(r=>r.id),linkIds:links.map(r=>r.id),sourceIds:sources.map(r=>r.id)};
        await save();
      }
    });
    };
    if(options['match-only']){
      const savedFetch=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Network forbidden in match-only mode');};
      try{await prisma.$transaction(async tx=>{
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        const readOnly=await tx.$queryRawUnsafe('SHOW transaction_read_only');
        if(readOnly[0]?.transaction_read_only!=='on')throw new Error('Read-only transaction was not established');
        report.databaseReadOnly=true;await save();await processRows(tx);
      },{maxWait:15000,timeout:3600000});}finally{globalThis.fetch=savedFetch;}
    }else await processRows(prisma);
    delete globalThis[Symbol.for('maintenance-vin-batch-db')];
  }
}finally{process.off('SIGINT',requestStop);process.off('SIGTERM',requestStop);if(prisma)await prisma.$disconnect();await lock.close();await unlink(`${output}.lock`);}
