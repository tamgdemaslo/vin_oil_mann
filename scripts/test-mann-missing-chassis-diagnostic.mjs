import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
import {resolve} from 'node:path';
const j=createJiti(import.meta.url,{alias:{'@':resolve(import.meta.dirname,'../src')}});
const {matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const source={id:'diagnostic-only',make:'SUZUKI',makeNormalized:'SUZUKI',model:'SX4',generation:'I',bodyCodesJson:[],yearFrom:2006,yearTo:2015,engineCodesJson:['M16A'],engineCodeNormalized:'M16A',engineVolumeCc:1600,powerHp:112,fuelType:'Бензин',systemCode:'ENGINE_OIL',systemNameRaw:'Масло в двигатель',fillVolumeText:'4.0 л.',specificationText:'API SL',specificationsJson:[{type:'API',value:'API SL'}]};
const row={vehicleVariantKey:'diagnostic-sx4',make:'SUZUKI',makeNormalized:'SUZUKI',model:'SX4',modelNormalized:'SX4',vehicleText:'1.6 VVT',effectiveVehicleText:'1.6 VVT',engineCode:'M16A',engineCodeNormalized:'M16A',kw:'82',hp:'112',vehicleYears:'01/06-12/15',vehicleYearFrom:2006,vehicleYearTo:2015,condition:null};
const phrase='не подтверждено указанное источником поколение или точный код кузова; совпадения двигателя и годов недостаточно';
for(const s of [source,{...source,generation:null,bodyCodesJson:['GY']}]){
 const result=match(s,[row]);assert.equal(result.targets.length,0);assert.equal(result.topCandidates[0].eligible,false);assert.ok(result.topCandidates[0].reviewBlockers.includes(phrase));
}
const matched=match(source,[{...row,model:'SX4 I',modelNormalized:'SX4 I'}]);
assert.ok(!matched.topCandidates[0].reviewBlockers.includes(phrase));assert.equal(matched.targets.length,1);
const unspecified=match({...source,generation:null},[row]);assert.ok(!unspecified.topCandidates[0].reviewBlockers.includes(phrase));assert.equal(unspecified.targets.length,1);
console.log('PASS: existing generation/body gate is explained; dates/engine never substitute; matching and unspecified chassis remain eligible.');
