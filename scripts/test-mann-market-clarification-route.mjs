import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha, parseCopy} from './lib/mann-offline-scope.mjs';

const root=resolve(import.meta.dirname,'..');
const out=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const planRaw=await readFile(resolve(out,'plan.json'),'utf8');
assert.equal(sha(planRaw),'813977a2654f21eac4510323cd8491eb8be59a5bf8b25c38e15aaea9fad4c444');
const plan=JSON.parse(planRaw);
const catalogRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(catalogRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const profile={calls:0,rows:plan.newRevisions.map(r=>({...r,createdAt:new Date('2026-09-15'),reviewDecisions:[],reviewConfirmed:false,
  run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{
    catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}}))};
globalThis[Symbol.for('mann-resolver-archive-test')]={rows:parseCopy(catalogRaw,'mann_filter_applications'),aliasCalls:0,mappingCalls:0,catalogCalls:0};
globalThis[Symbol.for('mann-profile-db-route-test')]=profile;
const fixture=resolve(root,'scripts/fixtures/mann-vin-replay-stubs.mjs');
const j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':fixture,'@/lib/branch-api':fixture,'@/lib/integrations/tronk/client':fixture}});
const savedFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Network forbidden');};
const checks=[];
try {
  const {lookupVehicle}=await j.import('../src/lib/vehicle-identity.ts');
  const {resolveMannVehicle}=await j.import('../src/lib/mann-vehicle-resolver.ts');
  const {mannTechnicalContextFromVehicle:context,unsupportedVehicleMarketLabels:labels}=await j.import('../src/lib/mann-technical-request-context.ts');
  const {POST}=await j.import('../src/app/api/mann-catalog/technical-profile/route.ts');
  let found=false;
  for(const file of ['dataset-c.generation-2-traces.json','dataset-d.blind-traces.json']) {
    const data=JSON.parse(await readFile(resolve(root,'outputs/mann-matching-private',file),'utf8'));
    for(const sample of data.results) {
      if(sha([file,sample.sampleId]).slice(0,16)!=='ee158d685edade6f')continue;
      found=true;
      const trace=sample.providerTrace;
      globalThis[Symbol.for('mann-vin-recorded-replay')]={vin:trace.vin.toUpperCase(),trace,methods:[],discardedCacheWrites:0};
      const lookup=await lookupVehicle({organizationId:'OFFLINE_MARKET_ROUTE',inputType:'vin',input:trace.vin,refresh:true});
      for(const {vehicle} of lookup.candidates) {
        const resolution=await resolveMannVehicle({organizationId:'OFFLINE_MARKET_ROUTE',vehicle});
        const key='7053df11bba1111be1eaff16e86343c2dc5e2b3568083c3b4eeaffd818e7da8e';
        const candidate=resolution.candidates.find(c=>c.variantIds.includes(key));
        if(!candidate)continue;
        assert.deepEqual(labels(vehicle),['ex.NA']);
        const original=JSON.stringify(vehicle);
        const expected=['mtar_8704c80c9c2525631478d99c','mtar_5e87b2c008984e6eb3c2cfc6','mtar_b442b7b3589e6aa261afd56e'].sort();
        // Synthetic confirmation tests control flow, not this real vehicle's destination.
        const proof={sourceLabels:labels(vehicle),evidenceReference:'SYNTHETIC TEST ONLY — not a verified vehicle document'};
        const confirmed={confirmedMarket:'RU',marketClarification:proof};
        async function check(name,v,details,wantVisible) {
          const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:candidate.variantIds,vehicleContext:context(v,details,candidate)})}));
          assert.equal(response.status,200);
          const result=await response.json();
          assert.ok(result.items.every(item=>!item.automaticSelectionEligible));
          const actual=result.items.filter(item=>expected.includes(item.revisionId)).map(item=>item.revisionId).sort();
          assert.deepEqual(actual,wantVisible?expected:[],name);
          checks.push({name,visibleRevisionIds:actual});
        }
        await check('original unknown market stays blocked',vehicle,{},false);
        await check('selection without evidence stays blocked',vehicle,{confirmedMarket:'RU'},false);
        await check('explicit synthetic RU confirmation opens three scoped fluids',vehicle,confirmed,true);
        await check('withdrawn confirmation hides scoped fluids again',vehicle,{},false);
        await check('JP confirmation does not match RU source',vehicle,{...confirmed,confirmedMarket:'JP'},false);
        await check('wrong installed engine remains blocked',{...vehicle,engineCode:'4B11'},confirmed,false);
        await check('out-of-window production remains blocked',{...vehicle,year:2010,productionMonth:'2010-06'},confirmed,false);
        await check('stale labels cannot reuse proof',{...vehicle,market:'NA',marketEvidence:{values:['NA']}},confirmed,false);
        await check('recognized market conflict remains blocked',{...vehicle,market:undefined,marketEvidence:{values:['RU','US']}},confirmed,false);
        await check('empty evidence remains blocked',vehicle,{...confirmed,marketClarification:{...proof,evidenceReference:''}},false);
        assert.equal(JSON.stringify(vehicle),original);
      }
    }
  }
  assert.ok(found);assert.ok(checks.length>=10);
  const report={kind:'MARKET_CLARIFICATION_RECORDED_OUTLANDER_ROUTE_TEST',planHash:sha(planRaw),checks,profileCalls:profile.calls,
    limitations:['Recorded lookup and actual resolver/context/POST; database and provider intercepted.','Market proof is synthetic: no assertion of actual RU destination or new verified VIN coverage.','Simulated completed staging, not production publication; no automatic product selection.'],productionApplyAllowed:false};
  await writeFile(resolve(out,'market-clarification-route-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(`PASS: ${checks.length} actual route checks; explicit correction opens three scoped fluids, all negative gates retained.`);
} finally {
  globalThis.fetch=savedFetch;
  for(const key of ['mann-resolver-archive-test','mann-profile-db-route-test','mann-vin-recorded-replay'])delete globalThis[Symbol.for(key)];
}
