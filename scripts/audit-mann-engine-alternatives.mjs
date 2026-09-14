#!/usr/bin/env node
// Read-only diagnosis: alternate source engine codes never approve a fluid link.
import { readFile, writeFile } from 'node:fs/promises';
import { createJiti } from 'jiti';
import { resolve } from 'node:path';
import { parseCopy, sha } from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..');
if(process.argv.length>2) throw Error('This audit accepts no mutation or override flags');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeFluidRequirementVehicle}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {evaluateMannCandidate}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const [mannRaw,fluidRaw,decisionRaw]=await Promise.all([
  readFile('/tmp/mann_filter_applications.sql','utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile(resolve(root,'outputs/mann-scoped-full-2026-09-13/decisions.ndjson'),'utf8'),
]);
const rows=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const requirements=new Map(parseCopy(fluidRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const results=[];let scanned=0, multi=0;
for(const d of decisionRaw.trim().split('\n').map(JSON.parse)){
  const r=requirements.get(d.requirementId);
  if(!r)throw Error('Missing source requirement');
  scanned++;
  const codes=[...new Set([r.engineCodeNormalized,...(r.engineCodesJson??[])].filter(Boolean))];
  if(codes.length<2)continue;
  multi++;
  const alternatives=[];
  // Inspect all existing top-20 retrieval candidates; this is not a full rerank.
  for(const code of codes.slice(1)){
    const vehicle=normalizeFluidRequirementVehicle({...r,engineCodeNormalized:code,engineCodesJson:[code]});
    if(!vehicle)continue;
    for(const candidate of d.match.topCandidates){
      if(candidate.matchedFields.includes('точный код двигателя'))continue;
      for(const key of candidate.variantIds){
        const evidence=(rows.get(key)??[]).map(row=>evaluateMannCandidate(vehicle,row).candidate).find(c=>
          c?.matchedFields.includes('точный код двигателя') && c.mismatchedFields.length===0);
        if(!evidence)continue;
        alternatives.push({engineCode:code,vehicleVariantKey:key,score:evidence.score,
          matchedFields:evidence.matchedFields,missingFields:evidence.missingFields,
          warnings:evidence.warnings,originalHardConflicts:candidate.hardConflicts,
          originalReviewBlockers:candidate.reviewBlockers});
      }
    }
  }
  if(alternatives.length)results.push({requirementId:r.id,sourceUrl:r.sourceUrl,systemCode:r.systemCode,
    sourceEngineCodes:codes,originalDisposition:d.disposition,alternatives});
  if(multi%500===0)console.log(JSON.stringify({multi,affected:results.length}));
}
const report={artifactKind:'MANN_ENGINE_ALTERNATIVE_DIAGNOSTIC',publicationAllowed:false,
  generatedAt:new Date().toISOString(),sourceHashes:{mann:sha(mannRaw),fluids:sha(fluidRaw),decisions:sha(decisionRaw)},
  scanned,multiEngineRequirements:multi,affectedRequirements:results.length,
  candidateLinks:results.reduce((n,r)=>n+r.alternatives.length,0),
  limitation:'Existing top-20 candidates only; no system-aware approval, month restriction, capacity or specification validation. All alternatives require full re-matching with engine-specific scope.',
  results};
const output=resolve(root,'outputs/mann-scoped-full-2026-09-13/engine-alternative-diagnostic.json');
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,results:undefined,output},null,2));
