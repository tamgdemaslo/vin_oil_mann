#!/usr/bin/env node
// The real runner with reviewed synthetic technical data and frozen providers.
// A planned amount is not a measurement; sealed units may never be fractional.
import assert from 'node:assert/strict';
import {reset,input,product,call,run,artifact,jiti} from './fixtures/ai-assistant/harness.mjs';
const {buildQuoteAndTechCardCustomerMessage:format,buildQuoteAndTechCardBundleCustomerMessage:bundle}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/quote-and-tech-card.ts');
const {normalizeMannArticle}=await jiti.import(process.cwd()+'/src/lib/mann-catalog.ts');
const {quantityForLiters}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/material-selection.ts');
const cases=[
  {name:'bulk',uom:'л',pack:'208 л',marking:'BULK_OIL_FROM_MARKED_BARREL',units:4.3,purchased:4.3,remainder:0,billing:'actual_consumption'},
  {name:'canister',uom:'шт',pack:'5 л',marking:'PACKAGED_MARKED_GOOD',units:1,purchased:5,remainder:.7,billing:'whole_packages'},
  {name:'bottle',uom:'шт',pack:'1 л',marking:'PACKAGED_MARKED_GOOD',units:5,purchased:5,remainder:.7,billing:'whole_packages'},
  {name:'small bottle',uom:'шт',pack:'500 мл',marking:'NOT_MARKED',units:9,purchased:4.5,remainder:.2,billing:'whole_packages'},
];
for(const c of cases){
  const f=reset();
  // Legacy rounding and minimum settings cannot inflate actual-consumption billing.
  f.rules={literRoundingStep:1,transmissionMinimumBillableLiters:10,totalRoundingCents:1};
  f.tables.localProduct=[
    product('oil',{name:'TEST oil '+c.name,uomName:c.uom,packageVolume:c.pack,markingMode:c.marking,salePriceCents:99000,stockBalances:[{available:c.units}]}),
    product('filter',{name:'TEST filter',article:'TEST-FILTER',sae:null,oem:null,atf:null,packageVolume:null,salePriceCents:50000}),
  ];
  f.mann={status:'resolved',decision:'MATCH',selectedApplication:{variantIds:['reviewed-fixture']},candidates:[],filters:[{filterType:'Oil Filter',mannArticle:'TEST-FILTER',condition:null}],localMatches:[{mannArticleNormalized:normalizeMannArticle('TEST-FILTER'),compatibleProducts:[{id:'filter',name:'TEST filter',price:500,available:10}]}]};
  f.profile={status:'active',items:[{systemCode:'ENGINE_OIL',revisionId:'reviewed-fixture',sourceStatus:'primary_source',requiresReview:false,specifications:['TEST-SPEC 123'],viscosityGrades:[],capacities:[{nominalLiters:4.3,serviceContext:'WITH_FILTER'}],evidence:[{publisher:'Reviewed synthetic OEM source',url:'https://example.test/manual'}]}]};
  f.responses=[call('build_quote_and_tech_card',{input:input({selectedProducts:[],service:{...input().service,standardTechnicalQuantityLiters:4.3,filterAccess:'external_replaceable'}})})];
  await run('Рассчитай замену моторного масла и фильтра с вашими материалами');
  const a=artifact(f),o=a.quoteSet.options[0],line=o.lines.find(l=>l.role==='fluid');
  assert.equal(o.billableQuantityLiters,4.3,c.name);
  assert.equal(a.techCard.selectedMaterial.quantity,4.3,'tech card displays consumption litres, not package count');
  assert.equal(line.quantity,c.units,c.name);
  assert.equal(line.saleQuantity.billingMode,c.billing);
  assert.equal(line.saleQuantity.plannedConsumptionLiters,4.3);
  assert.equal(line.saleQuantity.purchasedVolumeLiters,c.purchased);
  assert.equal(line.saleQuantity.packageRemainderLiters,c.remainder);
  assert.equal(line.totalCents,Math.round(c.units*99000));
  assert.equal(o.totalCents,line.totalCents+50000);
  assert.equal(a.customerMessage.status,'ready',a.customerMessage.text);
  const policy=c.billing==='actual_consumption'?/оплата по фактическому расходу/:/Неиспользованное масло передадим вам/;
  const legacy=structuredClone(a);
  delete legacy.quoteSet.options[0].lines.find(l=>l.role==='fluid').saleQuantity.billingMode;
  assert.match(format(legacy).text,policy,'saved sale units support quotes created before billingMode');
  for(const mode of ['detailed_with_price','short_with_price','short_without_price','only_final_price','recommendation']){
    for(const message of [format(a,mode),bundle({vehicle:a.vehicle,results:[a]},mode)]){
      assert.equal(message.status,'ready');assert.match(message.text,policy,mode);
      if(['short_without_price','recommendation'].includes(mode))assert.doesNotMatch(message.text,/₽/);
      else if(c.billing==='actual_consumption')assert.match(message.text,/ориентировочно/iu,mode);
      if(c.billing==='whole_packages'&&mode!=='only_final_price')assert.match(message.text,/к покупке/);
    }
  }
  const before={model:f.modelCalls.length,provider:f.providerCalls,mann:f.mannCalls};
  await run('Без цены');
  assert.match(f.tables.aIAssistantMessage.at(-1).content,policy);
  assert.doesNotMatch(f.tables.aIAssistantMessage.at(-1).content,/₽/);
  assert.deepEqual({model:f.modelCalls.length,provider:f.providerCalls,mann:f.mannCalls},before,'saved quote formatting needs no paid research');
  console.log('PASS '+c.name+': preserved 4.3 L, exact stock and sale units, correct billing in all customer modes');
}
for(const packaging of [
  {uomName:'шт',packageVolume:null,markingMode:'NOT_MARKED'},
  {uomName:'л',packageVolume:'5 л',markingMode:'PACKAGED_MARKED_GOOD'},
  {uomName:'шт',packageVolume:'208 л',markingMode:'BULK_OIL_FROM_MARKED_BARREL'},
])assert.equal(quantityForLiters(packaging,4.3).quantity,null,'unknown/contradictory units cannot create a price');
console.log('PASS unknown or contradictory packaging does not become a one-litre sale unit');
