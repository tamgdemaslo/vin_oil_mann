#!/usr/bin/env node
// Read-only, bounded, no client messages/VIN/phones/keys in the output.
import { PrismaClient } from '@prisma/client';
import { createJiti } from 'jiti';
import { resolve } from 'node:path';
const limit=100, asOf=new Date(), since=new Date(asOf.getTime()-7*86400000);
const source=process.env.TGM_AUDIT_SOURCE_LABEL;
if(!process.env.TGM_AUDIT_DATABASE_URL || !source) throw new Error('Set TGM_AUDIT_DATABASE_URL and non-secret TGM_AUDIT_SOURCE_LABEL in a secure environment');
const url=new URL(process.env.TGM_AUDIT_DATABASE_URL);
if(process.env.TGM_AUDIT_INFRASTRUCTURE !== 'timeweb' || process.env.TGM_AUDIT_EXPECTED_HOST !== url.hostname) throw new Error('Explicit Timeweb target and matching approved hostname are required');
url.searchParams.set('connect_timeout','5');
const db=new PrismaClient({datasourceUrl:url.toString(),log:[]});
const jiti=createJiti(import.meta.url,{alias:{'@':resolve('src')}});
const {summarizeAssistantRuns}=await jiti.import('../src/lib/ai-assistant/run-metrics.ts');
try {
 const data=await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '15000ms'");
  const where={createdAt:{gte:since,lte:asOf}};
  const availableInWindow=await tx.aIAssistantRun.count({where});
  const runs=await tx.aIAssistantRun.findMany({where,orderBy:{createdAt:'desc'},take:limit,select:{id:true,status:true,model:true,startedAt:true,completedAt:true,durationMs:true,inputTokens:true,outputTokens:true,toolSummaryJson:true,toolCalls:{select:{toolName:true,status:true,durationMs:true,argumentsJson:true,createdAt:true}},quotes:{select:{createdAt:true,baseTotalCents:true}}}});
  const messages=await tx.aIAssistantMessage.findMany({where:{runId:{in:runs.map(r=>r.id)},role:'assistant'},select:{runId:true,attachmentsJson:true}});
  const profileTable=await tx.$queryRawUnsafe("SELECT to_regclass('public.mann_technical_association_revisions') IS NOT NULL AS present");
  const technicalProfileAvailability = profileTable[0]?.present ? await tx.$queryRawUnsafe('SELECT state, verification_status AS "verificationStatus", COUNT(*)::int AS count FROM mann_technical_association_revisions GROUP BY state, verification_status') : null;
  return {technicalProfileAvailability,availableInWindow,runs:runs.map(run=>({...run,tools:run.toolCalls,messages:messages.filter(message=>message.runId===run.id)}))};
 },{timeout:30000});
 console.log(JSON.stringify({...summarizeAssistantRuns(data.runs,{asOf:asOf.toISOString(),since:since.toISOString(),availableInWindow:data.availableInWindow,limit,source}),technicalProfileAvailability:data.technicalProfileAvailability},null,2));
} catch(error) {console.log(JSON.stringify({asOf:asOf.toISOString(),source,available:false,code:error.code??'AUDIT_FAILED'}));process.exitCode=1;} finally{await db.$disconnect();}
