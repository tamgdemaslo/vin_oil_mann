import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseDocument,DomUtils as D} from 'htmlparser2';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {parseMannOnlineApplications} from './lib/mann-online-product-applications.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const url='https://www.mann-filter.com/cn-zh/catalog/search-results/product.html/w711/80_mann-filter.html';
const html=await readFile(resolve(root,'tmp/mann-online-evidence-2026-09-14/w711-80-cn.html'),'utf8'),dom=parseDocument(html);
const tables=D.findAll(n=>n.name==='table'&&n.attribs?.['aria-label']==='Application Table',dom.children);
const selected=tables.filter(t=>D.findAll(n=>n.name==='a'&&n.attribs?.['data-g-binding-params'],t.children).some(n=>new URLSearchParams(decodeURIComponent(n.attribs['data-g-binding-params'])).get('vehicleModelId')==='00000004537738'));
assert.equal(selected.length,1);const table=selected[0],originalTable=D.getOuterHTML(table);
const cn=['型号类型','过滤器类型','发动机代码','累积净化量','千瓦','马力','制造年份'];
const en=['Model Type','Filter Type','Engine Code','ccm','kW','HP','Year of Manufacture'];
// Projection translates exact column labels only. Numeric values, binding IDs,
// names, filter description and full engine lists remain original Chinese-page data.
let translations=0;
function walk(n){if(n.type==='text'){const i=cn.indexOf(n.data.trim());if(i>=0){n.data=en[i];translations++;}}for(const c of n.children??[])walk(c);}
walk(table);assert.equal(translations,28);
const headings=D.findAll(n=>n.name==='h1',dom.children).map(n=>D.getOuterHTML(n)).join('');
const parsed=parseMannOnlineApplications(headings+D.getOuterHTML(table),{url,article:'W711/80'});assert.equal(parsed.applications.length,3);
const a=parsed.applications.find(a=>a.manufacturerTypeId==='00000005281749');assert.ok(a);
assert.deepEqual([a.make,a.model,a.engineCode,a.ccm,a.kw,a.hp,a.manufactureMonths.from],['星途(奇瑞) / EXEED (CHERY)','揽月 / VX','SQRF4J20','1998','187','254','2021-03']);
assert.equal(a.manufactureMonths.to,null);
const englishRaw=await readFile(resolve(dir,'exeed-vx-online-evidence-v1.json'),'utf8'),english=JSON.parse(englishRaw);
const e=english.applications.find(a=>a.hp==='249');assert.notEqual(a.manufacturerTypeId,e.manufacturerTypeId);
const sql=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sql),english.mannHash);
const existing=parseCopy(sql,'mann_filter_applications').filter(r=>/EXEED/.test(r.make)&&r.model==='VX'&&r.engineCode==='SQRF4J20'&&Number(r.hp)===254);assert.equal(existing.length,0);
const probe=english.sourceProbe;assert.equal(probe.branch.engineCode,a.engineCode);assert.equal(probe.branch.powerHp[0],Number(a.hp));assert.equal(probe.branch.market,'CN');
const plan=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(plan),english.planHash);
const report={kind:'EXEED_VX_CN_254_SEPARATE_APPLICATION',url,htmlHash:sha(html),originalTableHash:sha(originalTable),originalTableHtml:originalTable,translatedLabels:cn.map((label,i)=>({original:label,projection:en[i]})),validatedTableCount:1,totalPageTables:tables.length,applications:parsed.applications,confirmedApplication:a,comparison249:e,englishEvidenceHash:sha(englishRaw),sourceProbe:probe,proposedSourceIntersection:{from:'2021-03',to:'2023-12',market:'CN'},uncoveredSourcePrefix:{from:'2021-01',to:'2021-02'},planHash:sha(plan),productionApplyAllowed:false,limitations:['Exact model/make/engine/power lead; no automatic manufacturer alias or fluid verification.','Only the exact VX table validated, not the whole Chinese catalog. Original Chinese labels and raw HTML retained.','Source year envelope is broader than official start; January/February 2021 cannot be included. Exact source production months and technical conditions still require verification.']};
await writeFile(resolve(dir,'exeed-vx-cn-254-evidence-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({htmlHash:sha(html),typeId:a.manufacturerTypeId,engine:a.engineCode,hp:a.hp,from:a.manufactureMonths.from,validatedApplications:3,oldExactRows:existing.length}));
