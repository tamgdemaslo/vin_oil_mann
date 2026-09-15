import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
const mock=resolve('scripts/fixtures/mann-fluid-research-mocks.mjs');
const j=createJiti(import.meta.url,{alias:{'@':resolve('src'),'@/lib/db':mock,'@/lib/openai-client':mock}});
const {researchMissingMannFluids:run,citedResearchItems,missingMannFluids}=await j.import('../src/lib/mann-fluid-research.ts');
const profile={items:[],status:'none',transmissionOptions:[],containsCatalogPreview:false};
const input={organizationId:'org1',variantKeys:['key'],vehicleContext:{make:'Test',model:'Car',engineCode:'ABC',year:2020},profile};
const item={systemCode:'ENGINE_OIL',specification:'TEST',volumeText:'5 л. с фильтром',sourceUrl:'https://example.com/manual',sourceTitle:'Manual',excerpt:'Test excerpt'};
const reset=()=>globalThis.fluidResearchTest={rows:[],calls:0,payload:{items:[item],unresolved:[]}};
const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only-not-a-real-key';
try {
 let s=reset();assert.equal((await run({...input,variantKeys:['a','b']})).status,'needs_context');assert.equal(s.calls,0);
 const completeProfile={...profile,items:['ENGINE_OIL','ENGINE_COOLANT','BRAKE_FLUID'].map(systemCode=>({systemCode,specifications:['Existing'],capacities:[{nominalLiters:5}]}))};
 assert.equal((await run({...input,profile:completeProfile})).status,'complete');assert.equal(s.calls,0);
 const first=await run(input);assert.equal(first.status,'saved');assert.equal(s.request.model,'gpt-5.6-terra');assert.equal(s.request.tool_choice,'required');assert.equal(s.rows[0].status,'pending_review');assert.equal(s.rows[0].confidence,0);
 assert.deepEqual((await run(input)).items,first.items);assert.equal(s.calls,1,'cached, no repeat cost');
 await run({...input,organizationId:'org2'});assert.equal(s.calls,2,'no tenant cache leak');
 const gaps=missingMannFluids(profile);assert.deepEqual(citedResearchItems({items:[{...item,sourceUrl:'https://invented.example/manual'}],unresolved:[]},new Set([item.sourceUrl]),gaps),[]);
 assert.equal(citedResearchItems({items:[item],unresolved:[]},new Set([item.sourceUrl]),[{systemCode:'ENGINE_OIL',specification:false,volume:true}])[0].specification,'');
 s=reset();s.fail=true;assert.equal((await run(input)).status,'unavailable');assert.equal(s.rows[0].status,'failed');assert.equal((await run(input)).status,'unavailable');assert.equal(s.calls,1);
 s=reset();s.limit=true;assert.equal((await run(input)).status,'unavailable');assert.equal(s.calls,0);
 s=reset();s.payload={items:[{...item,sourceUrl:'https://unvisited.example/manual'}],unresolved:[]};assert.equal((await run(input)).status,'unavailable');assert.equal(s.rows[0].status,'not_found');
 console.log('PASS Terra model, required web search, cited-source filtering, missing fields only, tenant cache, failure backoff, rate limit, pending-review persistence');
}finally{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
