import assert from 'node:assert/strict';
import {volvoComponentEngineList as parse} from './lib/mann-volvo-component-engine-list.mjs';
const base='МАСЛО в АКПП-6\nМодель: TF-80SC, TF-80SD\n* используется в автомобилях с двс:\n- 2.0 D3 (D5204T2) / 163 л.с.\n- 2.0 D3 (D5204T3) 163 л.с.';
assert.deepEqual(parse(base).branches.map(b=>[b.engineCode,b.powerHp]),[['D5204T2',163],['D5204T3',163]]);
for(const text of [base+' AWD',base+'\nне для России',base+'\n- 2.0 D3 (D5204T2) 163 л.с.',base.replace('D5204T2','D5204'),base.replace('163 л.с.','163/190 л.с.')])assert.equal(parse(text).status,'REVIEW');
assert.equal(parse('МАСЛО в АКПП-6\nМодель: TF-80SC').status,'ABSENT');
assert.equal(parse(base.replace('D5204T2)','D5204T2 )')).status,'EXPLICIT');
console.log('Volvo complete component-engine list tests passed');
