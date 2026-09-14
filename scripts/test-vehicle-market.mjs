import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {resolveVehicleMarket:resolve,mergeVehicleMarketEvidence:merge}=await jiti.import('../src/lib/vehicle-market.ts');
for(const value of ['RU',' RUS ','Russia','Россия','РФ','Российская Федерация'])assert.equal(resolve([value]).confirmedMarket,'RU');
for(const value of [undefined,null,'','Europe / Russia','CIS','СНГ','RU,DE','Российская сборка','не Россия'])assert.equal(resolve([value]).confirmedMarket,undefined);
assert.equal(resolve(['RU','Russia']).confirmedMarket,'RU');
assert.equal(resolve(['RU','DE']).confirmedMarket,undefined);
assert.equal(resolve(['RU','UNKNOWN']).confirmedMarket,undefined);
const conflict=merge({market:'RU'},{market:'DE'});
assert.equal(conflict.confirmedMarket,undefined);
assert.deepEqual(conflict.values,['RU','DE']);
assert.equal(merge({market:'RU',marketEvidence:conflict},{market:'Russia'}).confirmedMarket,undefined);
assert.equal(merge({countryOfOrigin:'RU',licensePlate:'A123AA39'}).confirmedMarket,undefined);
assert.equal(merge({marketEvidence:{values:[],confirmedMarket:'RU'}}).confirmedMarket,undefined);
for(const [market,labels] of Object.entries({JP:['JP','JPN','Japan','Япония'],US:['US','USA','United States','США'],KR:['KR','KOR','South Korea','Ю. Корея'],AE:['AE','UAE','ОАЭ'],EU:['EU','Europe','Европа'],SOUTHEAST_ASIA:['SOUTHEAST_ASIA','Southeast Asia','Ю-В Азия']})){
 for(const label of labels)assert.equal(resolve([label]).confirmedMarket,market);
 assert.equal(resolve(labels).confirmedMarket,market);
 assert.equal(resolve([...labels,'UNKNOWN']).confirmedMarket,undefined);
 for(const other of ['RU','JP','US','KR','AE','EU','SOUTHEAST_ASIA'].filter(x=>x!==market))assert.equal(resolve([...labels,other]).confirmedMarket,undefined);
 const conflicting=merge({market:labels[0]},{market:'UNKNOWN'});assert.equal(merge({marketEvidence:conflicting},{market:labels[0]}).confirmedMarket,undefined);
}
for(const value of ['JDM','LHD','RHD','Made in Japan','Korea','North America','GCC','Asia','DE','Germany','US/Canada'])assert.equal(resolve([value]).confirmedMarket,undefined);
assert.equal(resolve(['EU','Germany']).confirmedMarket,undefined);
console.log('Vehicle destination-market evidence tests passed');
