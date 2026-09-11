// Frozen routing replay of utterance shapes found in live customer dialogues.
// No real VINs or customer records. Fictional catalog rows reproduce the observed unit shapes.
import assert from 'node:assert/strict';
import {reset,input,product,call,final,run,artifact,assistantIntent,jiti,actor,tenant,runWithRequestTenant,runAssistantThread} from './fixtures/ai-assistant/harness.mjs';
// Deliberately invalid WMI 000: generated test identifiers, never customer VINs.
const syntheticVin = (index) => "0".repeat(14) + String(index).padStart(3, "0");
const {detectClientMessageMode}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/client-message.ts');
const price='Добрый день, в какую цену будет стоить замена моторного масла на Skoda Octavia A8 1.0, 2020? Масло и фильтр ваши. Подготовь ответ клиенту для копирования.';
assert.equal(assistantIntent(price),'new_quote');
assert.equal(detectClientMessageMode(price),null);
assert.equal(assistantIntent('Тогда частичную, фильтр не меняем. Масло ваше. Сколько итого?',true),'edit_quote');
assert.equal(assistantIntent('Сколько будет стоить с вашим маслом?',true),'edit_quote');
let f=reset();f.responses=[call('build_quote_and_tech_card',{input:input()})];
await run(price);assert.ok(artifact(f));assert.ok(f.modelCalls.length>0);
assert.doesNotMatch(f.tables.aIAssistantMessage.at(-1).content,/Сначала выполнить расчёт/);

const technical=`Здравствуйте, а вы адаптацию делаете после замены масла в вариаторе? VIN ${syntheticVin(1)}. Подготовь короткий ответ клиенту.`;
assert.equal(assistantIntent(technical),'technical_question');assert.equal(detectClientMessageMode(technical),null);
f=reset();f.responses=[final('Применимая процедура адаптации требует проверки по коду коробки.')];
await run(technical);assert.equal(artifact(f),undefined);assert.equal(f.tables.aIAssistantQuote?.length??0,0);
const follow='Клиент уточнил: «А если рывков и ошибок нет?» Подготовь ответ клиенту.';
assert.equal(detectClientMessageMode(follow),null);
f.responses=[final('Учтены автомобиль и вопрос из предыдущего сообщения.')];
const before=f.modelCalls.length;await run(follow);assert.equal(f.modelCalls.length,before+1);
const response=f.modelCalls.at(-1).body;
assert.ok(response.previous_response_id || JSON.stringify(response.input).includes(`${syntheticVin(1)}`),'technical follow-up retains vehicle context');
assert.equal(f.tables.aIAssistantQuote?.length??0,0);

f.responses=[final('Новый автомобиль требует отдельной проверки.')];
await run(`Адаптация после замены масла для VIN ${syntheticVin(2)}?`);
assert.equal(f.modelCalls.at(-1).body.previous_response_id,undefined);
assert.doesNotMatch(JSON.stringify(f.modelCalls.at(-1).body.input),new RegExp(syntheticVin(1)));
assert.equal(detectClientMessageMode('Только итоговая цена'),'only_final_price');
assert.equal(detectClientMessageMode('Подробное сообщение для клиента с расчётом'),'detailed_with_price');


// Even an unsolicited model tool call cannot turn a technical question into a quote.
f=reset();f.responses=[call('build_quote_and_tech_card',{input:input()}),final('Для ответа нужна применимая процедура по коду коробки.')];
await run(technical);
assert.equal(artifact(f),undefined);
assert.equal(f.tables.aIAssistantQuote?.length??0,0);
assert.ok(f.modelCalls.some(c=>JSON.stringify(c.body.input).includes('CALCULATION_NOT_REQUESTED')));

// A confident model answer and unrelated web findings are not technical proof.
f=reset();f.responses=[final('Нет, адаптация не обязательна. Выполняем её при необходимости.')];
await run(technical);
assert.match(f.tables.aIAssistantMessage.at(-1).content,/Пока не удалось подтвердить/);
assert.doesNotMatch(f.tables.aIAssistantMessage.at(-1).content,/адаптация не обязательна|Выполняем/);
assert.equal(f.tables.aIAssistantMessage.at(-1).attachmentsJson.kind,'client_message');
f.responses=[final('Нет, не нужна.')];await run('А если рывков и ошибок нет? Подготовь короткий ответ клиенту.');
assert.match(f.tables.aIAssistantMessage.at(-1).content,/Пока не удалось подтвердить/);
assert.equal(f.modelCalls.at(-1).body.previous_response_id,undefined,'follow-up reads guarded visible history, not discarded model prose');
const guardedText=f.tables.aIAssistantMessage.at(-1).content;
const guardedCalls=f.modelCalls.length;await run('Короткое сообщение');
assert.equal(f.modelCalls.length,guardedCalls);
assert.equal(f.tables.aIAssistantMessage.at(-1).content,guardedText,'formatting retains unknown technical requirements');

const {buildTechnicalCustomerAnswer}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/technical-answer.ts');
const verifiedSpec={field:'specification',value:'TEST-SPEC 123',source:'Reviewed primary source',url:'https://example.invalid/source',vehicleVariantKey:'variant-1',aggregate:'E1'};
assert.equal(buildTechnicalCustomerAnswer('Какой допуск?', [verifiedSpec]).status,'verified');
assert.equal(buildTechnicalCustomerAnswer('Обязательна адаптация?', [verifiedSpec]).status,'needs_verification');
assert.equal(buildTechnicalCustomerAnswer('Какой допуск?', [verifiedSpec,{...verifiedSpec,vehicleVariantKey:'variant-2',value:'OTHER-SPEC'}]).status,'needs_verification');

// Empty branch overrides must still permit existing system labour policy.
f=reset();f.tables.aIAssistantLaborPricingRule=[];
f.responses=[call('build_quote_and_tech_card',{input:input()})];await run(price);
assert.equal(artifact(f).quoteSet.options[0].totalCents,300000);
assert.equal(artifact(f).quoteSet.options[0].technicalQuantityLiters,null,'unverified plan volume is not a technical capacity');
assert.equal(artifact(f).quoteSet.options[0].billableQuantityLiters,5);
assert.equal(artifact(f).quoteSet.options[0].quantityTrace.sourceCapacityEvidence,null);
assert.ok(!f.dbCalls.some(c=>c.args.where?.locationId==='attacker-location'));
f=reset();f.tables.aIAssistantLaborPricingRule=[];
f.responses=[call('build_quote_and_tech_card',{input:input({selectedProducts:[],service:{...input().service,materialsOwner:'customer'}})})];
await run('Рассчитай замену моторного масла с материалами клиента');
assert.equal(artifact(f).quoteSet.options[0].totalCents,150000);

const {applyAutomaticTransmissionScenarioDefaults}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/tools.ts');
const transmissionInput={...input(),service:{...input().service,type:'automatic_transmission',filterAccess:'unknown'}};
assert.deepEqual(applyAutomaticTransmissionScenarioDefaults(transmissionInput,'Между 100 и 200 тысячами было две частичные замены. Хочу сначала диагностику, потом по возможности полную замену с фильтром.').requestedProcedures,['machine_filter_service']);
assert.deepEqual(applyAutomaticTransmissionScenarioDefaults(transmissionInput,'Клиент ответил: «Тогда пока частичную замену, фильтр не меняем. Диагностика остаётся».',true).requestedProcedures,['partial']);
f=reset();f.responses=[call('build_quote_and_tech_card',{input:transmissionInput})];
await run('Рассчитай частичную замену АКПП, фильтр не меняем, перед заменой нужна диагностика');
assert.equal(artifact(f).quoteSet.options[0].priceCompleteness,'subtotal');
assert.equal(artifact(f).customerMessage.status,'blocked');
assert.match(artifact(f).customerMessage.text,/Не рассчитана полная стоимость/);

// A 100 ml packaged product must be billed in packages, not in whole litres.
f=reset();f.tables.localProduct=[product('oil',{name:'Test ATF, 100 мл',packageVolume:'100 мл.',uomName:'шт',salePriceCents:25900,stockBalances:[{available:100}]})];
f.responses=[call('build_quote_and_tech_card',{input:input({service:{...input().service,standardTechnicalQuantityLiters:4}})})];
await run('Рассчитай замену масла');
const smallPack=artifact(f).quoteSet.options[0].lines.find(l=>l.role==='fluid');
assert.equal(smallPack.quantity,40);assert.equal(smallPack.totalCents,1036000);assert.equal(smallPack.saleQuantity.purchasedVolumeLiters,4);

// Twenty-nine 100 ml packages cover only 2.9 L, never a four-litre service.
const {selectPreferredLocalFluid}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/material-selection.ts');
assert.equal(selectPreferredLocalFluid([{...product('small',{packageVolume:'100 мл',uomName:'шт',salePriceCents:25900}),availableUnits:29}], 'TEST-SPEC 123',4),null);

const {buildQuoteAndTechCardBundleCustomerMessage}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/quote-and-tech-card.ts');
const priced=artifact(f), blocked=structuredClone(priced);
blocked.techCard.serviceName='Замена масла заднего редуктора';
blocked.quoteSet.options.forEach(o=>{o.status='blocked';o.totalCents=null;o.blockers=[{code:'MISSING_LABOR_RULE',message:'Нет тарифа',requiredToContinue:'Настроить тарифное правило или указать подтверждённую стоимость работы.'}];});
const mixedText=buildQuoteAndTechCardBundleCustomerMessage({vehicle:priced.vehicle,results:[priced,blocked]}).text;
assert.doesNotMatch(mixedText,/Настроить|тарифное правило/);assert.match(mixedText,/Нет тарифа/);assert.doesNotMatch(mixedText,/Добрый день|₽/);

// Render the real customer UI: a null technical volume must not fall back to
// the planned consumption, and a subtotal must not be labelled a final total.
const {createJiti}=await import('jiti');
const {createElement}=await import('react');
const {renderToStaticMarkup}=await import('react-dom/server');
const uiJiti=createJiti(import.meta.url,{alias:{'@':process.cwd()+'/src'},jsx:{runtime:'automatic'}});
const {default:AnswerRenderer}=await uiJiti.import(process.cwd()+'/src/app/ai-assistant/AIAssistantAnswerRenderer.tsx');
const rendered=structuredClone(priced);
rendered.quoteSet.options.forEach(o=>{o.technicalQuantityLiters=null;o.priceCompleteness='subtotal';});
rendered.techCard.procedureVolumes.forEach(o=>{o.technicalQuantityLiters=null;});
rendered.techCard.verifiedFacts=[];
const html=renderToStaticMarkup(createElement(AnswerRenderer,{content:'',status:'completed',quoteAndTechCard:rendered}));
assert.match(html,/Технический объём не подтверждён/);
assert.match(html,/к расчёту 4 л/);
assert.doesNotMatch(html,/Техн\. 4 л|<span>Итого<\/span>/);
assert.match(html,/Известная часть стоимости/);
assert.match(html,/применимость не подтверждена/);
console.log('Customer dialogue replay: routing, follow-ups, changed VIN, no unsolicited quote, 100 ml packaging and customer-safe blockers passed.');

// Replay the reported Optima request with fictional stock and prices. Real
// resolver scoring is covered in test-mann-vehicle-resolver, not mocked here.
const {assistantVehicle, mergeAssistantVehicleSnapshot}=await jiti.import(process.cwd()+"/src/lib/ai-assistant/technical-context.ts");
const optimaSnapshot={makeCanonical:"KIA", modelCanonical:"OPTIMA", modelRaw:"Optima IV(JF)", engineCode:"G4KH", engineSeries:"Theta2", bodyCode:"JF", generationRaw:"IV", powerKw:180, powerHp:245, year:2019};
const merged=mergeAssistantVehicleSnapshot(optimaSnapshot,{makeCanonical:"KIA",modelCanonical:"OPTIMA",engineSeries:null,bodyCode:"",generationRaw:undefined,powerKw:null});
assert.equal(merged.engineSeries,"Theta2");
assert.equal(merged.bodyCode,"JF");
assert.equal(assistantVehicle(merged).modelRaw,"Optima IV(JF)");
assert.equal(assistantVehicle(merged).generationRaw,"IV");
assert.equal(assistantVehicle({...merged,modelRaw:"Rio"}).modelRaw,"OPTIMA","raw label cannot replace the verified model");
const {normalizeMannArticle}=await jiti.import(process.cwd()+"/src/lib/mann-catalog.ts");
const optimaRequirement="SAE 5W-30, ACEA A5 или выше";
f=reset();
f.vehicle={makeCanonical:"KIA",modelCanonical:"OPTIMA",year:2019,engineCode:"G4KH",engineSeries:null,bodyCode:null,powerKw:null,powerHp:null};
f.tables.localProduct=[product("oil",{name:"Fixture engine oil A5/B5 5W-30, 5 л",oem:null,atf:null,acea:"A5/B5",searchText:"fixture engine oil",salePriceCents:300000}),product("wrong-oil",{name:"Fixture C3 5W-30, 5 л",oem:null,atf:null,acea:"C3",searchText:"fixture engine oil",salePriceCents:200000}),product("oil-filter",{name:"Fixture oil filter W 811/80",article:"W81180",sae:null,oem:null,atf:null,acea:null,packageVolume:null,searchText:"filter",salePriceCents:60000})];
f.mann={status:"resolved",decision:"MATCH",selectedApplication:{variantIds:["synthetic-optima-turbo"]},candidates:[],filters:[{filterType:"Oil Filter",mannArticle:"W 811/80",condition:null}],localMatches:[{mannArticleNormalized:normalizeMannArticle("W 811/80"),compatibleProducts:[{id:"oil-filter",name:"Fixture oil filter W 811/80",price:600,available:10}]}]};
f.responses=[call("build_quote_and_tech_card",{input:input({vehicle:{displayName:"KIA Optima 2019",snapshot:optimaSnapshot},selectedProducts:[],service:{...input().service,requiredFluidSpec:optimaRequirement,filterAccess:"external_replaceable"}})})];
await run(`KIA MOTORS Optima IV(JF) · 2.0T-GDI · Theta2 · 180 kW · 245 hp · 09/16 -> VIN ${syntheticVin(3)}. Замена моторного масла, материалы ваши. Подготовь ответ клиенту.`);
const optimaAnswer=artifact(f);
assert.ok(optimaAnswer, JSON.stringify(f.tables.aIAssistantRun));
const optimaOption=optimaAnswer.quoteSet.options[0];
assert.equal(optimaOption.totalCents,360000,JSON.stringify(optimaOption));
assert.match(optimaOption.materialSelectionTrace.compatibleProduct.compatibilityEvidence,/acea: A5\/B5/);
assert.doesNotMatch(optimaOption.materialSelectionTrace.compatibleProduct.compatibilityEvidence,/или выше/);
assert.equal(optimaOption.materialSelectionTrace.oemRequirement.evidence,null,"a product declaration does not prove OEM vehicle applicability");
assert.equal(optimaOption.lines.find(l=>l.role==="fluid").quantity,1);
assert.ok(optimaOption.lines.some(l=>l.productId==="oil-filter"));
assert.ok(!optimaOption.lines.some(l=>l.productId==="wrong-oil"));
assert.equal(optimaOption.technicalQuantityLiters,null,"a usable conditional quote must not confirm an unreviewed capacity");
assert.equal(f.vehicleCalls,1,"exercise server VIN lookup before merging catalogue attributes");
assert.equal(f.mannVehicles[0].engineSeries,"Theta2");
assert.equal(f.mannVehicles[0].powerKw,180);
assert.equal(f.providerCalls,0,"available compatible stock should not fall through to supplier search");
assert.equal(optimaAnswer.customerMessage.status,'blocked');
const optimaModelCalls=f.modelCalls.length;
await run("Короткое сообщение");
assert.equal(f.modelCalls.length,optimaModelCalls);
assert.equal(f.tables.aIAssistantMessage.at(-1).attachmentsJson.kind,'quote_needs_completion');
// API and ILSAC may be stored only in their respective structured columns.
f=reset(); f.tables.localProduct=[product("oil",{oem:null,atf:null,acea:null,apiSpec:"SN",ilsac:"GF-5",searchText:"fixture engine oil"})];
f.responses=[call("build_quote_and_tech_card",{input:input({selectedProducts:[],service:{...input().service,requiredFluidSpec:"SAE 5W-30, API SN, ILSAC GF-5"}})})];
await run("Рассчитай замену моторного масла");
assert.equal(artifact(f).quoteSet.options[0].totalCents,300000);
console.log("Optima replay: composite oil requirements, filter, package quantity, retained vehicle attributes, formatting and API/ILSAC-only discovery passed.");

// Reported incomplete bulk-oil quote is useful to the employee only.
const {buildQuoteAndTechCardCustomerMessage:renderCustomer,parseQuoteAndTechCardArtifact}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/quote-and-tech-card.ts');
f=reset();
f.tables.localProduct=[product('oil',{name:'Fixture A5/B5 5W-30, моторное масло на розлив, 1 л.',uomName:'л',packageVolume:'1 л',markingMode:'BULK_OIL_FROM_MARKED_BARREL',salePriceCents:90000,acea:'A5/B5'})];
f.responses=[call('build_quote_and_tech_card',{input:input({selectedProducts:[],service:{...input().service,requiredFluidSpec:'SAE 5W-30, ACEA A5',filterAccess:'external_replaceable',serviceHardware:[{type:'Прокладка сливной пробки TEST-GASKET',quantity:1,requirement:'mandatory',requiredForQuote:true,evidence:null}]}})})];
await run('Рассчитай замену моторного масла и фильтра с вашими материалами');
const incomplete=artifact(f),incompleteSnapshot=structuredClone(incomplete);
assert.equal(incomplete.quoteSet.options[0].totalCents,450000);
assert.equal(incomplete.quoteSet.options[0].technicalQuantityLiters,null);
assert.equal(incomplete.customerMessage.status,'blocked');
for(const reason of [/полная стоимость/,/масляного фильтра/,/обязательных расходников/,/применимость/,/объём/])assert.match(incomplete.customerMessage.text,reason);
assert.doesNotMatch(incomplete.customerMessage.text,/Добрый день|₽|Подберём удобное время/);
const formattingRequests=['Короткое сообщение','Короткое сообщение для клиента без цены','Подробное сообщение для клиента с расчётом','Только итоговая цена','Добавь рекомендацию к сообщению клиенту'];
const callCounts=()=>({model:f.modelCalls.length,provider:f.providerCalls,mann:f.mannCalls,vehicle:f.vehicleCalls,probes:f.connectionProbes});
const beforeBlockedFormatting=callCounts();
for(const request of formattingRequests){
  const result=await run(request),message=f.tables.aIAssistantMessage.at(-1);
  assert.equal(result.clientMessage,false);
  assert.equal(message.attachmentsJson.kind,'quote_needs_completion');
  assert.match(message.content,/Расчёт сохранён для мастера/);
  assert.doesNotMatch(message.content,/Добрый день|₽|Сначала выполнить расчёт/);
}
assert.deepEqual(callCounts(),beforeBlockedFormatting);
assert.deepEqual(incomplete,incompleteSnapshot);
const selectedIncompleteQuote=f.tables.aIAssistantQuote[0];
await runWithRequestTenant(tenant,()=>runAssistantThread({threadId:'thread',organizationId:'org-a',actor,message:'Только итоговая цена',selectedQuoteId:selectedIncompleteQuote.id}));
assert.equal(f.tables.aIAssistantMessage.at(-1).attachmentsJson.kind,'quote_needs_completion','selecting a saved price must not bypass its source QuoteSet');
assert.deepEqual(callCounts(),beforeBlockedFormatting);
// Old stored ready flags must not bypass the new policy on read or render.
const stale=structuredClone(incomplete);
stale.customerMessage={status:'ready',text:'Добрый день! Стоимость — 4500 ₽.'};
assert.equal(parseQuoteAndTechCardArtifact(stale).customerMessage.status,'blocked');
const staleHtml=renderToStaticMarkup(createElement(AnswerRenderer,{content:'',status:'completed',quoteAndTechCard:stale}));
assert.match(staleHtml,/Известная часть стоимости/);
assert.match(staleHtml,/Подбор и расчёт не завершены/);
assert.doesNotMatch(staleHtml,/Готово для копирования|>Скопировать<|Добрый день/);

// A complete quote with a reviewed active profile and a resolved filter still
// produces usable copy, even while workshop instructions remain incomplete.
async function completeOilFixture(volume=5,bulk=true){
  f=reset();
  f.tables.localProduct=[
    product('oil',bulk?{name:'Fixture 5W-30, моторное масло на розлив, 1 л.',uomName:'л',packageVolume:'1 л',markingMode:'BULK_OIL_FROM_MARKED_BARREL',salePriceCents:90000}:{}),
    product('filter',{name:'Fixture oil filter',article:'TEST-FILTER',sae:null,oem:null,atf:null,packageVolume:null,salePriceCents:50000}),
    product('gasket',{name:'Fixture gasket',article:'TEST-GASKET',sae:null,oem:null,atf:null,packageVolume:null,salePriceCents:10000}),
  ];
  f.mann={status:'resolved',decision:'MATCH',selectedApplication:{variantIds:['reviewed-fixture']},candidates:[],filters:[{filterType:'Oil Filter',mannArticle:'TEST-FILTER',condition:null}],localMatches:[{mannArticleNormalized:normalizeMannArticle('TEST-FILTER'),compatibleProducts:[{id:'filter',name:'Fixture oil filter',price:500,available:10}]}]};
  f.profile={status:'active',items:[{systemCode:'ENGINE_OIL',revisionId:'reviewed-fixture',sourceStatus:'primary_source',requiresReview:false,specifications:['TEST-SPEC 123'],viscosityGrades:[],capacities:[{nominalLiters:volume,serviceContext:'WITH_FILTER'}],evidence:[{publisher:'Reviewed OEM fixture',url:'https://example.test/manual'}]}]};
  f.responses=[call('build_quote_and_tech_card',{input:input({selectedProducts:[],consumables:[{productId:'gasket',quantity:1,role:'hardware'}],service:{...input().service,standardTechnicalQuantityLiters:volume,filterAccess:'external_replaceable',serviceHardware:[{type:'Fixture gasket',quantity:1,requirement:'mandatory',requiredForQuote:true,evidence:null}]}})})];
  await run('Рассчитай замену моторного масла и фильтра с вашими материалами');
  return artifact(f);
}
const complete=await completeOilFixture(),completeSnapshot=structuredClone(complete);
assert.equal(complete.quoteSet.options[0].totalCents,510000);
assert.equal(complete.techCard.status,'partial','missing workshop-only instructions do not withhold a complete price');
assert.equal(complete.customerMessage.status,'ready');
assert.match(complete.customerMessage.text,/на розлив — в расчёте 5 л/);
assert.match(complete.customerMessage.text,/Работа — без доплаты в этом расчёте/);
assert.doesNotMatch(complete.customerMessage.text,/к покупке 5 л|остаток.*0 л|на розлив, 1 л|Работа — 0 ₽|не подтвержд/);
const beforeReadyFormatting=callCounts();
for(const [index,request] of formattingRequests.entries()){
  const result=await run(request),message=f.tables.aIAssistantMessage.at(-1);
  assert.equal(result.clientMessage,true);
  assert.equal(message.attachmentsJson.kind,'client_message');
  if([1,4].includes(index))assert.doesNotMatch(message.content,/₽/);
  else assert.match(message.content,/5[\s\u00a0]?100 ₽/);
}
assert.deepEqual(callCounts(),beforeReadyFormatting);
assert.deepEqual(complete,completeSnapshot);
for(const field of ['specification','capacity']){
  const missing=structuredClone(complete);
  missing.techCard.verifiedFacts=missing.techCard.verifiedFacts.filter(fact=>fact.field!==field);
  assert.equal(renderCustomer(missing).status,'blocked','a bare non-null value is not proof of '+field);
}
const mixed={scenario:'quote_and_tech_card_bundle',status:'partial',vehicle:complete.vehicle,results:[complete,stale],customerMessage:{status:'ready',text:'Добрый день!'},evidence:[]};
const parsedMixed=parseQuoteAndTechCardArtifact(mixed);
assert.equal(parsedMixed.customerMessage.status,'blocked');
assert.equal(parsedMixed.results[0].customerMessage.status,'ready');
assert.equal(parsedMixed.results[1].quoteSet.options[0].totalCents,450000);
assert.equal(parsedMixed.status,'partial');
assert.equal(buildQuoteAndTechCardBundleCustomerMessage(mixed).status,'blocked');

// Exact money and real sealed-package leftovers remain in complete messages.
const paidCopy=structuredClone(complete),paidOption=paidCopy.quoteSet.options[0];
paidOption.lines.find(line=>line.role==='labor').totalCents=12345;
paidOption.totalCents+=12345;
assert.match(renderCustomer(paidCopy).text,/Работа — 123,45 ₽/);
assert.match(renderCustomer(paidCopy).text,/Ориентировочно: 5[\s\u00a0]?223,45 ₽/);
const sealed=await completeOilFixture(6,false);
assert.equal(sealed.quoteSet.options[0].totalCents,660000);
assert.equal(sealed.customerMessage.status,'ready');
for(const copy of [sealed.customerMessage.text,buildQuoteAndTechCardBundleCustomerMessage({vehicle:sealed.vehicle,results:[sealed]}).text]){
  assert.match(copy,/Valvoline SynPower 5W-30, 5 л/);
  assert.match(copy,/к покупке 2 шт \(10 л\); ориентировочный остаток 4 л/);
}
console.log('Customer readiness replay: internal incomplete quotes, guarded saved messages, all five modes, complete reviewed quotes, exact prices and package leftovers passed.');
