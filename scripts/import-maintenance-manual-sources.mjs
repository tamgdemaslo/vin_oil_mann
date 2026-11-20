import { findManualSourceReplay } from './lib/maintenance-manual-source-replay.mjs';
/** Import independently gathered source excerpts. No OpenAI client calls, no deployment. */
import { readFile, writeFile, mkdir, rename, open, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createJiti } from 'jiti';
import { z } from 'zod';
import { batchHash, parseBatchInput } from './lib/maintenance-vin-batch.mjs';
const root=resolve(import.meta.dirname,'..'), args=process.argv.slice(2),options={};
for(let i=0;i<args.length;i++){
 if(args[i]==='--apply')options.apply=true;
 else if(['--input','--output'].includes(args[i])&&args[i+1])options[args[i].slice(2)]=args[++i];
 else throw new Error('Use --input reviewed-sources.json --output private-audit.json [--apply]');
}
if(!options.input||!options.output)throw new Error('--input and --output required');
const item=z.object({systemCode:z.string().min(1),specification:z.string().max(2000),volumeText:z.string().max(1000),sourceUrl:z.string().url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&u.hostname.includes('.')&&!/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname)&&!u.hostname.endsWith('.local');}),sourceTitle:z.string().min(1).max(300),excerpt:z.string().min(1).max(2000)}).strict();
const vehicleContext=z.object({year:z.number().int().min(1886).max(2100).optional(),productionMonth:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),engineCode:z.string().optional(),confirmedMarket:z.enum(['RU','JP','US','KR','AE','EU','SOUTHEAST_ASIA']).optional(),confirmedDrive:z.enum(['2WD','4WD']).optional(),confirmedTransmissionType:z.enum(['automatic','manual','cvt','robot']).optional(),transmissionModel:z.string().optional(),transmissionGearCount:z.number().int().min(3).max(18).optional(),rearAirConditioning:z.boolean().optional(),confirmedEquipment:z.array(z.object({circuit:z.enum(['HYDRAULIC_STEERING','TRANSFER_CASE','FRONT_DIFFERENTIAL','REAR_DIFFERENTIAL','ANGLE_GEAR','AWD_COUPLING']),drive:z.enum(['2WD','4WD']).optional(),componentModel:z.string().optional(),attachedTransmissionType:z.enum(['automatic','manual','cvt','robot']).optional()}).strict()).optional()}).strict();
const record=z.object({organizationId:z.string().min(1),branchId:z.string().min(1),variantKeys:z.array(z.string().min(1)).min(1).max(20),engineCode:z.string().optional(),transmissionType:z.enum(['automatic','manual','cvt','robot']).optional(),vehicleContext:vehicleContext.optional(),items:z.array(item).min(1).max(40)}).strict();
const inputRaw=await readFile(resolve(options.input),'utf8'),payload=parseBatchInput(inputRaw);
const records=z.array(record).min(1).parse(Array.isArray(payload)?payload:[payload]);
if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required; no provider API key is needed');
const output=resolve(options.output);await mkdir(dirname(output),{recursive:true});
const lock=await open(output+'.lock','wx',0o600);const savedFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Network/provider calls forbidden during manual-source import');};
let prisma;
const report={kind:'MANUAL_MAINTENANCE_SOURCE_IMPORT_V1',inputHash:batchHash(inputRaw),mode:options.apply?'apply':'dry-run',startedAt:new Date().toISOString(),results:[]};
const save=async()=>{report.updatedAt=new Date().toISOString();await writeFile(output+'.tmp',JSON.stringify(report,null,2)+'\n',{mode:0o600});await rename(output+'.tmp',output);};
try{
 await open(output,'wx',0o600).then(h=>h.close());await save();
 const boot=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});({prisma}=await boot.import('../src/lib/db.ts'));
 for(const input of records){
  const result={organizationId:input.organizationId,branchId:input.branchId,variantKeys:[...new Set(input.variantKeys)].sort()};
  try{await prisma.$transaction(async tx=>{
   if(!options.apply){await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');const check=await tx.$queryRawUnsafe('SHOW transaction_read_only');if(check[0]?.transaction_read_only!=='on')throw new Error('Read-only transaction not established');}
   globalThis[Symbol.for('maintenance-vin-batch-db')]=tx;
   const j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':resolve(root,'scripts/lib/maintenance-vin-batch-db.mjs')}});
   const {runWithRequestTenant}=await j.import('../src/lib/request-tenant-store.ts');
   const {loadSelectedMannApplications}=await j.import('../src/lib/mann-selected-applications.ts');
   const {getMannUnifiedTechnicalProfile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
   const {withMannEngineOilReference}=await j.import('../src/lib/mann-engine-oil-reference.ts');
   const {addMannResearchCatalogToProfile,persistMannResearchCatalog,mannResearchEngineCode,mannResearchIdentity}=await j.import('../src/lib/mann-research-catalog.ts');
   const {mannResearchHasSpecificConditions}=await j.import('../src/lib/mann-research-scope.ts');
   const {missingMannFluids,citedResearchItems}=await j.import('../src/lib/mann-fluid-research.ts');
   const {MANN_FLUID_SYSTEMS}=await j.import('../src/lib/mann-fluid-systems.ts');
   await runWithRequestTenant({mode:'branch',branchId:input.branchId,organizationId:input.organizationId,allowedBranchIds:[input.branchId]},async()=>{
    const branch=await tx.branch.findFirst({where:{id:input.branchId,status:'active'},select:{id:true,legacyOrganizationId:true}});
    if(!branch||(branch.legacyOrganizationId??branch.id)!==input.organizationId)throw new Error('Branch/organization mismatch');
    const applications=await loadSelectedMannApplications(result.variantKeys);
    if(result.variantKeys.some(key=>!applications.some(a=>a.vehicleVariantKey===key)))throw new Error('Unknown MANN variant');
    if(input.items.some(i=>!MANN_FLUID_SYSTEMS.includes(i.systemCode)))throw new Error('Unknown fluid system');
    const engineCode=mannResearchEngineCode(applications,input.engineCode??input.vehicleContext?.engineCode);
    if(input.engineCode&&!engineCode)throw new Error('Engine does not match every selected MANN variant');
    if(input.vehicleContext?.confirmedTransmissionType && input.vehicleContext.confirmedTransmissionType!==input.transmissionType)throw new Error('Confirmed gearbox context must match explicit transmissionType');
    const researchContext={...input.vehicleContext,engineCode:input.vehicleContext?.engineCode??engineCode,...(input.transmissionType?{confirmedTransmissionType:input.transmissionType}:{})};
    const identity=mannResearchIdentity(applications,input.transmissionType,engineCode,researchContext),vehicleKey='manual-mann-source:'+batchHash(JSON.stringify(identity));
    const evidenceId='manual-source:'+batchHash(JSON.stringify({organizationId:input.organizationId,variantKeys:result.variantKeys,engineCode:engineCode??null,scope:identity.scope,items:input.items}));
    result.evidenceId=evidenceId;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.organizationId}), hashtext(${vehicleKey}))`;
    const legacyEvidenceId='manual-source:'+batchHash(JSON.stringify({organizationId:input.organizationId,variantKeys:result.variantKeys,engineCode:engineCode??null,items:input.items}));
    const replay=await findManualSourceReplay(tx,{organizationId:input.organizationId,evidenceId,legacyEvidenceId,hasSpecificConditions:mannResearchHasSpecificConditions(identity.scope)});
    const previous=replay?.previous;
    if(replay?.status==='LEGACY_SCOPE_REVIEW_REQUIRED')result.legacyEvidenceId=legacyEvidenceId;
    const requirements=await tx.vehicleFluidRequirement.findMany({where:{id:{startsWith:'manual-fluid:'},rawRequirementJson:{path:['organizationId'],equals:input.organizationId}},select:{id:true}});
    const links=await tx.mannFluidRequirementLink.findMany({where:{id:{startsWith:'manual-fluid:'},evidenceJson:{path:['organizationId'],equals:input.organizationId}},select:{id:true}});
    const sources=await tx.fluidSourceRow.findMany({where:{id:{startsWith:'manual-fluid:'},parsedRowJson:{path:['organizationId'],equals:input.organizationId}},select:{id:true}});
    result.before={evidence:previous,requirementIds:requirements.map(r=>r.id),linkIds:links.map(r=>r.id),sourceIds:sources.map(r=>r.id)};
    // Persist the pre-write audit to disk before creating any source records.
    report.results.push(result);await save();
    if(replay){result.status=replay.status;return;}
    const vehicleContext={make:applications[0].make,model:applications[0].model,...researchContext};
    let profile=await getMannUnifiedTechnicalProfile(result.variantKeys,input.transmissionType,vehicleContext);
    profile=withMannEngineOilReference(profile,vehicleContext)??profile;
    profile=await addMannResearchCatalogToProfile({organizationId:input.organizationId,variantKeys:result.variantKeys,transmissionType:input.transmissionType,engineCode,vehicleContext,profile,materializeSaved:false});
    result.gapsBefore=missingMannFluids(profile,input.transmissionType);
    const filtered=citedResearchItems({items:input.items,unresolved:[],systems:[]},new Set(input.items.map(i=>i.sourceUrl)),result.gapsBefore);
    result.acceptedItems=filtered;
    if(!filtered.length){result.status='NO_MISSING_FIELDS';return;}
    if(!options.apply){result.status='DRY_RUN';return;}
    await tx.aIAgentTechnicalEvidence.create({data:{id:evidenceId,organizationId:input.organizationId,vehicleKey,aggregate:batchHash(JSON.stringify(input.items)),factType:'MANUAL_VIN_FLUID_SOURCE_REVIEW_V1',vehicleSnapshot:JSON.parse(JSON.stringify(identity)),facts:{sourceKind:'manual_source_review',items:filtered,inputHash:report.inputHash,reviewRequired:true},sourceName:'Independently gathered published source',sourceUrl:filtered[0].sourceUrl,sourceExcerpt:filtered[0].excerpt,confidence:0,status:'pending_review',validUntil:null}});
    await persistMannResearchCatalog(tx,{organizationId:input.organizationId,variantKeys:result.variantKeys,applications,transmissionType:input.transmissionType,engineCode,vehicleContext,evidenceId,items:filtered,sourceKind:'manual_source_review'});
    const afterRequirements=await tx.vehicleFluidRequirement.findMany({where:{rawRequirementJson:{path:['evidenceId'],equals:evidenceId}},select:{id:true}});
    const afterLinks=await tx.mannFluidRequirementLink.findMany({where:{evidenceJson:{path:['evidenceId'],equals:evidenceId}},select:{id:true}});
    const afterSources=await tx.fluidSourceRow.findMany({where:{parsedRowJson:{path:['evidenceId'],equals:evidenceId}},select:{id:true}});
    result.after={evidenceId,requirementIds:afterRequirements.map(r=>r.id),linkIds:afterLinks.map(r=>r.id),sourceIds:afterSources.map(r=>r.id)};result.status='IMPORTED_REVIEW_REQUIRED';
   });
  },{maxWait:15000,timeout:120000});}catch(error){result.status='ERROR';result.errorType=error?.name??'Error';result.errorCode=error?.code??null;}
  if(!report.results.includes(result))report.results.push(result);await save();console.log(JSON.stringify({processed:report.results.length,status:result.status}));
 }
}finally{globalThis.fetch=savedFetch;delete globalThis[Symbol.for('maintenance-vin-batch-db')];if(prisma)await prisma.$disconnect();await lock.close();await unlink(output+'.lock');}
