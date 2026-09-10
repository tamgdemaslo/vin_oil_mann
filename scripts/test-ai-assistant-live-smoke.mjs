#!/usr/bin/env node
// Explicit opt-in only. Real model + frozen catalog/integrations/in-memory DB.
if (!process.argv.includes('--approved-budget-500-rub')) throw new Error('Explicit live budget flag required');
process.loadEnvFile('.env.local');
process.env.TGM_AI_LIVE_SMOKE='1';
const {reset,run,artifact}=await import('./fixtures/ai-assistant/harness.mjs');
const f=reset(), started=Date.now();
try {
 await run('Подготовь условную смету замены масла двигателя учебного TEST CAR 2020: требование TEST-SPEC 123, расчётный расход 5 л. Это синтетическая проверка расчётчика, технические факты не подтверждены. Масло сервиса, товар oil: Valvoline SynPower 5W-30 в канистре 5 л за 3000 рублей. Только предварительная смета; техкарта требует проверки.');
 const a=artifact(f),o=a?.quoteSet?.options[0];
 console.log(JSON.stringify({asOf:new Date().toISOString(),scope:'live model / frozen integrations / memory database',durationMs:Date.now()-started,modelCalls:f.modelCalls.length,usage:f.liveUsage??[],quoteAvailable:Boolean(o),totalCents:o?.totalCents??null,saleUnits:o?.lines?.find(x=>x.role==='fluid')?.quantity??null,executionStatus:a?.techCard?.executionStatus??null}));
} catch(error) {
 // Provider errors can contain credentials/request headers; publish only safe codes.
 console.log(JSON.stringify({asOf:new Date().toISOString(),scope:'live model / frozen integrations / memory database',success:false,durationMs:Date.now()-started,modelCalls:f.modelCalls.length,status:error.status??null,code:/^LIVE_BUDGET_[A-Z_]+$/.test(error.message??'')?error.message:(error.code??error.name??'ERROR'),tools:(f.tables.aIAssistantToolCall??[]).map(t=>({tool:t.toolName,status:t.status,error:t.errorMessage?.startsWith('$')?t.errorMessage:null})),reservedUsd:f.modelCalls.reduce((sum,r)=>sum+r.reservedUsd,0),usage:f.liveUsage??[]}));
 process.exitCode=1;
}
