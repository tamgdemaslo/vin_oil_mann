import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {parseCopy,sha,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {sourceMarketBranches} from './lib/mann-source-market-branches.mjs';
import {intersectMonths,subtractMonths,unionMonths} from './lib/mann-month-intervals.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-compound-headings-recheck-2026-09-14');
const preflightRaw=await readFile(resolve(dir,'compound-heading-preflight-v1.json'),'utf8');
assert.equal(sha(preflightRaw),'29c5f16851be4347c3e78273f9b4ea889ce6dc085db1201432048b8ed736c55e');
const preflight=JSON.parse(preflightRaw),planRaw=await readFile(preflight.planPath,'utf8'),plan=JSON.parse(planRaw);
assert.equal(sha(planRaw),preflight.planHash);
for(const[file,hash]of Object.entries(preflight.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sourceRaw),preflight.sourceHash);assert.equal(sha(mannRaw),preflight.mannHash);
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements'),bySource=new Map(sources.map(s=>[s.id,s])),mannRows=parseCopy(mannRaw,'mann_filter_applications');
const archiveRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(archiveRaw),preflight.rawHash);
const archive=archiveRaw.trim().split('\n').map(JSON.parse),url='https://podbormasla.ru/daewoo/gentra/2gen/',page=archive.filter(r=>r.source_url===url);
assert.equal(page.length,8);assert.deepEqual([...new Set(page.map(r=>r.table_index))],[2]);
const anchors=page.filter(r=>r.system_name==='МАСЛО в ДВИГАТЕЛЬ');assert.equal(anchors.length,1);const anchor=anchors[0];
const branches=sourceMarketBranches(anchor.model,anchor.production_years);assert.equal(branches.length,1);const branch=branches[0];
assert.deepEqual(branch,{engineCode:'B15D2',powerHp:[107],market:'RU',window:{from:'2013-07',to:'2016-02'},sourceQualifier:null,sourcePhrase:'B15D2 / 107 л.с. / Россия / 07.2013-02.2016'});
const selected=preflight.findings.filter(f=>f.originalSource.sourceUrl===url);assert.equal(selected.length,8);
const pdfPath=resolve(root,'tmp/pdfs/gentra-evidence-2026-09-14/Gentra_2013.pdf'),pdfHash=createHash('sha256').update(await readFile(pdfPath)).digest('hex');
assert.equal(pdfHash,'da0e9d30dcc8cf4cb8f73cd284c73cec63e685e5280ecfe3cbe8cb6929382376');
const python=process.env.MANN_PDF_PYTHON??'/Users/ilaeliseenko/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const pages=JSON.parse(execFileSync(python,['-c','import json,sys;from pypdf import PdfReader;p=PdfReader(sys.argv[1]);print(json.dumps({str(i+1):p.pages[i].extract_text() for i in [0,19,233]},ensure_ascii=False))',pdfPath],{encoding:'utf8'}));
for(const t of ['Сентябрь, 2013','ДжиЭм Узбекистан','GENTRA'])assert.ok(pages['1'].includes(t));
for(const t of ['B15D2','Uz-DAEWOO','GENTRA'])assert.ok(pages['20'].includes(t));
for(const t of ['93744589','DEXRON 6','2014','500055','93740315','75W90','DEXRON 2D','DOT4','DEXCOOL'])assert.ok(pages['234'].includes(t));
const pdfEvidence={path:pdfPath,sha256:pdfHash,url:'https://elan-motors.ru/download/Gentra_2013.pdf',publisher:'ЗАО ДжиЭм Узбекистан, отдел Автосервис и Запасные части',edition:'2013-09',documentType:'PARTS_AND_SERVICE_MATERIALS_CATALOGUE',hostIsManufacturer:false,visuallyInspectedPdfPages:[1,20,234],pageTextHashes:Object.fromEntries(Object.entries(pages).map(([p,t])=>[p,sha(t)])),
 identity:{model:'Uz-DAEWOO GENTRA',enginePlate:'B15D2',sourceGenerationIICrosswalkProven:false,vinDecoderRuleApproved:false},
 serviceMaterials:{pdfPage:234,section:'9120',printedModelYear:'2014',printedVinDateFrom:'500055',vinDateBoundaryInterpretation:'UNRESOLVED_NOT_CONVERTED_TO_FULL_VIN_OR_MONTH',entries:[{part:'93740315',system:'MANUAL_TRANSMISSION',literal:'75W90',package:'1L'},{part:'93744589',system:'AUTOMATIC_TRANSMISSION',literal:'DEXRON 6'},{part:'93740316',system:'POWER_STEERING',literal:'DEXRON 2D',package:'1L'},{part:'93745443',system:'BRAKE_FLUID',literal:'DOT4',package:'0.5L'},{part:'93745444',system:'BRAKE_FLUID',literal:'DOT4',package:'1.0L'},{part:'93742646',system:'ENGINE_COOLANT',literal:'DEXCOOL',package:'2L'},{part:'93742647',system:'ENGINE_COOLANT',literal:'DEXCOOL',package:'4L'}],packageSizesAreNotFillCapacities:true,fillCapacitiesVerified:false},
 limitation:'Manufacturer-authored document copy on a third-party host. Printed MY/VIN limits retained literally; no all-year extension, gearbox interchangeability, source generation equivalence or fill-volume inference.'};
const dexronIV=sources.filter(s=>/\bDEXRON[\s-]*IV\b/i.test(`${s.specificationText??''} ${s.analogText??''}`));assert.equal(dexronIV.length,1);assert.equal(dexronIV[0].id,'a49f8c3551fabe1b18ba5ae86539b1ec3ffe583350c39444d0f725ffefefa0de');
let monthChecks=0;
const findings=selected.map(f=>{
 const source=bySource.get(f.sourceRequirementId);assert.deepEqual(source,f.originalSource);assert.equal(sha(source),f.sourceHash);
 const raw=page.find(r=>r.row_id===source.sourceRowId);assert.ok(raw);assert.ok(raw.row_index>=anchor.row_index);assert.equal(raw.table_index,anchor.table_index);
 assert.ok(!raw.model||raw===anchor);assert.ok(!raw.production_years||raw===anchor);assert.equal(source.contextConfidence,raw===anchor?'row_engine':'table_engine');
 assert.deepEqual(source.engineCodesJson,['B15D2']);assert.equal(source.powerHp,107);assert.equal(source.generation,'II');assert.equal(source.yearFrom,2013);assert.equal(source.yearTo,2016);
 const targets=mannRows.filter(r=>r.vehicleVariantKey===f.targetId);assert.equal(targets.length,3);
 for(const t of targets){assert.equal(t.model,'Gentra(UZ-DAEWOO)');assert.equal(t.engineCode,'B15D2');assert.equal(t.hp,'107');assert.equal(t.vehicleYears,'11/13 ->');}
 const importedWindow={from:'2013-01',to:'2016-12'},qualifiedWindow=intersectMonths(importedWindow,branch.window),targetWindow=applicabilityWindow(source,targets[0]).mann;
 const candidateWindow=intersectMonths(qualifiedWindow,targetWindow),pendingWindows=subtractMonths(qualifiedWindow,[candidateWindow]),excludedBySourceDates=subtractMonths(importedWindow,[qualifiedWindow]);
 assert.deepEqual(candidateWindow,{from:'2013-11',to:'2016-02'});assert.deepEqual(pendingWindows,[{from:'2013-07',to:'2013-10'}]);
 assert.deepEqual(excludedBySourceDates,[{from:'2013-01',to:'2013-06'},{from:'2016-03',to:'2016-12'}]);
 assert.deepEqual(unionMonths([candidateWindow,...pendingWindows,...excludedBySourceDates]),[importedWindow]);
 const contains=(w,m)=>w.from<=m&&m<=w.to;
 for(let year=2013;year<=2016;year++)for(let month=1;month<=12;month++){
  const m=`${year}-${String(month).padStart(2,'0')}`;assert.equal([candidateWindow,...pendingWindows,...excludedBySourceDates].filter(w=>contains(w,m)).length,1);monthChecks++;
 }
 const isAT=source.id===dexronIV[0].id;
 const reasons=['MISSING_EXPLICIT_CHASSIS_IDENTITY',...(isAT?['SOURCE_SPECIFICATION_CONTRADICTS_MANUFACTURER_CATALOGUE_SCOPE']:[]),...f.remainingConditionalBlockers];
 assert.equal(plan.newRevisions.filter(r=>r.sourceRequirementId===source.id).length,0);
 return {sourceRequirementId:source.id,sourceHash:sha(source),originalSource:source,rawSource:raw,rawSourceHash:sha(raw),sourceAnchor:anchor,sourceAnchorHash:sha(anchor),requiredSourceBranch:branch,importedWindow,qualifiedWindow,candidateWindow,pendingWindows,excludedBySourceDates,targetId:f.targetId,targetRows:targets,identityEvidence:f.clippedDecision.topCandidates[0],reasons,sourceSpecificationConflict:isAT?{originalLiteral:'DEXRON IV',manufacturerLiteral:'DEXRON 6',evidencePage:234,part:'93744589',modelYear:'2014',printedVinDateFrom:'500055',automaticCorrectionAllowed:false,fullVehicleScopeStillUnresolved:true}:null,publicationAllowed:false};
});
assert.equal(monthChecks,384);
const report={kind:'GENTRA_SOURCE_MONTH_MARKET_AND_PRIMARY_DOCUMENT_AUDIT',planPath:preflight.planPath,planHash:sha(planRaw),preflightHash:sha(preflightRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),rawHash:sha(archiveRaw),pdfEvidence,checked:8,monthPartitionChecks:monthChecks,sourceSpecificationScan:{scanned:sources.length,dexronIVSources:dexronIV.map(s=>({sourceRequirementId:s.id,sourceHash:sha(s),originalSource:s})),canonicalAffectedRevisionIds:[]},findings,publicationAllowed:false,productionApplyAllowed:false,limitation:'Source month/market partition is established; identity and technical source contradictions remain held. Candidate windows are potential only, not approved revisions. Original SQL and canonical plan unchanged.'};
await writeFile(resolve(dir,'gentra-source-scope-evidence-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({checked:8,monthChecks,qualifiedWindow:branch.window,candidateWindow:findings[0].candidateWindow,pendingWindows:findings[0].pendingWindows,excludedBySourceDates:findings[0].excludedBySourceDates,sourceSpecificationScanned:sources.length,dexronIVSources:dexronIV.length,ready:0,pdfHash}));
