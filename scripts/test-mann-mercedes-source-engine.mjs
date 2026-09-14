import assert from 'node:assert/strict';
import {mercedesSourceEngineEvidence as extract} from './lib/mann-mercedes-source-engine.mjs';
assert.deepEqual(extract('271.948 (M 271 E 18 ML/1)').map(r=>r.code),['M271.948']);
assert.deepEqual(extract('- 651.912 (OM 651 DE 22 LA)').map(r=>r.code),['OM651.912']);
assert.deepEqual(extract('642.826 (OM 642 LS DE 30 LA) - 642.864 (OM 642 LS DE 30 LA)').map(r=>r.code),['OM642.826','OM642.864']);
for(const text of ['271.948','M 271 E 18 ML','271.948 (M 272 E 18)','271.948 (OM 271','722.902','113.980, 981',undefined])assert.deepEqual(extract(text),[]);
console.log('Same-phrase Mercedes source engine evidence tests passed');
