import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const j=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {capacitySummary,parseCapacities}=await j.import('../src/lib/fluid-catalog.ts');
const cases=[['6.6 л.',null,null],['4.0 л. с фильтром',4,null],['6.0-6.5 л. частичный',null,null],['8.1 л. полный',null,8.1],['8-9 л. полный',null,null],['около 4 л. с фильтром',null,null],['4 л. с фильтром\n5 л. с фильтром',null,null],['4 л. частичный\n8 л. полный',4,8]];
for(const [raw,service,total]of cases){const caps=parseCapacities(raw),before=JSON.stringify(caps),summary=capacitySummary(caps);assert.equal(summary.service,service,raw);assert.equal(summary.total,total,raw);assert.equal(JSON.stringify(caps),before);assert.ok(caps.length);}
const {oilRequirementsFromCatalogMatch:convert}=await j.import('../src/lib/fluid-oil-requirements.ts');
for(const raw of ['6.6 л.','4-5 л. с фильтром','8 л. полный']){
 const result=convert({requirement:{fillVolumeText:raw,serviceVolumeLiters:99,fillVolumeMaxLiters:99,specificationsJson:[],viscosityGradesJson:[],sourceUrl:'https://example.test'},matchedBy:[],score:0});
 assert.equal(result.oil_capacity_liters,undefined);assert.ok(result.oil_capacity_note.includes(raw));
}
console.log(JSON.stringify({passed:true,summaryCases:cases.length,legacyFallbacksRejected:3}));
