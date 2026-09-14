import assert from 'node:assert/strict';
import {explicitGearboxList as parse} from './lib/mann-explicit-gearbox-list.mjs';
assert.deepEqual(parse('- 716.605 - 716.628 - 716.631'),['716.605','716.628','716.631']);
assert.deepEqual(parse(' — 725.031\n— 725.034 '),['725.031','725.034']);
for(const input of [null,undefined,'','722.904','- 722.904','- 725.0 - 725.031',
 '- 722.904 - 722.904','- 722.904 до с/н 2834526 - 722.905',
 '- 722.904 - 722.905 после 21.06.2010','725.031 / W9S700',
 '- 722.965 (W7X550) - 722.966 (W7X700)','722.673, 722.674',
 '- 722.904 - 722.905 *','-722.904 -722.905','- 722.904 - 722.905\nдругое условие'])assert.equal(parse(input),null,String(input));
console.log('Explicit gearbox list: positive cases and condition-preservation negatives passed');
