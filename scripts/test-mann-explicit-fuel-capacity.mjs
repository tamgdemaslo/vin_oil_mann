import assert from 'node:assert/strict';
import {explicitFuelCapacities as parse,selectExplicitFuelCapacity as select} from './lib/mann-explicit-fuel-capacity.mjs';
const value='6.6 л. для бензиновых\n7.7 л. для дизельных';
assert.deepEqual(parse(value),[{fuelType:'gasoline',liters:6.6},{fuelType:'diesel',liters:7.7}]);
assert.equal(select(value,'gasoline').liters,6.6);assert.equal(select(value,'diesel').liters,7.7);
assert.equal(select(value,undefined),null);assert.equal(select(value,'hybrid'),null);
for(const text of [value+' при полной замене','6.6 л. для бензиновых 7.7 л. для бензиновых','6.6-7.7 л. для бензиновых 8 л. для дизельных','0 л. для бензиновых 7 л. для дизельных','1.9 л. для 5-цилиндрового двс 1.45 л. для всех остальных'])assert.equal(parse(text),null);
assert.equal(select('7,7 л. для дизельных 6,6 л. для бензиновых','gasoline').liters,6.6);
console.log('Explicit fuel capacity branch tests passed');
