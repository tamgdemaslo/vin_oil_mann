import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url);
const {extractFluidSourceSystemContext:extract}=await jiti.import('../src/lib/fluid-source-system-context.ts');
for(const [name,system,type] of [
  ['МАСЛО в РАЗДАТОЧНУЮ КОРОБКУ от АКПП','TRANSFER_CASE','automatic'],
  ['МАСЛО в ЗАДНИЙ ДИФФЕРЕНЦИАЛ от АКПП','REAR_DIFFERENTIAL','automatic'],
  ['МАСЛО в ПЕРЕДНИЙ ДИФФЕРЕНЦИАЛ от ВАРИАТОРА','FRONT_DIFFERENTIAL','cvt'],
  ['МАСЛО в АКПП-6','AUTOMATIC_TRANSMISSION','automatic'],
  ['МАСЛО в МКПП-5','MANUAL_TRANSMISSION','manual'],
  ['МАСЛО в РОБОТ','ROBOT_TRANSMISSION','robot'],
]){const r=extract(name);assert.equal(r.destinationSystemCode,system);assert.equal(r.transmissionType,type);}
for(const count of [4,5,6,7,8,9,10])assert.equal(extract(`МАСЛО в АКПП-${count}`,'-').transmissionGearCount,count);
assert.equal(extract('МАСЛО в АКПП','6AT').transmissionGearCount,6);
assert.equal(extract('МАСЛО в АКПП','A6GF1').transmissionGearCount,null);
assert.equal(extract('МАСЛО в АКПП-6','4AT').transmissionGearCount,null);
assert.ok(extract('МАСЛО в МКПП-6','6AT').issues.includes('TRANSMISSION_TYPE_CONFLICT'));
assert.equal(extract('МАСЛО в АКПП-4/6').transmissionGearCount,null);
assert.equal(extract('МАСЛО в АКПП-60').transmissionGearCount,null);
assert.equal(extract('МАСЛО в АКПП-5 (для 4WD)').hasAdditionalLabelConditions,true);
assert.equal(extract('МАСЛО в АКПП-4 Модели: FN4A-EL * 2002-2005').hasAdditionalLabelConditions,true);
assert.equal(extract('МАСЛО в ДВИГАТЕЛЬ, для моделей с АКПП-6').transmissionGearCount,null);
assert.equal(extract('МАСЛО в АКПП с раздаточной коробкой').destinationSystemCode,null);
for(const label of ['МКПП/АКПП','МКПП / AS-TRONIC','МКПП i-Shift','МАСЛО в АКПП HVT']) {
  assert.equal(extract(label).destinationSystemCode,null,label);
  assert.ok(extract(label).issues.includes('UNPARSED_TRANSMISSION_LABEL'));
}
console.log('Explicit source destination and gear-count extraction tests passed');
for(const label of ['МАСЛО в ДИФФЕРЕНЦИАЛ ВАРИАТОРА','МАСЛО в ДИФФЕРЕНЦИАЛ от АКПП','МАСЛО в ДИФФЕРЕНЦИАЛ АКПП']) {
  const result=extract(label);
  assert.equal(result.destinationSystemCode,null);
  assert.ok(result.issues.includes('UNRESOLVED_DIFFERENTIAL_CIRCUIT'));
  assert.equal(result.hasAdditionalLabelConditions,true);
}
