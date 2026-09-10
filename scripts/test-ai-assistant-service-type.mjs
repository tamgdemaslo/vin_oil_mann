// Frozen reproduction of the engine-oil service.type failure. No live model,
// business database, customer identifiers, or external requests.
import assert from 'node:assert/strict';
import {reset,input,call,run,artifact,jiti,runWithRequestTenant,tenant,ctx,executeAssistantTool} from './fixtures/ai-assistant/harness.mjs';
const {parseQuoteAndTechCardInput,QUOTE_AND_TECH_CARD_SERVICE_TYPES,QUOTE_AND_TECH_CARD_TOOL_PARAMETERS,QUOTE_AND_TECH_CARD_BUNDLE_TOOL_PARAMETERS}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/quote-and-tech-card.ts');
const {assistantSchemaErrorMessage,SERVICE_TYPE_ERROR_MESSAGE}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/tool-arguments.ts');
const {getAssistantThread}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/runner.ts');
const serviceTypeSchema=QUOTE_AND_TECH_CARD_TOOL_PARAMETERS.properties.input.properties.service.properties.type;
assert.deepEqual(serviceTypeSchema.enum,[...QUOTE_AND_TECH_CARD_SERVICE_TYPES]);
assert.deepEqual(QUOTE_AND_TECH_CARD_BUNDLE_TOOL_PARAMETERS.properties.inputs.items.properties.service.properties.type.enum,[...QUOTE_AND_TECH_CARD_SERVICE_TYPES]);
const aliases=['engine_oil','engine_oil_change','engine_oil_replacement','motor_oil_change','motor_oil_replacement','Замена моторного масла','замена масла двигателя','замена масла в двигателе'];
for(const type of aliases){
 const f=reset();
 f.vehicle={makeCanonical:'KIA',modelCanonical:'OPTIMA',engineCode:'G4KH',year:2019};
 f.responses=[call('build_quote_and_tech_card',{input:input({vehicle:{displayName:'KIA Optima 2019',snapshot:{makeCanonical:'KIA',modelCanonical:'OPTIMA',engineCode:'G4KH',year:2019}},service:{...input().service,type}})})];
 await run(`KIA Optima JF 2.0 T-GDI. VIN ${'0'.repeat(17)}. Замена моторного масла.`);
 assert.equal(artifact(f)?.quoteSet.serviceType,'engine_oil',type);
 assert.equal(artifact(f).quoteSet.options[0].totalCents,300000);
 assert.equal(f.tables.aIAssistantToolCall.filter(t=>t.status==='failed').length,0,'known alias needs no repair');
 assert.equal(f.vehicleCalls,1);
 assert.equal(f.responses.length,0);
}
assert.equal(parseQuoteAndTechCardInput(input({service:{...input().service,type:undefined,name:'Замена моторного масла'}})).service.type,'engine_oil');
for(const type of ['engine_oil_pressure_diagnostic','oil','unknown','not_engine_oil','engine_oil_and_atf']) {
 assert.throws(()=>parseQuoteAndTechCardInput(input({service:{...input().service,type}})),e=>e.code==='QUOTE_SERVICE_TYPE_INVALID'&&e.issues[0].received===type);
}
assert.throws(()=>parseQuoteAndTechCardInput(input({service:{name:'Замена жидкости'}})),e=>e.code==='QUOTE_SERVICE_TYPE_INVALID');
let f=reset();
const badInput=input({service:{...input().service,type:'unrecognized_work'}});
await assert.rejects(()=>runWithRequestTenant(tenant,()=>executeAssistantTool('build_quote_and_tech_card',{input:badInput},ctx)),e=>e.code==='QUOTE_SERVICE_TYPE_INVALID');
assert.equal(f.mannCalls,0,'invalid service must fail before catalogue work');
assert.equal(f.providerCalls,0);
assert.equal(f.tables.aIAssistantQuote?.length??0,0);

// One controlled repair receives the exact field, received value and allowed
// values, and produces the original quote without repeating research.
f=reset(); f.responses=[call('build_quote_and_tech_card',{input:badInput}),call('build_quote_and_tech_card',{input:input()})];
await run('Рассчитай замену моторного масла');
assert.equal(artifact(f).quoteSet.options[0].totalCents,300000);
const repair=f.modelCalls.flatMap(c=>Array.isArray(c.body.input)?c.body.input:[]).filter(i=>i.type==='function_call_output').map(i=>JSON.parse(i.output)).find(i=>i.code==='QUOTE_SERVICE_TYPE_INVALID');
assert.equal(repair.repairAllowed,true);
assert.deepEqual(repair.issues[0],{path:'service.type',code:'invalid_value',received:'unrecognized_work',allowed:[...QUOTE_AND_TECH_CARD_SERVICE_TYPES]});
assert.match(repair.instruction,/engine_oil/);
assert.equal(f.mannCalls,1);

// A second invalid attempt stops; neither the trace nor the API error uses a
// raw Zod array or claims that the employee entered an overlong message.
f=reset(); f.responses=[call('build_quote_and_tech_card',{input:badInput}),call('build_quote_and_tech_card',{input:badInput})];
await assert.rejects(()=>run('Рассчитай замену моторного масла'),e=>e.code==='QUOTE_SERVICE_TYPE_INVALID'&&e.message===SERVICE_TYPE_ERROR_MESSAGE);
const failed=f.tables.aIAssistantRun[0];
assert.equal(failed.errorCode,'QUOTE_SERVICE_TYPE_INVALID');
assert.equal(failed.errorMessage,SERVICE_TYPE_ERROR_MESSAGE);
assert.equal(failed.toolSummaryJson.filter(t=>t.code==='QUOTE_SERVICE_TYPE_INVALID').length,2);
assert.equal(f.tables.aIAssistantQuote?.length??0,0);
assert.equal(f.mannCalls,0);
assert.equal(f.modelCalls.length,2);

// Old traces are readable without updating or deleting any historical row.
const legacy=JSON.stringify([{code:'invalid_value',values:[...QUOTE_AND_TECH_CARD_SERVICE_TYPES],path:['service','type'],message:'Invalid input'}],null,2);
assert.equal(assistantSchemaErrorMessage(legacy),SERVICE_TYPE_ERROR_MESSAGE);
assert.equal(assistantSchemaErrorMessage('Provider unavailable'),null);
failed.errorMessage=legacy;
f.tables.aIAssistantToolCall[0].errorMessage=legacy;
const shown=await runWithRequestTenant(tenant,()=>getAssistantThread('thread','org-a'));
assert.equal(shown.latestRun.errorMessage,SERVICE_TYPE_ERROR_MESSAGE);
assert.equal(shown.toolCalls[0].errorMessage,SERVICE_TYPE_ERROR_MESSAGE);
assert.equal(failed.errorMessage,legacy,'rendering must not rewrite history');
assert.equal(f.tables.aIAssistantToolCall[0].errorMessage,legacy);
console.log('Service type replay passed: canonical enum, eight aliases, missing/unknown types, one repair, bounded failure, and legacy trace rendering.');
