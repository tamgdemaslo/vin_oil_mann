import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parsePowerDriveEngineApplication as parse} from './lib/mann-power-drive-engine-application.mjs';
const audit=JSON.parse(await readFile(new URL('../outputs/mann-current-full-rematch-2026-09-14-v2/legacy-vehicle-drive-audit-v1.json',import.meta.url),'utf8'));
const text=audit.findings.flatMap(f=>f.evidence).find(e=>e.rowId==='705b958c7008a31b176898e961f0b3ac62fd887d0ca51cb44901c8a4867a98d2').application;
const result=parse(text,'TOYOTA');assert.equal(result.branches.length,6);assert.deepEqual(result.branches.map(b=>[b.powerHp[0],b.driveCondition]),[[136,'2WD'],[125,'4WD'],[143,'2WD'],[133,'4WD'],[143,'2WD'],[131,'4WD']]);assert.equal(result.rawApplication,text);
assert.deepEqual(result.branches[4].effectiveDates,{from:'2012-12',to:'2021-03'});
for(const bad of [text+'\nunknown',text.replace('(2WD)','(2WD или 4WD)'),text.replace('06.2007-03.2010','13.2007-03.2010'),text.replace('136 л.с.','136, 125 л.с.')])assert.equal(parse(bad,'TOYOTA'),null);
assert.equal(parse(text,'VOLVO'),null);console.log('PASS exact power-drive pairing, six source branches and month boundaries, unknown clauses rejected');
