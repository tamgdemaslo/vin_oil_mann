import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {parseCopy, sha} from './lib/mann-offline-scope.mjs';

// Read-only evidence report. This deliberately does not rewrite a source,
// create approved revisions, infer equivalence, or extend endpoint manuals.
const root=resolve(import.meta.dirname,'..');
const dir=resolve(root,'outputs/mann-market-month-scoped-preview-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
assert.equal(sha(planRaw),'df938f77959c226748b08a0d8d6bdae1c4ef978abc6bef065ea7bdce16364cc9');
const plan=JSON.parse(planRaw), sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const sources=parseCopy(sql,'vehicle_fluid_requirements');
assert.equal(sources.length,13296);
const pdfs=[];
for(const [edition,window,pages] of [
 ['201501',['2015-01','2016-06'],[355,545,547,549]],
 ['202201',['2022-01','2023-05'],[652,654,655,656]],
]){
 const path=resolve(root,`tmp/pdfs/alphard-oem-2026-09-14/alphard_hybrid_${edition}.pdf`);
 const bytes=await readFile(path);
 assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
 pdfs.push({edition,path,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,
  url:`https://manual.toyota.jp/pdf/alphard/alphard_hybrid_${edition}.pdf`,
  productionWindow:window,windowSource:'https://manual.toyota.jp/alphard/',
  visuallyReviewedPdfPagesOneBased:pages,printedPageOffset:-2});
}
const target='1a85ee2f2cece1aa8924a04b08e036ce048bae6e400c5757139d45e25974d674';
const reviews=plan.sourceMarketScopeReview.filter(e=>e.revision.vehicleVariantKey===target);
assert.equal(reviews.length,5);
const reasons={
 INVERTER_COOLANT:['OEM_SLLC_NOT_VW_APPROVAL','REFERENCE_CAPACITY_NOT_PROVEN_DRAIN_REFILL','INTERVAL_NOT_OEM_VERIFIED'],
 ENGINE_COOLANT:['ANALOG_MUST_NOT_BECOME_OEM_APPROVAL','REFERENCE_CAPACITY_NOT_PROVEN_DRAIN_REFILL','INTERVAL_NOT_OEM_VERIFIED'],
 ENGINE_OIL:['FILTER_CHANGE_CONDITION_MISSING','EDITION_SPECIFICATION_DIFFERENCES','INTERVAL_NOT_OEM_VERIFIED'],
 BRAKE_FLUID:['OEM_PRODUCT_DIFFERS_BY_EDITION','DOT_EQUIVALENCE_NOT_VERIFIED','ONE_LITER_NOT_IN_OEM_TABLE','INTERVAL_NOT_OEM_VERIFIED'],
 POWER_STEERING:['EARLY_OEM_ELECTRIC_STEERING_CONTRADICTS_HYDRAULIC_SOURCE','LATE_STEERING_PAGE_NOT_YET_REVIEWED'],
};
const findings=reviews.map(e=>{
 const original=sources.find(s=>s.id===e.revision.sourceRequirementId);
 assert.deepEqual(original,e.originalSource);
 assert.equal(e.revision.applyEligible,false);
 assert.equal(e.revision.verificationStatus,'UNVERIFIED');
 assert.ok(reasons[original.systemCode]);
 return {revisionId:e.revision.id,revisionHash:sha(e.revision),sourceRequirementId:original.id,
  originalReview:e,sourceHash:sha(original),reasons:[...reasons[original.systemCode],
   'JP_MARKET_NOT_SCOPED','SOURCE_END_2023_12_EXCEEDS_OEM_GENERATION_END_2023_05',
   'INTERMEDIATE_MANUALS_NOT_REVIEWED'],publicationAllowed:false};
});
const observedFacts={
 identity:{body:'AYH30W',engine:'2AR-FXE',frontMotor:'2JM',rearMotor:'2FM',drive:'4WD',pages:{'201501':549,'202201':656},limitation:'Not a fresh full-MANN candidate rank proof.'},
 engineOil:{litersWithoutFilter:4.0,litersWithFilter:4.4,capacityKind:'reference service quantity',pages:{'201501':545,'202201':652},earlyTable:['API SN/RC; ILSAC GF-5; SAE 0W-20','API SN/RC; ILSAC GF-5; SAE 5W-20','API SN/RC; ILSAC GF-5; SAE 5W-30','API SN/RC; ILSAC GF-5; SAE 10W-30'],lateTable:{recommended:'API SP/RC; ILSAC GF-6A; SAE 0W-20',suitable:'API SN/RC; SAE 5W-30'},limitation:'Table entries only, not exhaustive permitted categories from adjacent prose or a claim older grades prohibited.'},
 cooling:{product:'Toyota Super Long Life Coolant',engineLiters:9.3,inverterPowerControlUnitLiters:3.3,capacityKind:'reference capacity, not proven drain/refill quantity',pages:{'201501':547,'202201':654},vwEquivalenceEstablished:false},
 transmission:{product:'Toyota Auto Fluid WS',liters:3.8,capacityKind:'reference capacity',pages:{'201501':547,'202201':654},note:'Manual directs replacement questions to Toyota dealer; no gearbox model code established.'},
 rearElectricDriveDifferential:{product:'Toyota Auto Fluid WS',liters:1.8,capacityKind:'reference capacity',pages:{'201501':547,'202201':654},note:'Separate rear electric motor unit; not a generic conventional differential substitution.'},
 brake:{earlyProduct:'Toyota Brake Fluid 2500H-A',lateProduct:'Toyota Brake Fluid BF-5',pages:{'201501':547,'202201':655},oemLiters:null,dotEquivalenceEstablished:false},
 steering:{earlyType:'EPS, electric motor assist',pages:{'201501':355},hydraulicSourceSupported:false,lateEditionNotYetReviewed:true},
};
// Whole-source triage: exact normalized non-RAW spec text also occurs in
// explicitly labelled analog text. This is a review signal, not proof that
// every overlap is invalid or that the main specification lacks that text.
const normalize=s=>String(s??'').toUpperCase().replace(/[^\p{L}\p{N}]/gu,'');
const analogFindings=[];
for(const s of sources){
 if(!s.analogText)continue;
 const analog=normalize(s.analogText);
 const matches=(s.specificationsJson??[]).filter(spec=>{
  if(typeof spec!=='object'||spec===null)return false;
  if(spec.kind==='RAW'||spec.type==='RAW'||spec.standard==='RAW')return false;
  const value=spec.value??spec.code??spec.name;
  return typeof value==='string'&&normalize(value).length>=4&&analog.includes(normalize(value));
 });
 if(matches.length)analogFindings.push({sourceRequirementId:s.id,systemCode:s.systemCode,sourceHash:sha(s),analogText:s.analogText,specifications:matches,reason:'STRUCTURED_SPEC_ALSO_IN_ANALOG_TEXT_REVIEW_ONLY'});
}
const report={planHash:sha(planRaw),sourceHash:sha(sql),pdfs,observedFacts,findings,
 wholeSourceAnalogTriage:{sourcesExamined:sources.length,withAnalogText:sources.filter(s=>s.analogText).length,flagged:analogFindings.length,findings:analogFindings,limitation:'Exact text overlap only; no automatic invalidation, equivalence judgment, or completeness claim.'},
 productionApplyAllowed:false,canonicalPlanChanged:false,
 next:['Review six intermediate manuals and late EPS page','Fresh literal hybrid MANN identity proof','Create separately verified OEM-scoped replacement drafts preserving original source and unresolved months','Audit analog-vs-OEM separation before parser changes; frozen identity parser proofs must be rebuilt if touched']};
await writeFile(resolve(dir,'alphard-oem-evidence-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),sha(planRaw));
console.log(JSON.stringify({pdfs:pdfs.map(p=>({edition:p.edition,sha256:p.sha256})),reviewedRevisions:findings.length,analogTriage:report.wholeSourceAnalogTriage.flagged,canonicalPlanChanged:false}));
