import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
import {resolve} from 'node:path';
const {rowBodyCodes:codes}=await createJiti(import.meta.url,{alias:{'@':resolve(import.meta.dirname,'../src')}}).import('../src/lib/mann-vehicle-resolver.ts');
const row={make:'HYUNDAI',model:'Solaris',vehicleText:'1.4(RB)',effectiveVehicleText:'1.4(RB)'};
assert.deepEqual(codes(row),['RB']);assert.deepEqual(codes({...row,vehicleText:'1.6(RB)',effectiveVehicleText:null}),['RB']);
for(const patch of [{make:'KIA'},{model:'Accent'},{vehicleText:'1.4',effectiveVehicleText:'1.4'},{vehicleText:'1.4(AT)',effectiveVehicleText:'1.4(AT)'},{vehicleText:'1.4(RB) until 2014',effectiveVehicleText:null},{vehicleText:'1.4(RB/RC)',effectiveVehicleText:null}])assert.ok(!codes({...row,...patch}).includes('RB'));
assert.ok(!codes({...row,vehicleText:'1.4(RB)',effectiveVehicleText:null}).includes('I'));
console.log('Solaris literal RB row code accepted; no inferred generation, trim or cross-model alias.');
