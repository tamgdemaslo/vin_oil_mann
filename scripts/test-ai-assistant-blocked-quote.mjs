#!/usr/bin/env node
// Frozen reproduction of a researched transmission quote with no service volume.
// Synthetic identity, tariffs and catalogue; no live providers or customer data.
import assert from 'node:assert/strict';
import {reset,input,product,call,final,run,artifact} from './fixtures/ai-assistant/harness.mjs';
const f=reset();
f.tables.localProduct=[];
f.tables.aIAssistantLaborPricingRule[1].transmissionConfiguration='no_pan';
f.tables.aIAssistantLaborPricingRule.push({...f.tables.aIAssistantLaborPricingRule[1],id:'pan',transmissionConfiguration:'pan_and_filter',laborPriceCents:500000});
const value=input({selectedProducts:[],service:{type:'automatic_transmission',name:'Замена ATF',requiredFluidSpec:'TEST-ATF',filterAccess:'integrated_with_pan',materialsOwner:'service',totalTechnicalQuantityLiters:10},requestedProcedures:['partial','filter_service'],evidence:[{source:'External manual',fact:'Full refill is not a fixed service quantity',url:'https://example.test/manual',status:'needs_verification'}]});
f.responses=[call('build_quote_and_tech_card',{input:value})];
await run('Рассчитай замену масла в АКПП TEST CAR');
const result=artifact(f);
assert.equal(result.customerMessage.status,'blocked');
assert.deepEqual(result.quoteSet.options.map(o=>o.lines.find(l=>l.role==='labor')?.totalCents),[400000,500000],'known branch labour must survive missing service volume');
for(const option of result.quoteSet.options){
  assert.equal(option.totalCents,null,'labour alone is not a complete quote');
  assert.equal(option.billableQuantityLiters,null,'full fill must not become service consumption');
  assert.ok(option.blockers.some(b=>b.code==='LOCAL_FLUID_NOT_FOUND'));
  assert.ok(option.blockers.some(b=>b.code==='MISSING_SERVICE_QUANTITY'));
}
assert.equal((f.tables.aIAssistantQuote??[]).length,0);
assert.equal(f.providerCalls,0);
const sources=f.tables.aIAssistantSource??[];
assert.ok(sources.some(s=>s.url==='https://example.test/manual'&&s.sourceType==='web'));
assert.equal(sources.some(s=>s.url==='https://example.test/manual'&&s.sourceType==='internal_catalog'),false);
console.log('PASS blocked quote keeps labour, checks local material and preserves unknown service volume');

for (const mode of ['wrong_spec','no_price','no_stock','candidate']) {
  const state=reset();
  state.tables.localProduct=[product('fluid',{atf:mode==='wrong_spec'?'OTHER-ATF':'TEST-ATF',oemAtf:null,searchText:'TEST-ATF',salePriceCents:mode==='no_price'?0:100000,stockBalances:[{available:mode==='no_stock'?0:1}]})];
  state.responses=[call('build_quote_and_tech_card',{input:value})];
  await run('Рассчитай замену масла в АКПП TEST CAR');
  const option=artifact(state).quoteSet.options[0];
  const expected={wrong_spec:'LOCAL_FLUID_NOT_FOUND',no_price:'NO_MATERIAL_PRICE',no_stock:'LOCAL_FLUID_OUT_OF_STOCK',candidate:null}[mode];
  assert.equal(option.blockers.some(b=>b.code===expected),Boolean(expected),mode);
  assert.equal(option.totalCents,null);
  assert.equal(option.materialSelectionTrace.selectedProduct.productId,null,'a catalogue candidate is not a selected service fluid');
  assert.equal(option.billableQuantityLiters,null);
}
console.log('PASS independent catalogue diagnostics distinguish specification, price and stock without inventing quantity');

const researchState=reset();
researchState.tables.localProduct=[];
researchState.tables.aIAssistantLaborPricingRule[1].transmissionConfiguration='no_pan';
researchState.tables.aIAssistantLaborPricingRule.push({...researchState.tables.aIAssistantLaborPricingRule[1],id:'pan',transmissionConfiguration:'pan_and_filter',laborPriceCents:500000});
const findings='Factory document: drained amount plus level adjustment. '.repeat(24)+' END OF FINDINGS';
researchState.researchResponse=final(findings);
researchState.responses=[
  call('lookup_technical_data',{vehicle:{make:'TEST',model:'CAR'},serviceType:'automatic_transmission',procedures:['partial','filter_service'],missingFields:['capacity','procedure','filterAccess','levelTemperature','torqueNotes']}),
  call('build_quote_and_tech_card',{input:value}),
];
await run('Рассчитай замену масла в АКПП TEST CAR');
const researched=artifact(researchState);
assert.equal(researched.techCard.research.findings,findings,'full current-run research survives the blocked calculator');
assert.deepEqual(researched.techCard.verifiedFacts,[],'retaining research cannot promote it to verified facts');
assert.equal(researched.customerMessage.status,'blocked');
console.log('PASS real runner retains researched findings without converting them into technical approval');

const enrichedState=reset();
enrichedState.tables.localProduct=[product('fluid',{atf:'TEST-ATF',oemAtf:null,searchText:'TEST-ATF',uomName:'л',packageVolume:'1 л'})];
enrichedState.researchResponse=final(findings);
enrichedState.responses=[
  call('lookup_technical_data',{vehicle:{make:'TEST',model:'CAR'},serviceType:'automatic_transmission',procedure:'partial',missingFields:['procedure','filterAccess','levelTemperature','torqueNotes']}),
  call('build_quote_and_tech_card',{input:{...value,service:{...value.service,partialTechnicalQuantityLiters:4},requestedProcedures:['partial']}}),
];
await run('Рассчитай частичную замену масла в АКПП TEST CAR без поддона');
assert.notEqual(artifact(enrichedState).quoteSet.options[0].totalCents,null);
assert.equal(enrichedState.modelCalls.filter(c=>c.body.tools?.some(t=>t.type==='web_search')).length,1,'priced quote does not repeat already completed research');
console.log('PASS priced quote reuses completed research without a second paid search');
