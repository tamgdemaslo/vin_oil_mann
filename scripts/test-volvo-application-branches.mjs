import assert from 'node:assert/strict';
import {volvoApplicationBranches as parse} from './lib/mann-volvo-application-branches.mjs';
const base='МАСЛО в ДВИГАТЕЛЬ 1.6 D2 / DRIVe\n- 1.6 D2 / DRIVe (D4162T) / 115 л.с. / 2010-2012 / 2WD\nТип топлива: Бензин\nОбъём двигателя: 1.6 л.\nГоды выпуска: 2010-2012';
assert.equal(parse(base).branches[0].driveCondition,'2WD');assert.equal(parse(base).rawFuel,'Тип топлива: Бензин');
for(const bad of [base+'\nКроме Европы',base.replace('2010-2012 /','2012-2010 /'),base.replace(' / 2WD',' / 2WD АКПП'),base.replace('D4162T','D4162'),base.replace('2WD','AWD'),base.replace('115 л.с.','115/116 л.с.')])assert.equal(parse(bad),null);
console.log('Volvo application full-clause parser passed');
