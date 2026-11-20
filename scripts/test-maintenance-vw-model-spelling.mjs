import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
import {resolve} from 'node:path';
const j=createJiti(import.meta.url,{alias:{'@':resolve('src'),'@/lib/db':resolve('scripts/fixtures/mann-fluid-research-mocks.mjs')}});
const{normalizeVehicleModel}=await j.import('../src/lib/vehicle-normalization.ts');
const{normalizeDecodedVehicleForTest,rankMannCandidatesForTest,canAutomaticallySelectMann,MANN_MIN_PRESENTABLE_SCORE}=await j.import('../src/lib/mann-vehicle-resolver.ts');
assert.equal(normalizeVehicleModel('ТУАРЕГ','VW').canonical,'TOUAREG');
assert.equal(normalizeVehicleModel('Tuareg','Volkswagen').canonical,'TOUAREG');
assert.equal(normalizeVehicleModel('Touareg','VOLKSWAGEN').canonical,'TOUAREG');
assert.equal(normalizeVehicleModel('TUAREG','OTHER').canonical,'TUAREG','do not create a cross-brand alias');
assert.equal(normalizeVehicleModel('TUAREGX','VW').canonical,'TUAREGX','do not use a substring replacement');
const source={makeRaw:'VW',modelRaw:'ТУАРЕГ',confidence:'high',sourceMethods:['manual'],rawResultIds:[],vinStatus:'unknown'};
const normalized=normalizeDecodedVehicleForTest(source);
assert.equal(normalized.baseModel,'TOUAREG');assert.equal(normalized.year,undefined);assert.equal(normalized.exactEngineCode,undefined);assert.deepEqual(normalized.bodyCodes,[]);
// Actual row identity from the read-only MANN snapshot: spelling must permit
// family candidates without pretending that a sparse passport selects a motor.
const row={vehicleVariantKey:'touareg-7l-bac-bpe',make:'VW (VOLKSWAGEN)',makeNormalized:'VW (VOLKSWAGEN)',model:'Touareg I(7L)',modelNormalized:'TOUAREG I 7L',modelYears:'02-10',vehicleText:'2.5TDI',effectiveVehicleText:'2.5TDI',engineCode:'BAC,BPE',kw:'128',hp:'174',vehicleYears:'05/03-04/10',vehicleYearFrom:2003,vehicleYearTo:2010,condition:null};
const candidates=rankMannCandidatesForTest(normalized,[row]);assert.ok(candidates[0]?.score>=MANN_MIN_PRESENTABLE_SCORE);assert.equal(canAutomaticallySelectMann(source,candidates),false,'a spelling correction cannot supply an exact vehicle or powertrain');
console.log('PASS exact Volkswagen Cyrillic spelling gives MANN family candidates without inventing modification or enabling auto-selection');
