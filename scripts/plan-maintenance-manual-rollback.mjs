/** Read-only rollback evidence planner. No mutation SQL and no --apply option. */
import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {PrismaClient} from '@prisma/client';
import {manualRollbackTargets,buildManualRollbackPlan} from './lib/maintenance-manual-rollback-plan.mjs';
const args=process.argv.slice(2),paths=[];let output;
for(let i=0;i<args.length;i++){if(args[i]==='--audit'&&args[i+1])paths.push(resolve(args[++i]));else if(args[i]==='--output'&&args[i+1])output=resolve(args[++i]);else throw new Error('Only --audit applied-audit.json (repeatable) and --output private-plan.json are supported; no apply mode');}
if(!paths.length||!output||!process.env.DATABASE_URL)throw new Error('--audit, --output and DATABASE_URL required');
const audits=await Promise.all(paths.map(async p=>JSON.parse(await readFile(p,'utf8')))),{target}=manualRollbackTargets(audits),db=new PrismaClient();
try{const snapshot=await db.$transaction(async tx=>{
 await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');const check=await tx.$queryRawUnsafe('SHOW transaction_read_only');if(check[0]?.transaction_read_only!=='on')throw new Error('Read-only required');
 const [evidence,requirements,links,sources,externalLinks,externalRequirements]=await Promise.all([
 tx.aIAgentTechnicalEvidence.findMany({where:{id:{in:target.evidence}}}),tx.vehicleFluidRequirement.findMany({where:{id:{in:target.requirements}}}),tx.mannFluidRequirementLink.findMany({where:{id:{in:target.links}}}),tx.fluidSourceRow.findMany({where:{id:{in:target.sources}}}),
 tx.mannFluidRequirementLink.findMany({where:{requirementId:{in:target.requirements},id:{notIn:target.links}},select:{id:true,requirementId:true}}),
 tx.vehicleFluidRequirement.findMany({where:{sourceRowId:{in:target.sources},id:{notIn:target.requirements}},select:{id:true,sourceRowId:true}}),
 ]);
 const [evidenceLinks,evidenceRequirements,evidenceSources]=await Promise.all([
 tx.mannFluidRequirementLink.findMany({where:{id:{notIn:target.links},OR:target.evidence.map(e=>({evidenceJson:{path:['evidenceId'],equals:e}}))},select:{id:true}}),
 tx.vehicleFluidRequirement.findMany({where:{id:{notIn:target.requirements},OR:target.evidence.map(e=>({rawRequirementJson:{path:['evidenceId'],equals:e}}))},select:{id:true}}),
 tx.fluidSourceRow.findMany({where:{id:{notIn:target.sources},OR:target.evidence.map(e=>({parsedRowJson:{path:['evidenceId'],equals:e}}))},select:{id:true}}),
 ]);
 return {readOnly:true,evidence,requirements,links,sources,externalReferences:[...externalLinks.map(r=>({table:'mann_fluid_requirement_links',...r})),...externalRequirements.map(r=>({table:'vehicle_fluid_requirements',...r})),...evidenceLinks.map(r=>({table:'mann_fluid_requirement_links/evidence',...r})),...evidenceRequirements.map(r=>({table:'vehicle_fluid_requirements/evidence',...r})),...evidenceSources.map(r=>({table:'fluid_source_rows/evidence',...r}))]};
},{timeout:120000});
const plan=buildManualRollbackPlan(audits,snapshot);await writeFile(output,JSON.stringify(plan,null,2)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({readOnly:true,applySupported:false,targetCounts:plan.targetCounts,blocks:plan.blocks.reduce((a,b)=>(a[b.reason]=(a[b.reason]??0)+1,a),{})}));
}finally{await db.$disconnect();}
