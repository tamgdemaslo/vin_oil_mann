import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const j=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {normalizeDecodedVehicleForTest:normalize,evaluateMannCandidate:evaluate,mannMakeFormsForTest:forms}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeVehicleMake}=await j.import('../src/lib/vehicle-normalization.ts');
const pairs=[['FAW','BESTURN / FAW','B50'],['EXEED','EXEED (CHERY)','TXL'],['DAEWOO','CHEVROLET EUROPE / DAEWOO (GM)','Nexia'],['DAEWOO','DAEWOO - FS LUBLIN','Lublin'],['CHEVROLET','CHEVROLET EUROPE / DAEWOO (GM)','Aveo']];
let checks=0;
for(const [make,heading,model]of pairs){
 const vehicle=normalize({makeRaw:make,modelRaw:model,engineCode:'TEST123',confidence:'high',sourceMethods:[],rawResultIds:[]});assert.ok(vehicle);
 const row={vehicleVariantKey:`${make}-${model}`,make:heading,makeNormalized:heading,model,modelNormalized:model,vehicleText:'1.6',effectiveVehicleText:null,engineCode:'TEST123',engineCodeNormalized:'TEST123',kw:null,hp:null,vehicleYears:null,vehicleYearFrom:null,vehicleYearTo:null,condition:null};
 assert.ok(forms(make).includes(heading));assert.ok(evaluate(vehicle,row).candidate);checks+=2;
 for(const wrong of ['HONDA','GREAT WALL','CHERY',...(make==='DAEWOO'?['CHEVROLET']:[])]){
  assert.ok(evaluate(vehicle,{...row,make:wrong,makeNormalized:heading}).rejected,`${make} must reject ${wrong}, even with same model/engine`);checks++;
 }
 if(make!=='CHEVROLET'){
  assert.ok(evaluate(vehicle,{...row,model:'Unrelated cargo vehicle',modelNormalized:'UNRELATED CARGO VEHICLE'}).rejected,'Shared engine must not bridge unrelated compound-heading models');checks++;
 }
}
assert.notEqual(normalizeVehicleMake('EXEED'),normalizeVehicleMake('CHERY'));
assert.notEqual(normalizeVehicleMake('DAEWOO'),normalizeVehicleMake('CHEVROLET'));
assert.deepEqual(forms('TANK'),['TANK']);
assert.ok(!forms('FAW').includes('VOLKSWAGEN'));
for(const make of ['MERCEDES','VOLKSWAGEN','KIA','MINI','DS AUTOMOBILES','CHEVROLET','LAND ROVER','SSANGYONG','GREAT WALL','VOLVO','LADA']){
 for(const heading of forms(make)){assert.equal(normalizeVehicleMake(heading),make,'Existing catalogue forms must retain their original canonical-brand path');checks++;}
}
console.log(JSON.stringify({checks:checks+4,passed:true,publicationAllowed:false}));
