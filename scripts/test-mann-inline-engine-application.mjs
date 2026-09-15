import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseLiteralEngineApplication as parse} from './lib/mann-literal-engine-application.mjs';
const app='МАСЛО в ДВИГАТЕЛЬ\nМодель: CHHB / CXDA\nТип топлива: Бензин\nОбъём двигателя: 2.0 л.\nМощность: 220 л.с. / 162 кВт\nГоды выпуска: 2015-2022';
const p=parse(app);assert.ok(p);assert.deepEqual(p.branches.map(b=>b.engineCode),['CHHB','CXDA']);
assert.equal(p.rawApplication,app);assert.equal(p.inlineSharedPower.powerKw,162);
for(const b of p.branches){assert.deepEqual(b.powerHp,[220]);assert.deepEqual(b.effectiveDates,{from:'2015-01',to:'2022-12'});assert.deepEqual(b.sharedCodeList,['CHHB','CXDA']);assert.equal(b.requiredMarket,null);assert.equal(b.driveCondition,null);}
for(const bad of ['CHHB /','CHHB / CHHB','CHHB (Европа)','2.0','ALL','DOHC','CHHB / Россия','CHHB / 4WD','CHHB / CXDA (4WD)'])assert.equal(parse(app.replace('CHHB / CXDA',bad)),null,bad);
for(const bad of ['220 л.с. / 90 кВт','220 / 280 л.с.','-','220 л.с. / 162 кВт / Россия'])assert.equal(parse(app.replace('220 л.с. / 162 кВт',bad)),null,bad);
assert.equal(parse(app+'\nтолько с DPF'),null);assert.equal(parse(app.replace('МАСЛО в ДВИГАТЕЛЬ','МАСЛО в ДВИГАТЕЛЬ 2.0 MT')),null);
const month='МАСЛО в ДВИГАТЕЛЬ\nМодель:\n- D20DT / 141 л.с. / Россия / 11.2006-02.2012 г.\n- D20DT / 141 л.с. / Ю. Корея / 04.2006-12.2011 г.\nТип топлива: Дизель\nОбъём двигателя: 2.0 л.\nГоды выпуска: 04.2006 - 02.2012';
const m=parse(month);assert.deepEqual(m.branches.map(b=>[b.requiredMarket,b.effectiveDates]),[['RU',{from:'2006-11',to:'2012-02'}],['KR',{from:'2006-04',to:'2011-12'}]]);
for(const bad of ['13.2006-02.2012 г.','11.2006-02.2012 г. только 4WD','11.2013-02.2012 г.'])assert.equal(parse(month.replace('11.2006-02.2012 г.',bad)),null);
const rows=(await readFile(new URL('../../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson',import.meta.url),'utf8')).trim().split('\n').map(JSON.parse);
const parsed=rows.map(r=>parse(r.application)).filter(Boolean);
console.log(JSON.stringify({test:'INLINE_SHARED_POWER_AND_MONTH_SUFFIX',wholeGrammarNegatives:true,parsedRawRows:parsed.length,inlineRawRows:parsed.filter(p=>p.inlineSharedPower).length}));
