import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseDocument,DomUtils as D} from 'htmlparser2';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {parseMannOnlineApplications} from './lib/mann-online-product-applications.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const url='https://www.mann-filter.com/sg-en/catalog/search-results/product.html/w712/83_mann-filter.html';
const html=await readFile(resolve(root,'tmp/mann-online-evidence-2026-09-14/w712-83.html'),'utf8'),dom=parseDocument(html);
const tables=D.findAll(n=>n.name==='table'&&n.attribs?.['aria-label']==='Application Table',dom.children);
// Explicit scoped projection: preserve entire original selected table, including
// desktop/mobile copies. Other models are not asserted parsed or validated.
const selected=tables.filter(t=>D.findAll(n=>n.name==='a'&&n.attribs?.['data-g-binding-params'],t.children).some(n=>{
 const b=new URLSearchParams(decodeURIComponent(n.attribs['data-g-binding-params']));return b.get('vehicleModelId')==='00000004537738';
}));assert.equal(selected.length,1);
const headings=D.findAll(n=>n.name==='h1',dom.children).map(n=>D.getOuterHTML(n)).join('');
const tableHtml=D.getOuterHTML(selected[0]);
const parsed=parseMannOnlineApplications(headings+tableHtml,{url,article:'W712/83'});
assert.equal(parsed.applications.length,2);
for(const a of parsed.applications){assert.equal(a.manufacturerModelId,'00000004537738');assert.equal(a.model,'揽月 / VX');assert.equal(a.make,'星途(奇瑞) / EXEED (CHERY)');}
assert.deepEqual(parsed.applications.map(a=>[a.engineCode,a.hp]),[['SQRF4J20','249'],['SQRF4J20C','261']]);
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const old=parseCopy(mannRaw,'mann_filter_applications').filter(r=>r.vehicleVariantKey==='5ef269753a523ffdb2dccf9bf7c8952d401ec026add6a8822194e800f13906e4');assert.equal(old.length,1);
const a=parsed.applications[0];assert.equal(old[0].hp,a.hp);assert.equal(old[0].kw,a.kw);assert.ok(old[0].engineCode.startsWith(a.engineCode));
const source=JSON.parse(await readFile(resolve(dir,'recovered-market-scoped-recheck-v1.json'),'utf8'));
const probe=source.findings.find(f=>f.sourceRequirementId==='9e4263a875ac9be16cb34908cae8e5e9bcdfbc8c8472df04d24c2d73433315ab').probes.find(p=>p.branch.market==='CN');
assert.equal(probe.branch.powerHp[0],254);assert.equal(parsed.applications.some(a=>a.engineCode===probe.branch.engineCode&&Number(a.hp)===254),false);
const plan=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(plan),source.planHash);
const report={kind:'EXEED_VX_SCOPED_OFFICIAL_TABLE_EVIDENCE',url,htmlHash:sha(html),selectedTableHash:sha(tableHtml),totalPageTables:tables.length,validatedTables:1,scope:'EXACT_MANUFACTURER_MODEL_ID_00000004537738_ONLY',applications:parsed.applications,originalContaminatedRow:old[0],sourceProbe:probe,planHash:sha(plan),mannHash:sha(mannRaw),conclusion:'249_HP_CONFIRMED_NOT_A_PDF_POWER_ERROR_254_HP_SOURCE_NOT_MATCHED',productionApplyAllowed:false,limitations:['Full-page parser rejects an unrelated B+S versus B S engine binding mismatch; only complete VX table is validated here.','Chinese and export scopes are not equated. Footer removal does not authorize replacing 249 by 254 or SQRF4J20 by SQRF4J20C.','No existing variant rewrite, additive import, fluid publication or OEM confirmation.']};
await writeFile(resolve(dir,'exeed-vx-online-evidence-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,applications:undefined,originalContaminatedRow:undefined,sourceProbe:undefined}));
