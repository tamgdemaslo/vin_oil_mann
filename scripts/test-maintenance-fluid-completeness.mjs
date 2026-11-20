import assert from 'node:assert/strict';import {resolve} from 'node:path';import {createJiti} from 'jiti';
const mock=resolve('scripts/fixtures/mann-fluid-research-mocks.mjs'),j=createJiti(import.meta.url,{alias:{'@':resolve('src'),'@/lib/db':mock,'@/lib/openai-client':mock}});
const {missingMannFluids}=await j.import('../src/lib/mann-fluid-research.ts');
const {hasEngineOilServiceResearchVolume,quoteRequirementChoices,quoteClientText}=await j.import('../src/lib/maintenance-quote.ts');
const profile=(systemCode,text)=>({status:'catalog_preview',transmissionOptions:[],containsCatalogPreview:true,items:[{revisionId:'manual',systemCode,systemLabel:systemCode,specifications:[systemCode==='ENGINE_OIL'?'VW 504.00':'DOT 4'],viscosityGrades:['5W-30'],capacities:[],researchVolumeText:text,requiresReview:true,sourceStatus:'catalog_preview',researchResult:true,evidence:[]}]});
for(const text of ['4 л с фильтром для МКПП; 5 л с фильтром для АКПП','7 л с фильтром; 8 л с фильтром']){
 assert.equal(hasEngineOilServiceResearchVolume(text),false,'unresolved alternative service volumes must not close the engine gap');
 assert.equal(missingMannFluids(profile('ENGINE_OIL',text)).find(g=>g.systemCode==='ENGINE_OIL').volume,true);
 assert.deepEqual(quoteRequirementChoices(profile('ENGINE_OIL',text),null).volumes,[]);
}
for(const text of ['Объём не установлен','нет данных','7,0 л — полный объём с расширительным бачком для МКПП; 8,6 л — полный объём для CVT; не объём частичной замены']){
 assert.equal(missingMannFluids(profile('ENGINE_COOLANT',text)).find(g=>g.systemCode==='ENGINE_COOLANT').volume,true,'unknown/conditional coolant amount remains unresolved');
}
assert.equal(missingMannFluids(profile('ENGINE_COOLANT','7 л')).some(g=>g.systemCode==='ENGINE_COOLANT'),false,'one known source amount is retained');
assert.equal(missingMannFluids(profile('BRAKE_FLUID','1 л')).some(g=>g.systemCode==='BRAKE_FLUID'),false);
assert.equal(hasEngineOilServiceResearchVolume('4,4 л с фильтром'),true);
const oil={id:'oil',name:'Масло',article:'',price:1000,available:10,unit:'л',litresPerUnit:1};
assert.match(quoteClientText('Car','VW 504.00',4.4,[oil],[],{serviceMethodLabel:'Замена с фильтром'}),/Способ обслуживания: Замена с фильтром/);
assert.doesNotMatch(quoteClientText('Car','',0,[],[],{serviceMethodLabel:'Замена с фильтром'}),/Способ обслуживания/);
assert.doesNotMatch(quoteClientText('Car','VW 504.00',4.4,[oil],[]),/Способ обслуживания/);
console.log('PASS conditional/placeholder volumes remain gaps and selected service method is copied only with selected oil');
