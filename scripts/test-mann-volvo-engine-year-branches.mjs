import assert from 'node:assert/strict';
import {volvoEngineYearBranches as parse} from './lib/mann-volvo-engine-year-branches.mjs';
const valid='- B4204T11 / 245 л.с. / 2013-2017 - B4204T15 / 220 л.с. / 2013-2017';
assert.deepEqual(parse(valid).map(({sourcePhrase,...b})=>b),[{engineCode:'B4204T11',powerHp:245,yearFrom:2013,yearTo:2017},{engineCode:'B4204T15',powerHp:220,yearFrom:2013,yearTo:2017}]);
assert.equal(parse('- B6324S / 238 л.с. / 2008-2012')[0].engineCode,'B6324S');
for(const s of [null,'',valid+' для AWD',valid+' - D5244T22 / 220 л.с. / мкпп-6 /',valid+' - B4204T11 / 249 л.с. / 2013-2017','- B4204T11 / 245, 249 л.с. / 2013-2017','- B4204T11 / 245 л.с. / 2017-2013','- B4204 / 245 л.с. / 2013-2017','- B4204T11 / 245 л.с. / 2013-'])assert.equal(parse(s),null);
console.log('Volvo literal engine/power/year branches: positive and rejection tests passed');
