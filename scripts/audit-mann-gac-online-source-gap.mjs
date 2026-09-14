import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {parseMannOnlineApplications} from './lib/mann-online-product-applications.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const url='https://www.mann-filter.com/sg-en/catalog/search-results/product.html/c28078_mann-filter.html';
const html=await readFile(resolve(root,'tmp/mann-online-evidence-2026-09-14/c28078.html'),'utf8');
assert.equal(sha(html),'8e84d836c3be252f0ff36bc17d70eaf6938fa10b09de9e1b1217902e42a67529');
const parsed=parseMannOnlineApplications(html,{url,article:'C28078'});
assert.equal(parsed.applications.length,21);assert.equal(parsed.applicationTables,11);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannSql=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
assert.equal(sha(mannSql),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const sources=parseCopy(sql,'vehicle_fluid_requirements'),mann=parseCopy(mannSql,'mann_filter_applications');
const plan=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(plan),'31f8407dde303ca792f858299a5c40282a4079d65b9e8a9a8e020941e8411c5c');
const selected=sources.filter(s=>s.make==='gac'&&s.model==='gs3');assert.equal(selected.length,31);
const applications=parsed.applications.filter(a=>a.model==='传祺 GS3 / Trumpchi GS3');assert.equal(applications.length,3);
// Explicit punctuation-only spelling correspondence, confined to this evidence audit.
// No global engine or manufacturer alias, no generation inferred from filter page.
const engineSpellings=new Map([['4A13M1','4A13M1'],['4A15K1','4A15-K1']]);
const findings=selected.map(s=>{
 const codes=[...new Set([s.engineCodeNormalized,...s.engineCodesJson].filter(Boolean))];
 const candidate=codes.length===1?applications.find(a=>a.engineCode===engineSpellings.get(codes[0])&&s.powerHp!=null&&Number(a.hp)===s.powerHp):null;
 const intersection=candidate&&s.yearFrom!=null&&s.yearTo!=null?{from:[`${s.yearFrom}-01`,candidate.manufactureMonths.from].sort().at(-1),to:`${s.yearTo}-12`}:null;
 if(intersection)assert.ok(intersection.from<=intersection.to);
 return {sourceRequirementId:s.id,sourceHash:sha(s),originalSource:s,onlineApplication:candidate??null,status:candidate?'SOURCE_ENGINE_POWER_LEAD':'NO_EXACT_ENGINE_POWER_LEAD_ON_THIS_PAGE',yearEnvelopeIntersection:intersection,excludedSourcePrefix:candidate&&s.yearFrom===2017?{from:'2017-01',to:'2017-07'}:null,remainingConditions:['MANUFACTURER_MARKET_AND_MODEL_IDENTITY','SOURCE_GENERATION_BODY_EVIDENCE','RAW_SOURCE_MONTH_BRANCHES','TECHNICAL_SPECIFICATIONS_AND_EQUIPMENT','INDEPENDENT_ADDITIVE_CATALOG_IMPORT_REVIEW'],publicationAllowed:false};
});
assert.equal(findings.filter(f=>f.onlineApplication).length,21);
assert.equal(findings.filter(f=>!f.onlineApplication).length,10);
assert.equal(mann.filter(r=>/GAC|TRUMPCHI|广汽/.test(r.make)).length,0);
const report={kind:'GAC_GS3_OFFICIAL_CATALOG_GAP_EVIDENCE',url,htmlHash:sha(html),sourceHash:sha(sql),mannHash:sha(mannSql),planHash:sha(plan),parserHash:sha(await readFile(resolve(root,'scripts/lib/mann-online-product-applications.mjs'),'utf8')),allOnlineApplications:parsed.applications,checkedSourceRows:31,candidateSourceRows:21,remainingSourceRows:10,findings,productionApplyAllowed:false,limitations:['One filter page, not fluid approval evidence. Chinese-market heading is not implicitly valid for Russian-market vehicles.','The 21 leads are not matched/published records. Dates from source SQL are year envelopes, not verified production months.','Ten second-generation rows remain unresolved; other GS3/GS4/GS3 POWER variants must not be substituted.']};
await writeFile(resolve(dir,'gac-gs3-online-gap-evidence-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({checked:31,candidateSources:21,unresolved:10,applications:21,htmlHash:sha(html),productionApplyAllowed:false}));
