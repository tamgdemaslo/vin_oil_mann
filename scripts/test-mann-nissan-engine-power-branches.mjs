import assert from 'node:assert/strict';
import {nissanEnginePowerBranches as parse} from './lib/mann-nissan-engine-power-branches.mjs';
const text='- QR25DE / 167 л.с. - VQ25DE / 182, 185 л.с.';
assert.deepEqual(parse(text,'2008 - 2014').map(b=>[b.engineCode,b.powerHp]),[['QR25DE',167],['VQ25DE',182],['VQ25DE',185]]);
assert.deepEqual(parse('- VQ35DE / 249, 260, 284 л.с.','2012 - 2021').map(b=>b.powerHp),[249,260,284]);
for(const raw of [text+' *',text+' Россия',text.replace('182, 185','182-185'),text.replace('182, 185','182, 182'),'- MR20-RM31 Hybrid / 2015-2022', '- QR25DE / 167 кВт','- QR25DE / 000 л.с.','- QR25DE / 167,5 л.с.'])assert.equal(parse(raw,'2008 - 2014'),null);
assert.equal(parse(text,'2014 - 2008'),null);assert.equal(parse(text,'2008+'),null);
console.log('Explicit Nissan engine/power branches: positive and negative cases passed.');
