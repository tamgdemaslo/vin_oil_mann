import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {mannTechnicalContextFromVehicle:context}=await jiti.import('../src/lib/mann-technical-request-context.ts');
const {toVehicle}=await jiti.import('../src/lib/vehicle-identity.ts');
const {mannTechnicalScopeMatches:matches}=await jiti.import('../src/lib/mann-technical-applicability.ts');
const vehicle=toVehicle({Brand:'Kia',Model:'Sportage',EngineCode:'RF',Year:2000,Market:'Russia'},'tronk_vindecode');
const details={productionMonth:'2000-03',transmissionGearCount:5,transmissionModel:'test',confirmedEquipment:[]};
const actual=JSON.parse(JSON.stringify(context(vehicle,details)));
assert.equal(actual.confirmedMarket,'RU');assert.equal(actual.engineCode,'RF');
for(const [key,value] of Object.entries(details))assert.deepEqual(actual[key],value);
assert.equal(matches({requiredMarket:'RU',matchedEngineScope:['RF']},actual),true);
for(const input of [{Market:'RU',market:'DE'},{Market:'Europe / Russia'},{CountryOfOrigin:'RU'},{}]){
  const next=toVehicle(input,'tronk_vindecode');
  const nextContext=JSON.parse(JSON.stringify(context(next)));
  assert.equal('confirmedMarket' in nextContext,false);
  assert.equal(matches({requiredMarket:'RU'},nextContext),false);
}
assert.equal(context({...vehicle,marketEvidence:undefined}).confirmedMarket,undefined);
assert.equal(context({...vehicle,marketEvidence:{values:[],confirmedMarket:'RU'}}).confirmedMarket,undefined);
assert.equal(context({...vehicle,marketEvidence:{values:['DE'],confirmedMarket:'RU'}}).confirmedMarket,undefined);
assert.equal(context({}, {...details,confirmedMarket:'RU',engineCode:'RF'}).confirmedMarket,undefined);
assert.equal(context({}, {...details,confirmedMarket:'RU',engineCode:'RF'}).engineCode,undefined);
assert.equal(context(vehicle).productionMonth,undefined);
for(const [market,label] of Object.entries({RU:'Russia',JP:'Japan',US:'USA',KR:'South Korea',AE:'UAE',EU:'Europe',SOUTHEAST_ASIA:'Ю-В Азия'})){
 const decoded=toVehicle({Brand:'Toyota',Model:'Test',EngineCode:'RF',Market:label},'tronk_vindecode');
 const serialized=JSON.parse(JSON.stringify(context(decoded,details)));
 assert.equal(serialized.confirmedMarket,market);
 for(const requiredMarket of ['RU','JP','US','KR','AE','EU','SOUTHEAST_ASIA'])assert.equal(matches({requiredMarket},serialized),market===requiredMarket);
 assert.equal(context({...decoded,marketEvidence:undefined}).confirmedMarket,undefined);
 assert.equal(context({...decoded,marketEvidence:{values:['UNKNOWN'],confirmedMarket:market}}).confirmedMarket,undefined);
 assert.equal(context(toVehicle({CountryOfOrigin:label,SteeringPosition:'RHD'},'tronk_vindecode')).confirmedMarket,undefined);
 const next=toVehicle({},'tronk_vindecode');assert.equal(context(next).confirmedMarket,undefined);
}
const component=await readFile(new URL('../src/components/shipment/VehicleLookupPanel.tsx',import.meta.url),'utf8');
assert.match(component,/vehicleContext: mannTechnicalContextFromVehicle\(vehicle, details\)/);
console.log('VIN provider → per-vehicle request serialization → market/engine scope tests passed');
