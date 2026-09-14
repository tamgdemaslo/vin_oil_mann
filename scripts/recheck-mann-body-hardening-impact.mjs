import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--specific-body'));
const specific=process.argv[2]==='--specific-body';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,specific?'outputs/mann-passat-date-inclusive-preview-2026-09-14':'outputs/mann-passat-inclusive-preview-2026-09-14');
const [planRaw,impactRaw,mannRaw,sourceRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),
  readFile(resolve(dir,specific?'specific-body-scope-impact-v1.json':'body-token-hardening-impact-v3.json'),'utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8')]);
const plan=JSON.parse(planRaw),impact=JSON.parse(impactRaw);
assert.equal(plan.inputHashes.source,sha(sourceRaw));assert.equal(impact.mannHash,sha(mannRaw));
assert.equal(impact.resolverHash,sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')));
const rows=parseCopy(mannRaw,'mann_filter_applications'),byRow=new Map(rows.map(r=>[r.id,r]));
const changedKeys=new Set();
if(specific)assert.equal(impact.planHash,sha(planRaw));
for(const change of specific?impact.findings:impact.changes){const row=byRow.get(specific?change.mannRowId:change.rowId);assert.ok(row);assert.equal(sha(row),specific?change.mannRowHash:change.rowHash);changedKeys.add(row.vehicleVariantKey);}
const selected=plan.newRevisions.filter(r=>changedKeys.has(r.vehicleVariantKey));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const cache=new Map(),results=[];
const bodyIndexRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/page-results/86b3455ac19442c55aaf16a0.json'),'utf8');
const bodyProducts=JSON.parse(bodyIndexRaw).json_ld.flatMap(d=>d['@graph']??[])
  .filter(n=>n['@type']==='WebPage'&&n.url==='https://podbormasla.ru/volkswagen/passat/')
  .flatMap(n=>n.mainEntity.itemListElement.map(e=>e.item));
for(const revision of selected){
  const source=sources.get(revision.sourceRequirementId);assert.ok(source);
  const a=revision.applicabilityJson,window=a.window?.intersection;
  assert.ok(window&&'from' in window&&'to' in window);
  const scoped={...source,...(revision.provenanceJson.sourceEngineScope??{}),
    ...(a.matchedEngineScope?.length?{engineCodeNormalized:a.matchedEngineScope[0],engineCodesJson:a.matchedEngineScope}:{}),
    yearFrom:window.from==null?null:Number(window.from.slice(0,4)),yearTo:window.to==null?null:Number(window.to.slice(0,4))};
  const bodyEvidence=revision.provenanceJson.sourceBodyEvidence;
  if(bodyEvidence){
    assert.equal(bodyEvidence.indexHash,sha(bodyIndexRaw));
    assert.ok(bodyProducts.some(p=>sha(p)===sha(bodyEvidence.product)));
    scoped.bodyCodesJson=bodyEvidence.product.additionalProperty.find(p=>p.name==='Кузов').value.split(',').map(s=>s.trim());
  }
  const identity=normalize(scoped);assert.ok(identity);
  if(!cache.has(identity.canonicalMake)){
    const forms=new Set(mannMakeFormsForTest(identity.canonicalMake));
    cache.set(identity.canonicalMake,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));
  }
  const decision=match(scoped,cache.get(identity.canonicalMake));
  const target=decision.topCandidates.find(c=>c.variantIds.includes(revision.vehicleVariantKey));
  const validation=decision.targets.find(t=>t.vehicleVariantKey===revision.vehicleVariantKey);
  results.push({revisionId:revision.id,revisionHash:sha(revision),requirementId:source.id,vehicleVariantKey:revision.vehicleVariantKey,
    systemCode:revision.systemCode,policy:revision.provenanceJson.catalogPreviewPolicy,
    normalizedVehicle:decision.normalizedVehicle,status:decision.status,
    disposition:validation?.independentlyValidated?'TARGET_IN_CONFIRMED_RESULT':target?'TARGET_REQUIRES_REVIEW':'TARGET_NOT_IN_TOP_RESULTS',
    target:target??null,validation:validation??null,publicationAllowed:false});
  if(results.length%20===0)console.log(JSON.stringify({processed:results.length,total:selected.length}));
}
const report={kind:'BODY_HARDENING_AFFECTED_PREVIEW_FULL_MAKE_DIAGNOSTIC',planHash:sha(planRaw),impactHash:sha(impactRaw),
  sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),resolverHash:impact.resolverHash,productionApplyAllowed:false,
  summary:{revisions:results.length,variants:new Set(results.map(r=>r.vehicleVariantKey)).size,
    dispositions:Object.fromEntries([...Map.groupBy(results,r=>r.disposition)].map(([k,v])=>[k,v.length]))},
  limitation:'Fresh full-make diagnostic on existing preview engine/year scope. Conditional transmission/equipment policy is not replayed by the base matcher; review is not proof of regression. Source-side-only body extraction changes and unchanged target competitors are not exhaustively audited.',results};
await writeFile(resolve(dir,specific?'specific-body-preview-recheck-v1.json':'body-hardening-preview-recheck-v2.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
