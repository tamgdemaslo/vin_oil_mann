// Frozen routing replay of utterance shapes found in live customer dialogues.
// No real VINs or customer records. Fictional catalog rows reproduce the observed unit shapes.
import assert from 'node:assert/strict';
import {reset,input,product,call,final,run,artifact,assistantIntent,jiti} from './fixtures/ai-assistant/harness.mjs';
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
assert.doesNotMatch(mixedText,/Настроить|тарифное правило/);assert.match(mixedText,/Стоимость этой работы пока не подтверждена/);assert.match(mixedText,/не включена/);
console.log('Customer dialogue replay: routing, follow-ups, changed VIN, no unsolicited quote, 100 ml packaging and customer-safe blockers passed.');
