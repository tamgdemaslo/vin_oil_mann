import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),'6b436120dd91f8b1ca909fe1fc51556cdb1906b946c2cccc895e9cc03a18e032');const plan=JSON.parse(planRaw);
const rows=raw.trim().split('\n').map(JSON.parse),byRow=new Map(rows.map(r=>[r.row_id,r]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{prepareFluidCatalog}=await j.import('../src/lib/fluid-catalog.ts');
const parserHash=sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8'));assert.equal(parserHash,'27204ec4b2b92106085793c38fcf5d2e7c24622289ca924bebbc06a855f72615');
const prepared=prepareFluidCatalog({rowsNdjson:raw,mannFiltersCsv:''});assert.equal(prepared.requirements.length,13296);
const engines=prepared.requirements.filter(s=>s.make==='volvo'&&s.systemCode==='ENGINE_OIL');
// Pattern is an audit trigger only. It never determines corrected fuel.
const suspicious=engines.filter(s=>s.fuelType==='gasoline'&&/\(D\d{3,4}[TS]\d*\)/u.test(byRow.get(s.sourceRowId).application));
const anchors=suspicious.map(s=>{const row=byRow.get(s.sourceRowId);return {requirementId:s.id,sourceRowId:row.row_id,sourceRowHash:sha(row),sourceUrl:row.source_url,tableIndex:row.table_index,application:row.application,rawFuel:row.fuel_type,parsedFuel:s.fuelType,engineCodes:s.engineCodesJson,classification:'D_CODE_WITH_EXPLICIT_GASOLINE_REQUIRES_EVIDENCE',correctedFuel:null,publicationAllowed:false};});
const anchorIds=new Set(anchors.map(a=>a.sourceRowId)),affected=[];
for(const s of prepared.requirements){
 const row=byRow.get(s.sourceRowId);
 const sameTable=anchors.filter(a=>a.sourceUrl===row.source_url&&a.tableIndex===row.table_index);
 if(!sameTable.length)continue;
 // Own engine rows don't inherit another anchor's fuel.
 if(s.systemCode==='ENGINE_OIL'&&!anchorIds.has(s.sourceRowId))continue;
 const relevant=s.systemCode==='ENGINE_OIL'?sameTable.filter(a=>a.sourceRowId===s.sourceRowId):sameTable;
 affected.push({requirementId:s.id,sourceRowId:s.sourceRowId,sourceRowHash:sha(row),sourceUrl:s.sourceUrl,systemCode:s.systemCode,parsedFuel:s.fuelType,anchorIds:relevant.map(a=>a.sourceRowId),engineCodes:s.engineCodesJson,canonical:plan.newRevisions.filter(r=>r.sourceRequirementId===s.id).map(r=>({revisionId:r.id,vehicleVariantKey:r.vehicleVariantKey,engineScope:r.applicabilityJson.matchedEngineScope,publicationAllowed:false})),publicationAllowed:false});
}
const primaryEvidence=[
 {url:'https://mb.cision.com/Public/23602/4203205/bd0362b432959e77.pdf',title:'Volvo S40 technical specifications, July 2007',page:2,exactEngineCodes:['D4164T','D4204T','D5244T8'],fuel:'diesel',scope:'Manufacturer table explicitly pairs these exact codes with diesel columns. Does not establish all model years or D4204T2/D5244T9 variants.'},
 {url:'https://www.volvocars.com/de/media/press-releases/591D89E1A4569D11/',title:'Volvo S40 Übersicht MY 2012',published:'2011-05-16',modelVariants:['DRIVe 115 PS','D2 115 PS','D3 150 PS','D4 177 PS'],fuel:'diesel',scope:'Manufacturer describes these S40 variants as diesel; exact engine codes are not supplied. Model-label evidence is not an automatic exact-code correction.'},
 {url:'https://www.volvocars.com/uk/media/press-releases/464B5AA57533575D/',title:'Volvo S40',modelVariants:['2.0D'],fuel:'diesel',scope:'Manufacturer describes the 2.0D as diesel; no assumption that all gearbox or year variants are covered.'}
];
const summary={volvoEngineRequirements:engines.length,suspiciousEngineAnchors:anchors.length,affectedRequirements:affected.length,affectedCanonicalRevisions:affected.reduce((n,r)=>n+r.canonical.length,0),pages:[...Map.groupBy(affected,r=>r.sourceUrl)].map(([url,v])=>({url,requirements:v.length,anchors:anchors.filter(a=>a.sourceUrl===url).length})),s40AffectedRequirements:affected.filter(r=>r.sourceUrl==='https://podbormasla.ru/volvo/s40/2gen/').length};
const report={kind:'VOLVO_SOURCE_FUEL_CONTRADICTION_AUDIT',rawHash:sha(raw),planHash:sha(planRaw),parserHash,summary,primaryEvidence,anchors,affected,productionApplyAllowed:false,limitations:['D-prefix is a review trigger, never authority to rewrite fuel.','Exact-code evidence currently covers only three S40 codes and model-label evidence for MY2012; other codes/pages require independent validation.','This audits inherited source fuel, not fluid suitability or actual VIN equipment. No changes to source, canonical data or runtime.']};
await writeFile(resolve(dir,'volvo-source-fuel-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
