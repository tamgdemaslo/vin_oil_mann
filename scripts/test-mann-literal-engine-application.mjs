import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
import {parseLiteralEngineApplication as parse} from './lib/mann-literal-engine-application.mjs';
const example='МАСЛО в ДВИГАТЕЛЬ\nМодель:\n- D4HE Diesel / 199 л.с. / Россия / 2021-2022 г.\n- D4HE Diesel / 202 л.с. / Ю. Корея / 2020-н.в.\nТип топлива: Дизель\nОбъём двигателя: 2.2 л.\nГоды выпуска: 2020 - н.в.';
const parsed=parse(example);assert.equal(parsed.branches.length,2);assert.deepEqual(parsed.branches.map(b=>[b.powerHp,b.requiredMarket,b.effectiveDates]),[[[199],'RU',{from:'2021-01',to:'2022-12'}],[[202],'KR',{from:'2020-01',to:null}]]);
const month=example.replace('2021-2022 г.','04.2021 - 06.2022');assert.deepEqual(parse(month).branches[0].effectiveDates,{from:'2021-04',to:'2022-06'});
for(const bad of [example+'\nunknown',example.replace('Россия','Россия неизвестно'),example.replace('199 л.с.','199 л.с. / неизвестно'),example.replace('2021-2022 г.','2022-2021 г.'),example.replace('2021-2022 г.','13.2021 - 06.2022'),example.replace('199 л.с.','199 л.с. / 200 л.с.'),example.replace('199 л.с.','0 л.с.'),example.replace('D4HE Diesel','D4HE Hybrid'),example.replace('Тип топлива: Дизель','Тип топлива: Бензин'),example.replace('2021-2022 г.','2010-2011 г.'),example.replace('199 л.с.','199, 199 л.с.')])assert.equal(parse(bad),null);
const multi=parse(example.replace('199 л.с.','199, 200 л.с.'));assert.deepEqual(multi.branches[0].powerHp,[199,200]);
if(process.argv[2]==='--check-only'){console.log('PASS: existing literal engine grammar and 11 negative conditions');process.exit(0);}
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const preRaw=await readFile(resolve(dir,'unplanned-matches-preflight-v2.json'),'utf8'),pre=JSON.parse(preRaw);
const anchors=[...new Map(pre.findings.flatMap(f=>f.anchorEvidence.map(a=>[a.rowId,a]))).values()];
const findings=anchors.map(a=>({rowId:a.rowId,rowHash:a.rowHash,result:parse(a.application)}));
const sourcePairs=pre.findings.map(f=>({sourceRequirementId:f.sourceRequirementId,anchors:f.anchorEvidence.map(a=>({rowId:a.rowId,parsed:!!findings.find(x=>x.rowId===a.rowId).result})),publicationAllowed:false}));
const summary={uniqueAnchors:anchors.length,parsedAnchors:findings.filter(f=>f.result).length,branches:findings.flatMap(f=>f.result?.branches??[]).length,sourcesWithAllAnchorsParsed:sourcePairs.filter(f=>f.anchors.length&&f.anchors.every(a=>a.parsed)).length,negativeChecks:11};
await writeFile(resolve(dir,'literal-engine-application-coverage-v1.json'),JSON.stringify({preflightHash:sha(preRaw),parserHash:sha(await readFile(resolve(root,'scripts/lib/mann-literal-engine-application.mjs'),'utf8')),summary,findings,sourcePairs,productionApplyAllowed:false,limitations:['Literal grammar preserves explicit power alternatives, markets and month/year boundaries; it does not select a matching target or verify fluid facts.','Remaining unsupported applications are retained, not partially accepted.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
