import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { parseConditionalFluidCapacities: parse, selectConditionalFluidCapacity: select } = await jiti.import('../src/lib/fluid-capacity-conditions.ts');
const raw = '6.0 л. для моделей с АКПП 6.2 л. для моделей с МКПП';
const result = parse(raw, 'ENGINE_COOLANT');
assert.equal(result.status, 'structured');
assert.equal(result.sourceText, raw);
assert.equal(result.branches.map(b => b.sourceSegment).join(''), raw);
assert.equal(result.publicationAllowed, false);
assert.equal(select(result.branches, {}), null);
assert.equal(select(result.branches, { transmissionType: 'cvt' }), null);
assert.equal(select(result.branches, { transmissionType: 'automatic' }).capacity.nominalLiters, 6);
assert.equal(select(result.branches, { transmissionType: 'manual' }).capacity.nominalLiters, 6.2);
assert.equal(parse('14.9 л. c АКПП 15.0 л. c МКПП', 'ENGINE_COOLANT').status, 'structured');
assert.equal(parse('6,0 л. сервисный объём с АКПП; 6.2 л. сервисный объём с МКПП', 'ENGINE_COOLANT').branches[0].capacity.serviceContext, 'SERVICE');
const engines = parse('4.3 л. для HR16DE 4.5 л. для MR16DDT', 'ENGINE_OIL', ['HR16DE', 'MR16DDT']);
assert.equal(engines.status, 'structured');
assert.equal(select(engines.branches, { engineCode: 'MR16-DDT' }).capacity.nominalLiters, 4.5);
assert.equal(select(engines.branches, { engineCode: 'HR16' }), null);
const tolerance = parse('5.7 ± 0.1 л. для JL473ZQ9 8.7 л. для JL473ZQ3', 'ENGINE_OIL', ['JL473ZQ9', 'JL473ZQ3']);
assert.equal(tolerance.status, 'structured');
assert.equal(tolerance.branches[0].capacity.toleranceLiters, 0.1);
const range = parse('10.5-11.0 л. для D20DT 8.5 л. для D20DTR', 'ENGINE_COOLANT', ['D20DT', 'D20DTR']);
assert.equal(range.status, 'structured');
assert.equal(range.branches[0].capacity.nominalLiters, null);
assert.equal(range.branches[0].capacity.minLiters, 10.5);
assert.equal(range.branches[0].capacity.maxLiters, 11);
const nbsp = ' 6.0\u00a0л. с АКПП 6.2 л. с МКПП ';
assert.equal(parse(nbsp, 'ENGINE_COOLANT').sourceText, nbsp);
assert.equal(parse(nbsp, 'ENGINE_COOLANT').status, 'structured');
for (const text of [
  '6.0 л. с АКПП 6.2 л. с АКПП',
  'для холодного климата 6.0 л. с АКПП 6.2 л. с МКПП',
  '6.0 л. с АКПП 6.2 л. с МКПП для холодного климата',
  '6.0 л. с АКПП 6.2 л. с МКПП кроме 2015 года',
  '6.0 л. с АКПП 6.2 для МКПП',
  '6.0 л. с АКПП 6.2 л. для HR16DE',
  '9.0 л. с отопителем 8.5 л. без отопителя',
  '4.3 л. для HR16DE 4.5 л. для UNKNOWN',
  '6.0 л. с АКПП 600 л. с МКПП',
]) assert.equal(parse(text, 'ENGINE_COOLANT', ['HR16DE']).status, 'review', text);
assert.equal(parse('4.3 л. для HR16DE 4.5 л. для MR16DDT', 'ENGINE_OIL', ['HR16DE']).status, 'review');
const drive = parse('4.3 л. для 2WD 4.5 л. для 4WD', 'ENGINE_OIL', ['2WD', '4WD']);
assert.equal(drive.status, 'structured');
assert.equal(drive.branches[0].condition.kind, 'drive');
assert.equal(select(drive.branches, { engineCode: '2WD' }), null);
assert.equal(select(drive.branches, { driveMode: 'AWD' }), null, 'AWD must not silently become 4WD');
assert.equal(select(drive.branches, { driveMode: 'FWD' }), null, 'FWD must not silently become 2WD');
assert.equal(select(drive.branches, { driveMode: '4wd' }).capacity.nominalLiters, 4.5);
assert.equal(parse('4.3 л. для 2WD 4.5 л. для 4WD с блокировкой', 'ENGINE_OIL').status, 'review');
assert.equal(parse('9.9 л. для АКПП 9.5 л. для МКПП', 'ENGINE_COOLANT').status, 'structured');
const cvt=parse('5.8 л. с CVT 5.6 л. с МКПП','ENGINE_COOLANT');
assert.equal(cvt.status,'structured');
assert.equal(select(cvt.branches,{transmissionType:'cvt'}).capacity.nominalLiters,5.8);
assert.equal(select(cvt.branches,{transmissionType:'manual'}).capacity.nominalLiters,5.6);
for(const transmissionType of [undefined,'automatic','robot','CVT'])assert.equal(select(cvt.branches,{transmissionType}),null);
for(const text of ['5.8 л. с CVT кроме 2019 года 5.6 л. с МКПП','5.8 л. с CVT/АКПП 5.6 л. с МКПП','5.8 л. с DCT 5.6 л. с МКПП'])assert.equal(parse(text,'ENGINE_COOLANT').status,'review');
console.log('PASS conditional capacity branches, exact selection, missing/wrong selector, shared-condition rejection, source preservation');
