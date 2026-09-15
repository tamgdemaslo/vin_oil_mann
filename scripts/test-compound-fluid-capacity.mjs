import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
import {parseCopy} from './lib/mann-offline-scope.mjs';
const j=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {parseConditionalFluidCapacities:parse,selectConditionalFluidCapacity:select}=await j.import('../src/lib/fluid-capacity-conditions.ts');
const {readMannCapacityBranches:read}=await j.import('../src/lib/mann-capacity-branches.ts');
const source=parseCopy(await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),'vehicle_fluid_requirements').find(s=>s.id==='6ed12cd62693995e504c3303d5d51a4f78ae4bc466af4d6e351d188fcb6aa360');
const parsed=parse(source.fillVolumeText,source.systemCode,source.engineCodesJson);
assert.equal(parsed.status,'structured',parsed.reason);assert.equal(parsed.branches.length,3);
for(const [engineCode,transmissionType,liters] of [['GW4G15K','manual',6.2],['GW4G15K','robot',6.7],['GW4G15K',undefined,null],['GW4G15K','automatic',null],['GW4B15D',undefined,7.6],['WRONG','manual',null],[undefined,'manual',null]]){
 assert.equal(select(parsed.branches,{engineCode,transmissionType})?.capacity.nominalLiters??null,liters);
}
for(const text of ['6 л. для GW4G15K с МКПП 7 л. для GW4G15K','6 л. для GW4G15K 7 л. для GW4G15K с МКПП','6 л. для GW4G15K с МКПП 7 л. для GW4G15K с МКПП','6 л. для GW4G15K с МКПП extra 7 л. для GW4B15D','6 л. для UNKNOWN1 с МКПП 7 л. для GW4B15D','6 л. для GW4G15K с МКПП 7 л. для АКПП'])assert.equal(parse(text,'ENGINE_COOLANT',source.engineCodesJson).status,'review',text);
const scope={engineCodes:source.engineCodesJson,matchedEngineScope:['GW4G15K'],window:{intersection:{from:'2021-06',to:'2021-12'}}};
const branches=parsed.branches.filter(b=>b.condition.kind==='engineTransmission').map(b=>({...b,applicabilityJson:scope,validation:{independentlyValidated:true,hardConflicts:[],reviewBlockers:[]}}));
const technical={fillVolumeText:source.fillVolumeText,capacityBranches:branches};
assert.equal(read(technical,scope,'ENGINE_COOLANT').length,2);
const tampered=structuredClone(technical);tampered.capacityBranches[0].condition.engineCode='WRONG';tampered.capacityBranches[0].condition.transmissionType='automatic';
// Authoritative condition is always reparsed from source, never trusted from stored object.
assert.equal(read(tampered,scope,'ENGINE_COOLANT')[0].condition.engineCode,'GW4G15K');
assert.equal(read(tampered,scope,'ENGINE_COOLANT')[0].condition.transmissionType,'manual');
console.log('Compound engine + gearbox: exact selection, absent context, overlap and unknown clauses checked');
