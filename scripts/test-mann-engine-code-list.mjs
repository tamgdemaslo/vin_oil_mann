import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {splitMannEngineCodeList:split}=await jiti.import('../src/lib/mann-engine-code-list.ts');
assert.deepEqual(split('M112.946/953'),['M112.946','M112.953']);
assert.deepEqual(split('OM651.911 / 912'),['OM651.911','OM651.912']);
assert.deepEqual(split('M271.950,M271.820/860'),['M271.950','M271.820','M271.860']);
assert.deepEqual(split('OM642.960/642.961'),['OM642.960','642.961']);
for(const value of ['M112/953','M112.946/95','M112.946/953X','M112.946/OM113.981'])assert.deepEqual(split(value),value.split('/'));
assert.deepEqual(split('1AZ-FE/FSE'),['1AZ-FE','1AZ-FSE']);
assert.deepEqual(split('2AZ-FE / FSE'),['2AZ-FE','2AZ-FSE']);
for(const value of ['AZ-FE/FSE','1AZ-FE/2AZ-FSE','1AZ-FE/FSE extra','1AZ-FE/FXE','BSE/BSF'])assert.deepEqual(split(value),value.split('/'));
assert.deepEqual(split('M112.946 AND ALWAYS text/M113.981'),['M112.946 ','M113.981']);
console.log('Strict Mercedes decimal suffix list tests passed');
const {normalizeDecodedVehicleForTest:normalize,evaluateMannCandidate:evaluate}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const row={vehicleVariantKey:'compressed-test',make:'MERCEDES-BENZ',makeNormalized:'MERCEDES-BENZ',model:'C-Class (W203)',vehicleText:'C320',engineCode:'M112.946/953',vehicleYearFrom:2000,vehicleYearTo:2007};
for(const [engineCode,exact] of [['M112.946',true],['M112.953',true],['953',false],['M112.954',false]]){
  const vehicle=normalize({makeRaw:'Mercedes-Benz',modelRaw:'C-Class',bodyCode:'W203',engineCode,year:2003,sourceMethods:['tronk_vindecode'],confidence:'high',rawResultIds:[],vinStatus:'valid'});
  const result=evaluate(vehicle,row);
  assert.equal(result.candidate.matchedFields.includes('точный код двигателя'),exact,engineCode);
}
console.log('Resolver recognizes full expanded code but not bare suffix or neighboring engine');
const toyota={vehicleVariantKey:'az-test',make:'TOYOTA',makeNormalized:'TOYOTA',model:'Avensis Verso',vehicleText:'2.0',engineCode:'1AZ-FE/FSE'};
for(const [engineCode,exact] of [['1AZ-FE',true],['1AZ-FSE',true],['FSE',false],['3S-FSE',false],['2AZ-FSE',false]]){
 const vehicle=normalize({makeRaw:'Toyota',modelRaw:'Avensis Verso',engineCode,sourceMethods:['tronk_vindecode'],confidence:'high',rawResultIds:[],vinStatus:'valid'});
 assert.equal(evaluate(vehicle,toyota).candidate.matchedFields.includes('точный код двигателя'),exact,engineCode);
}
console.log('AZ full codes match; orphan suffix and different engine prefixes do not');
