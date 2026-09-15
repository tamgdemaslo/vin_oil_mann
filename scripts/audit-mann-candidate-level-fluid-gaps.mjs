import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const outputVersion=process.argv[2]??'v1';assert.ok(['v1','v2'].includes(outputVersion));
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);assert.equal(sha(planRaw),'3a7f0db58e9603f4b0a60fa2ae5181fd85cae6a72fc5ef880842f51343af47c0');
const draftByKey=Map.groupBy(plan.newRevisions,r=>r.vehicleVariantKey);
const catalogRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(catalogRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
globalThis[Symbol.for('mann-resolver-archive-test')]={rows:parseCopy(catalogRaw,'mann_filter_applications'),aliasCalls:0,mappingCalls:0,catalogCalls:0};globalThis[Symbol.for('mann-profile-db-route-test')]={rows:[],calls:0};
const fixture=resolve(root,'scripts/fixtures/mann-vin-replay-stubs.mjs'),j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':fixture,'@/lib/branch-api':fixture,'@/lib/integrations/tronk/client':fixture}});
const savedFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Network forbidden during candidate audit');};
const findings=[],hashes={plan:sha(planRaw),catalog:sha(catalogRaw)};let samples=0,missingVin=0,noVehicle=0;
try{
 const {lookupVehicle}=await j.import('../src/lib/vehicle-identity.ts'),{resolveMannVehicle}=await j.import('../src/lib/mann-vehicle-resolver.ts');
 for(const file of ['dataset-c.generation-2-traces.json','dataset-d.blind-traces.json']){
  const raw=await readFile(resolve(root,'outputs/mann-matching-private',file),'utf8');hashes[file]=sha(raw);
  for(const sample of JSON.parse(raw).results){
   samples++;const sampleRef=sha([file,sample.sampleId]).slice(0,16),trace=sample.providerTrace;
   if(!trace?.vin||!/^[A-HJ-NPR-Z0-9]{17}$/i.test(trace.vin)){missingVin++;continue;}
   globalThis[Symbol.for('mann-vin-recorded-replay')]={vin:trace.vin.toUpperCase(),trace,methods:[],discardedCacheWrites:0};
   const lookup=await lookupVehicle({organizationId:`OFFLINE_CANDIDATE_GAPS_${sampleRef}`,inputType:'vin',input:trace.vin,refresh:true});
   if(!lookup.candidates.length){noVehicle++;continue;}
   const evaluations=[];
   for(const {vehicle} of lookup.candidates){
    const result=await resolveMannVehicle({organizationId:`OFFLINE_CANDIDATE_GAPS_${sampleRef}`,vehicle});
    const candidates=result.candidates.map(c=>({variantIds:c.variantIds,model:c.model,engineCode:c.engineCode,vehicleText:c.vehicleText,matchedFields:c.matchedFields,mismatchedFields:c.mismatchedFields,technicalIdentity:c.technicalIdentity,
     draftCount:c.variantIds.reduce((n,k)=>n+(draftByKey.get(k)?.length??0),0),missingVariantKeys:c.variantIds.filter(k=>!draftByKey.has(k)),hasResolverConflict:c.mismatchedFields.length>0}));
    evaluations.push({make:vehicle.makeCanonical??vehicle.makeRaw,model:vehicle.modelCanonical??vehicle.modelRaw,candidates});
   }
   const hasAnyDraft=evaluations.some(e=>e.candidates.some(c=>c.draftCount>0));findings.push({sampleRef,hasAnyDraft,evaluations});
  }
 }
 assert.equal(samples,200);assert.equal(missingVin,78);assert.equal(noVehicle,3);assert.equal(findings.length,119);
 const pairs=findings.flatMap(f=>f.evaluations.flatMap(e=>e.candidates.flatMap(c=>c.missingVariantKeys.map(vehicleVariantKey=>({sampleRef:f.sampleRef,make:e.make,decodedModel:e.model,vehicleVariantKey,model:c.model,engineCode:c.engineCode,vehicleText:c.vehicleText,hasResolverConflict:c.hasResolverConflict,mismatchedFields:c.mismatchedFields,technicalIdentity:c.technicalIdentity,previousSampleLevelQueueWouldSkip:f.hasAnyDraft})))));
 const eligible=pairs.filter(p=>!p.hasResolverConflict),queue=[...Map.groupBy(eligible,p=>p.vehicleVariantKey)].map(([vehicleVariantKey,group])=>({vehicleVariantKey,model:group[0].model,engineCode:group[0].engineCode,sampleRefs:[...new Set(group.map(p=>p.sampleRef))],newlyRecoveredSamples:[...new Set(group.filter(p=>p.previousSampleLevelQueueWouldSkip).map(p=>p.sampleRef))],technicalIdentities:group.map(p=>p.technicalIdentity)}));
 const summary={samples,replayed:findings.length,missingVin,noVehicle,missingCandidatePairs:pairs.length,conflictingPairsExcluded:pairs.length-eligible.length,nonConflictingPairs:eligible.length,uniqueMissingVariants:queue.length,recoveredPairsFromPartiallyCoveredSamples:eligible.filter(p=>p.previousSampleLevelQueueWouldSkip).length,recoveredVariantKeys:queue.filter(q=>q.newlyRecoveredSamples.length).length};
 assert.ok(queue.some(q=>q.vehicleVariantKey==='5edb370f189f6b0a4317708bdaf3013a0d3c25581f794f88bf977c56140c5b7b'&&q.newlyRecoveredSamples.includes('c26329af2e273aa4')));
 assert.ok(!queue.some(q=>q.vehicleVariantKey==='8edddc03d3a2997c6f9257dc8da33b1264a7bbd15e992901673cbc30c0697321'));
 const files=['src/lib/vehicle-identity.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-catalog.ts'];
 await writeFile(resolve(dir,`candidate-level-fluid-gap-audit-${outputVersion}.json`),JSON.stringify({kind:'RECORDED_VIN_CANDIDATE_LEVEL_FLUID_GAP_AUDIT',hashes,runtimeHashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary,queue,findings,productionApplyAllowed:false,limitations:['No resolver mismatch is not proof the offered candidate is the installed vehicle.','Queue records missing draft coverage, not verified missing fluids or product applicability.','Partially covered variants can still lack systems; this queue is not a completeness metric.','All provider/cache/DB interactions intercepted; no actual VIN sent or disclosed.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
}finally{globalThis.fetch=savedFetch;for(const key of ['mann-resolver-archive-test','mann-profile-db-route-test','mann-vin-recorded-replay'])delete globalThis[Symbol.for(key)];}
