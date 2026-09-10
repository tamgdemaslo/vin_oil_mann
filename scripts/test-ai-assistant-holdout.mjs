#!/usr/bin/env node
// Additional, disjoint synthetic control cases. Not a claim of independent
// adjudication, real VIN extraction, catalog coverage or production accuracy.
import assert from 'node:assert/strict';
import {reset,input,product,call,run,artifact,jiti} from './fixtures/ai-assistant/harness.mjs';
const cases = [
 {car:'HOLDOUT A 2017',id:'control-a',spec:'CONTROL-A/1+',volume:3.1,pack:'2.5 л',price:132400,step:1,units:2,purchased:5,total:264800},
 {car:'HOLDOUT B 2023',id:'control-b',spec:'CONTROL-B.2',volume:6.25,pack:'208 л',price:14999,step:.01,uom:'л',marking:'BULK_OIL_FROM_MARKED_BARREL',units:6.3,purchased:6.3,total:94500},
 {car:'HOLDOUT C 2021',id:'control-c',spec:'CONTROL-C/3',volume:4.1,pack:'1 л',price:115500,step:1,units:5,purchased:5,total:577500},
 {car:'HOLDOUT D 2019',id:'control-d',spec:'CONTROL-D+',volume:5.1,pack:'4 л',price:244000,step:1,units:2,purchased:8,total:488000},
];
let passed=0;
for(const c of cases){
 const f=reset();f.rules={literRoundingStep:c.step};f.tables.localProduct=[product(c.id,{name:'Control oil '+c.id,article:c.id,oem:c.spec,atf:c.spec,searchText:c.spec,packageVolume:c.pack,salePriceCents:c.price,uomName:c.uom??'шт',markingMode:c.marking??'NOT_MARKED'})];
 f.responses=[call('build_quote_and_tech_card',{input:input({vehicle:{displayName:c.car,snapshot:{make:'HOLDOUT',model:c.id}},service:{...input().service,requiredFluidSpec:c.spec,standardTechnicalQuantityLiters:c.volume},selectedProducts:[{productId:c.id,quantity:1,role:'fluid'}]})})];
 await run('Рассчитай масло двигателя '+c.car);const a=artifact(f),o=a.quoteSet.options[0],line=o.lines.find(x=>x.role==='fluid');
 assert.equal(o.totalCents,c.total,JSON.stringify(o));assert.equal(line.quantity,c.units);assert.equal(line.saleQuantity.purchasedVolumeLiters,c.purchased);assert.equal(o.lines.reduce((sum,l)=>sum+l.totalCents,0),o.totalCents);assert.equal(a.vehicle.displayName,c.car);assert.equal(a.techCard.executionStatus,'verification_required');
 const before=f.modelCalls.length;await run('Подробно');assert.equal(f.modelCalls.length,before);await run('Без цены');assert.equal(f.modelCalls.length,before);assert.doesNotMatch(f.tables.aIAssistantMessage.at(-1).content,/₽/);
 passed++;
}
const {fluidSpecificationMatches,engineOilSpecificationMatches,quantityForLiters}=await jiti.import(process.cwd()+'/src/lib/ai-assistant/material-selection.ts');
for(const [positive,required] of [['SPEC/1','SPEC1'],['SPEC+','SPEC'],['SPEC-A','SPEC'],['SPEC.01','SPEC.1']])assert.equal(fluidSpecificationMatches({atf:positive,oemAtf:null,searchText:required},required),false);
assert.equal(engineOilSpecificationMatches({oem:'X-1',sae:'0W-20'},'X-1; 5W-30'),false);
assert.equal(engineOilSpecificationMatches({oem:'X-1',searchText:'Не соответствует X-1; применение запрещено'},'X-1'),false);
assert.equal(quantityForLiters({uomName:'л',packageVolume:'208 л',markingMode:'BULK_OIL_FROM_MARKED_BARREL'},5.275).quantity,5.275);
console.log(`Disjoint control replay: ${passed} full runner cases + punctuation/viscosity/fractional-sale checks passed.`);
