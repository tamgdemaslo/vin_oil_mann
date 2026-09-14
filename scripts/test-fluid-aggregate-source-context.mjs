import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const {extractFluidAggregateSourceContext:extract}=await createJiti(import.meta.url).import('../src/lib/fluid-aggregate-source-context.ts');
for(const [label,system,circuit] of [
  ['МАСЛО в ГУР','POWER_STEERING','HYDRAULIC_STEERING'],
  ['МАСЛО в РАЗДАТОЧНУЮ КОРОБКУ','TRANSFER_CASE','TRANSFER_CASE'],
  ['МАСЛО в ПЕРЕДНИЙ РЕДУКТОР','FRONT_DIFFERENTIAL','FRONT_DIFFERENTIAL'],
  ['МАСЛО в ЗАДНЕМ РЕДУКТОРЕ','REAR_DIFFERENTIAL','REAR_DIFFERENTIAL'],
  ['МАСЛО в УГЛОВОЙ РЕДУКТОР','DIFFERENTIAL_GENERIC','ANGLE_GEAR'],
  ['МАСЛО в МУФТУ ПОЛНОГО ПРИВОДА','AWD_COUPLING','AWD_COUPLING'],
]){const r=extract(label,null);assert.equal(r.systemCode,system);assert.equal(r.circuit,circuit);assert.deepEqual(r.issues,[]);assert.equal(r.equipmentConfirmationRequired,true);}
for(const label of ['ЭЛЕКТРОУСИЛИТЕЛЬ РУЛЯ','ЭЛЕКТРОПРИВОД РУЛЯ']){
  const r=extract(label,null);assert.equal(r.fluidRequired,false);assert.equal(r.equipmentConfirmationRequired,false);
}
assert.equal(extract('МАСЛО в ЭЛЕКТРОГИДРОУСИЛИТЕЛЬ',null).fluidRequired,null,'Do not confuse electrohydraulic with electric');
const transfer=extract('МАСЛО в РАЗДАТОЧНУЮ КОРОБКУ от АКПП',null);
assert.equal(transfer.systemCode,'TRANSFER_CASE');assert.equal(transfer.attachedTransmissionType,'automatic');
const diff=extract('МАСЛО в ДИФФЕРЕНЦИАЛ ВАРИАТОРА',null);
assert.equal(diff.systemCode,'DIFFERENTIAL_GENERIC');assert.equal(diff.attachedTransmissionType,'cvt');
assert.ok(diff.issues.includes('DIFFERENTIAL_LOCATION_UNCONFIRMED'));
for(const drive of ['2WD','4WD'])assert.equal(extract(`МАСЛО в ЗАДНИЙ РЕДУКТОР (для ${drive})`,'-').requiredDrive,drive);
for(const label of ['МАСЛО в ЗАДНИЙ РЕДУКТОР (для 2WD и 4WD)','МАСЛО в ЗАДНИЙ РЕДУКТОР *','МАСЛО в ЗАДНИЙ РЕДУКТОР ДЛЯ ГИБРИДОВ'])assert.ok(extract(label,null).issues.includes('UNPARSED_LABEL_CONDITIONS'));
assert.ok(extract('МАСЛО в ГУР','до 10.2009').issues.includes('COMPONENT_OR_CONDITIONS_REQUIRE_REVIEW'));
assert.equal(extract('МАСЛО в ГУР Модели: Крышка жидкость АКПП',null).systemCode,'POWER_STEERING');
assert.equal(extract('МАСЛО в АКПП с раздаточной коробкой',null).systemCode,null);
console.log('Aggregate destination, separate circuit, equipment presence and literal drive tests passed');
