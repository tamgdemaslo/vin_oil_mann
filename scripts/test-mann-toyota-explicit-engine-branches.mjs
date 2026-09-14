import assert from 'node:assert/strict';
import {toyotaExplicitEngineBranches as parse} from './lib/mann-toyota-explicit-engine-branches.mjs';
const list=parse('- 2GR-FKS / 300 л.с. / Россия / 2018-2022 - 2GR-FKS / 301 л.с. / Япония / 2018-2023');
assert.equal(list.length,2);assert.deepEqual(list.map(b=>[b.engineCode,b.powerHp,b.requiredMarket,b.yearTo]),[['2GR-FKS',300,'RU',2022],['2GR-FKS',301,'JP',2023]]);
assert.deepEqual(parse('- 1ZR-FE / 122 л.с. - 1ZR-FAE / 132 л.с.').map(b=>[b.engineCode,b.powerHp,b.requiredMarket]),[['1ZR-FE',122,null],['1ZR-FAE',132,null]]);
for(const text of [null,'','- 2NZ-FE / 87, 88 л.с.','- 2GR-FKS / 300 л.с. / Европа / 2018-2022','- 2GR-FKS / 300 л.с. / Россия / 2022-2018','- 2GR-FKS / 300 л.с. другое условие','- FKS / 300 л.с.','- 1ZR-FE / 122 л.с. - 1ZR-FE / 122 л.с.'])assert.equal(parse(text),null,String(text));
console.log('Toyota source branches: power/market/year associations preserved; mixed or partial text rejected');
