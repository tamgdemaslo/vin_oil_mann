import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const wanted=new Set(['c26329af2e273aa4','d9fc89ee1d803b67','70c25b09450c8cbe']);
const catalogRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
globalThis[Symbol.for('mann-resolver-archive-test')]={rows:parseCopy(catalogRaw,'mann_filter_applications'),aliasCalls:0,mappingCalls:0,catalogCalls:0};
globalThis[Symbol.for('mann-profile-db-route-test')]={rows:[],calls:0};
const fixture=resolve(root,'scripts/fixtures/mann-vin-replay-stubs.mjs'),j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':fixture,'@/lib/branch-api':fixture,'@/lib/integrations/tronk/client':fixture}});
const savedFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Network forbidden');};
const findings=[],hashes={catalog:sha(catalogRaw)};
try{
 const {lookupVehicle}=await j.import('../src/lib/vehicle-identity.ts'),{resolveMannVehicle}=await j.import('../src/lib/mann-vehicle-resolver.ts');
 for(const file of ['dataset-c.generation-2-traces.json','dataset-d.blind-traces.json']){
  const raw=await readFile(resolve(root,'outputs/mann-matching-private',file),'utf8');hashes[file]=sha(raw);
  for(const sample of JSON.parse(raw).results){
   const sampleRef=sha([file,sample.sampleId]).slice(0,16);if(!wanted.has(sampleRef))continue;
   const trace=sample.providerTrace;assert.match(trace.vin,/^[A-HJ-NPR-Z0-9]{17}$/i);
   globalThis[Symbol.for('mann-vin-recorded-replay')]={vin:trace.vin.toUpperCase(),trace,methods:[],discardedCacheWrites:0};
   const lookup=await lookupVehicle({organizationId:`OFFLINE_ENGINE_DIAG_${sampleRef}`,inputType:'vin',input:trace.vin,refresh:true});
   const evaluations=[];
   for(const {vehicle} of lookup.candidates){
    const result=await resolveMannVehicle({organizationId:`OFFLINE_ENGINE_DIAG_${sampleRef}`,vehicle});
    evaluations.push({make:vehicle.makeCanonical??vehicle.makeRaw,model:vehicle.modelCanonical??vehicle.modelRaw,enginePresent:!!vehicle.engineCode,candidates:result.candidates.map(c=>({variantIds:c.variantIds,matchedFields:c.matchedFields,mismatchedFields:c.mismatchedFields,technicalIdentity:c.technicalIdentity,engineCode:c.engineCode,model:c.model,vehicleText:c.vehicleText}))});
   }
   findings.push({sampleRef,evaluations});
  }
 }
 assert.equal(findings.length,3);
 await writeFile(resolve(dir,'engine-confirmation-gap-diagnosis-v1.json'),JSON.stringify({kind:'THREE_RECORDED_ENGINE_CONFIRMATION_GAPS',hashes,findings,productionApplyAllowed:false,limitations:['Recorded provider responses and intercepted DB; no real VIN requests.','Offered catalogue candidates are not asserted correct.','Only missing-engine-alone sample cohort inspected.']},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(findings));
}finally{globalThis.fetch=savedFetch;for(const key of ['mann-resolver-archive-test','mann-profile-db-route-test','mann-vin-recorded-replay'])delete globalThis[Symbol.for(key)];}
