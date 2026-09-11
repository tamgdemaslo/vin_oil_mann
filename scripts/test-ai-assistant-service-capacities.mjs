#!/usr/bin/env node
// Reviewed profile/catalog fixtures. No live VIN, provider, or business prices.
import assert from 'node:assert/strict';
import {reset,input,product,call,run,artifact,tenant,ctx,runWithRequestTenant,executeAssistantTool,withAssistantExecution,jiti} from './fixtures/ai-assistant/harness.mjs';
const {verifiedLocalTechnicalInput}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/technical-context.ts');
const {createQuoteAndTechCardPlan,parseQuoteAndTechCardInput}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/quote-and-tech-card.ts');
let count=0;
async function test(name,work){await work();count++;console.log(`PASS ${name}`);}
const profile=(capacities)=>({status:'active',items:[{revisionId:'reviewed-test',systemCode:'AUTOMATIC_TRANSMISSION',componentModel:'TEST-9',sourceStatus:'primary_source',requiresReview:false,specifications:['TEST-ATF'],viscosityGrades:[],capacities,evidence:[{publisher:'OEM fixture',url:'https://example.test/manual'}]}]});
const sourceCapacities=[{nominalLiters:4,serviceContext:'WITHOUT_FILTER'},{nominalLiters:7,serviceContext:'WITH_FILTER'}];
function setup(capacities=sourceCapacities){
  const f=reset();
  f.mann={status:'resolved',decision:'MATCH',selectedApplication:{variantIds:['reviewed-variant']},candidates:[],filters:[],localMatches:[]};
  f.profile=profile(capacities);
  return f;
}
function request(overrides={}){
  return parseQuoteAndTechCardInput(input({vehicle:{displayName:'TEST CAR',aggregateCode:'TEST-9',snapshot:{make:'TEST',model:'CAR',year:2020}},service:{type:'automatic_transmission',name:'Замена ATF',aggregate:'TEST-9',filterAccess:'pan_service',materialsOwner:'service'},selectedProducts:[],requestedProcedures:['partial','filter_service'],...overrides}));
}
const verified=value=>runWithRequestTenant(tenant,()=>verifiedLocalTechnicalInput(value,'org-a'));
const lookup=(args,context=ctx)=>runWithRequestTenant(tenant,()=>executeAssistantTool('lookup_technical_data',args,context));

await test('both service capacities survive profile → plan independently',async()=>{
  setup();const v=await verified(request());const plan=createQuoteAndTechCardPlan(v.input,{},v.facts);
  assert.deepEqual(plan.options.map(o=>[o.code,o.technicalQuantityLiters,o.billableQuantityLiters,o.blocker]),[['partial',4,4,null],['filter_service',7,7,null]]);
});
await test('a WITH_FILTER source never verifies drain-and-fill and a dry fill never verifies service',async()=>{
  setup([{nominalLiters:7,serviceContext:'WITH_FILTER'},{nominalLiters:10,serviceContext:'DRY_FILL'}]);
  const v=await verified(request());const plan=createQuoteAndTechCardPlan(v.input,{},v.facts);
  assert.equal(plan.options[0].technicalQuantityLiters,null);assert.equal(plan.options[0].billableQuantityLiters,null);
  assert.equal(plan.options[1].technicalQuantityLiters,7);
  assert.equal(v.facts.filter(f=>f.field==='capacity').length,1);
});
await test('conflicting reviewed capacities are not resolved by row order',async()=>{
  setup([{nominalLiters:7,serviceContext:'WITH_FILTER'},{nominalLiters:8,serviceContext:'WITH_FILTER'}]);
  const v=await verified(request());assert.equal(v.facts.some(f=>f.field==='capacity'),false);
});
await test('canonical reviewed requirements replace model explanations and guessed quantities',async()=>{
  setup();const value=request();value.service.requiredFluidSpec='TEST-ATF (explanatory product names)';value.service.partialTechnicalQuantityLiters=99;
  const v=await verified(value);assert.equal(v.input.service.requiredFluidSpec,'TEST-ATF');assert.equal(v.input.service.partialTechnicalQuantityLiters,4);
  assert.ok(v.facts.some(f=>f.field==='specification'&&f.value==='TEST-ATF'));
});
await test('staged, ambiguous and conflicting-aggregate sources never become verified',async()=>{
  for(const kind of ['staged','ambiguous','aggregate']){
    const f=setup();const value=request();
    if(kind==='staged')f.profile.status='staged_preview';
    if(kind==='ambiguous')f.mann.status='unresolved';
    if(kind==='aggregate')value.vehicle.aggregateCode='OTHER-9';
    assert.equal((await verified(value)).facts.length,0);
  }
});
await test('nested vehicle and an active component profile supply typed requirements without web calls',async()=>{
  const f=setup();let searches=0;
  const result=await lookup({vehicle:{displayName:'TEST CAR',snapshot:{make:'TEST',model:'CAR',year:2020}},serviceType:'atf',procedure:'filter_service',missingFields:['specification','capacity']},{...ctx,technicalLookup:async()=>{searches++;throw Error('unexpected search');}});
  assert.equal(searches,0);assert.deepEqual(result.result.missingFields,[]);
  assert.equal(result.result.requirements.filterServiceTechnicalQuantityLiters,7);
  assert.equal(result.result.requirements.aggregate,'TEST-9');
  assert.equal(f.mannVehicles[0].makeRaw,'TEST');
});
await test('TOTAL does not suppress the missing partial-capacity search; duplicate lookups share it',async()=>{
  setup([{nominalLiters:10,serviceContext:'TOTAL'}]);let searches=0;
  const args={vehicle:{make:'TEST',model:'CAR'},serviceType:'automatic_transmission',procedure:'partial',missingFields:['capacity','specification']};
  const context={...ctx,technicalLookup:async request=>{searches++;assert.deepEqual(request.missingFields,['capacity']);return {result:{status:'needs_verification',findings:'No applicable service volume'},sources:[]};}};
  await runWithRequestTenant(tenant,()=>withAssistantExecution(2000,undefined,async()=>{await executeAssistantTool('lookup_technical_data',args,context);await executeAssistantTool('lookup_technical_data',{...args,missingFields:['specification','capacity']},context);}));
  assert.equal(searches,1);
});
await test('detailed technical questions survive validation and reach research without truncation',async()=>{
  setup();
  const question='OEM articles and exact quantities of pan integrated filter, pan gasket if separate, pan bolts and quick-coupling/drain level seal';
  let received;
  const context={...ctx,technicalLookup:async request=>{received=request;return {result:{status:'needs_verification'},sources:[]};}};
  await lookup({vehicle:{make:'TEST',model:'CAR'},serviceType:'automatic_transmission',procedure:'filter_service',missingFields:[question]},context);
  assert.deepEqual(received.missingFields,[question]);
  await assert.rejects(()=>lookup({vehicle:{},missingFields:['x'.repeat(501)]},context),error=>error.code==='TOOL_SCHEMA_INVALID');
});
await test('both requested procedures require their own capacity, including the legacy comma form',async()=>{
  for(const procedureArgs of [{procedure:'partial, filter_service'},{procedures:['partial','filter_service']}]){
    setup([{nominalLiters:7,serviceContext:'WITH_FILTER'}]);let received;
    const context={...ctx,technicalLookup:async request=>{received=request;return {result:{status:'needs_verification'},sources:[]};}};
    await lookup({vehicle:{make:'TEST',model:'CAR'},serviceType:'automatic_transmission',...procedureArgs,missingFields:['capacity']},context);
    assert.deepEqual(received.procedures,['filter_service','partial']);
    assert.deepEqual(received.missingFields,['capacity']);
  }
});
await test('real runner prices a complete filter service from the reviewed source and frozen branch catalog',async()=>{
  const f=setup();
  f.tables.localProduct=[product('oil',{name:'Fixture ATF на розлив, 1 л',uomName:'л',packageVolume:'1 л',salePriceCents:100000,atf:'TEST-ATF',oemAtf:null,searchText:'TEST-ATF'}),product('filter',{name:'Fixture service filter',article:'TEST-FILTER',uomName:'шт',packageVolume:null,salePriceCents:200000,atf:null,oem:null,sae:null,searchText:'filter'})];
  f.tables.aIAssistantLaborPricingRule.push({...f.tables.aIAssistantLaborPricingRule[1],id:'pan-rule',transmissionConfiguration:'pan_and_filter',laborPriceCents:600000});
  const value=request({requestedProcedures:['filter_service'],selectedProducts:[{productId:'filter',quantity:1,role:'external_filter'}]});
  value.service.requiredFluidSpec='TEST-ATF (explanatory product names)';
  f.responses=[call('build_quote_and_tech_card',{input:value})];
  await run('Рассчитай сервис АКПП TEST CAR с поддоном и фильтром');
  const result=artifact(f);const option=result.quoteSet.options[0];
  assert.equal(option.technicalQuantityLiters,7);assert.equal(option.totalCents,1500000,JSON.stringify(option));
  assert.equal(result.customerMessage.status,'ready',result.customerMessage.text);
  assert.equal(option.lines.find(row=>row.role==='fluid').quantity,7);
  assert.equal(option.lines.find(row=>row.role==='labor').totalCents,600000);
});
await test('partial without pan uses its own tariff even when the vehicle supports pan service',async()=>{
  const f=setup();
  f.tables.localProduct=[product('oil',{name:'Fixture ATF на розлив, 1 л',uomName:'л',packageVolume:'1 л',salePriceCents:100000,atf:'TEST-ATF',oemAtf:null,searchText:'TEST-ATF'})];
  f.tables.aIAssistantLaborPricingRule[1].transmissionConfiguration='no_pan';
  f.tables.aIAssistantLaborPricingRule.push({...f.tables.aIAssistantLaborPricingRule[1],id:'pan-rule',transmissionConfiguration:'pan_and_filter',laborPriceCents:600000});
  const value=request({requestedProcedures:['partial','filter_service']});
  value.service.transmissionConfiguration='pan_and_filter';
  f.responses=[call('build_quote_and_tech_card',{input:value})];
  await run('Рассчитай частичную замену ATF без снятия поддона TEST CAR');
  const option=artifact(f).quoteSet.options[0];
  assert.equal(option.servicePackage.panRemoval,false);
  assert.equal(option.lines.find(row=>row.role==='labor').totalCents,400000);
});
console.log(`Service capacity regression: ${count} scenarios passed.`);
