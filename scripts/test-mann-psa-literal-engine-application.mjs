import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
import {resolve} from 'node:path';
import {parsePsaLiteralEngineApplication as parse} from './lib/mann-psa-literal-engine-application.mjs';
const app='МАСЛО в ДВИГАТЕЛЬ 1.6 MT\nМодель:\n- DV6TED4 (9HY) / 90 л.с. / Россия / 2008-2012\nТип топлива: Дизель\nОбъём двигателя: 1.6 л.\nГоды выпуска: 2008-2018';
const parsed=parse(app,'PEUGEOT');assert.ok(parsed);assert.deepEqual(parsed.branches.map(b=>b.engineCode),['DV6TED4','9HY']);
const j=createJiti(import.meta.url,{alias:{'@':resolve(import.meta.dirname,'../src')}}),{mannTechnicalScopeMatches:matches}=await j.import('../src/lib/mann-technical-applicability.ts');
for(const b of parsed.branches){
 assert.deepEqual(b.powerHp,[90]);assert.equal(b.requiredMarket,'RU');assert.deepEqual(b.effectiveDates,{from:'2008-01',to:'2012-12'});assert.equal(b.raw,app.split('\n')[2]);
 assert.equal(matches({requiredTransmission:b.requiredTransmission},{confirmedTransmissionType:'manual'}),true);
 for(const type of [undefined,'automatic','cvt','robot'])assert.equal(matches({requiredTransmission:b.requiredTransmission},{confirmedTransmissionType:type}),false);
}
for(const bad of ['(-)','(DPF)','(9HY / 9HZ)','(9HY) только с DPF','(ALL)','(4WD)'])assert.equal(parse(app.replace('(9HY)',bad),'PEUGEOT'),null,bad);
assert.equal(parse(app,'TOYOTA'),null);assert.equal(parse(app.replace('1.6 MT','1.6 AT'),'PEUGEOT'),null);
assert.equal(parse(app.replace('Объём двигателя: 1.6','Объём двигателя: 2.0'),'PEUGEOT'),null);
assert.equal(parse(app.replace('1.6 MT','1.6 HDi').replace('Тип топлива: Дизель','Тип топлива: Бензин'),'PEUGEOT'),null);
assert.equal(parse(app+'\nбез сажевого фильтра','PEUGEOT'),null);
const queue=JSON.parse(await readFile(resolve(import.meta.dirname,'../outputs/mann-gentra-evidence-review-2026-09-14/remaining-priority-action-queue-v1.json'),'utf8'));
const source=(await readFile(resolve(import.meta.dirname,'../../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
const byId=new Map(source.map(r=>[r.row_id,r]));let count=0;
for(const a of queue.unparsedAnchors){const r=byId.get(a.rowId),p=parse(a.application,r.brand_slug.toUpperCase());if(p){count++;assert.equal(p.rawApplication,a.application);assert.ok(p.branches.every(b=>b.literalSecondaryEngineCode&&b.primaryEngineCode));}}
assert.equal(count,6);console.log(JSON.stringify({actualPriorityHeadersParsed:count,transmissionScopeRuntimeNegatives:true,unknownConditionsRejected:true}));
