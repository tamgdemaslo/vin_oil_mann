import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-compressed-preview-2026-09-14');
const [reportRaw,sourceRaw,mannRaw,rawText,planRaw]=await Promise.all([
 readFile(resolve(dir,'mercedes-source-code-loss-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
 readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const inventory=JSON.parse(reportRaw),plan=JSON.parse(planRaw);assert.equal(inventory.sourceHash,sha(sourceRaw));assert.equal(inventory.rawHash,sha(rawText));
const rawRows=new Map(rawText.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const forms=new Set(mannMakeFormsForTest('MERCEDES'));
const catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const results=[];
for(const entry of inventory.results.filter(r=>r.status==='FULL_SOURCE_CODE_MISSING_FROM_IMPORT')){
 const source=sources.get(entry.sourceRequirementId),original=overlay.originalById.get(source.id);assert.equal(sha(original),entry.sourceHash);
 const branches=[];
 // Engine oil belongs to its own engine row, not a neighboring engine's oil.
 const relevant=entry.evidence.filter(e=>source.systemCode!=='ENGINE_OIL'||e.rowId===source.sourceRowId);
 for(const [rowId,evidence] of Map.groupBy(relevant,e=>e.rowId)){
   const raw=rawRows.get(rowId);assert.equal(sha(raw),evidence[0].rowHash);assert.equal(raw.source_url,source.sourceUrl);assert.equal(raw.table_index,entry.tableIndex);
   const years=raw.production_years.match(/^\s*(\d{4})\s*[-–]\s*(\d{4})\s*$/);
   const power=raw.power.match(/^\s*(\d+)\s*л\.с\.\s*$/u);
   const volume=raw.engine_displacement.match(/^\s*(\d+(?:[.,]\d+)?)\s*л\.\s*$/u);
   const fuel=raw.fuel_type==='Бензин'?'gasoline':raw.fuel_type==='Дизель'?'diesel':null;
   const reasons=[];
   if(!years)reasons.push('ANCHOR_YEARS_REVIEW');if(!power)reasons.push('ANCHOR_POWER_REVIEW');if(!volume)reasons.push('ANCHOR_VOLUME_REVIEW');if(!fuel)reasons.push('ANCHOR_FUEL_REVIEW');
   const codes=[...new Set(evidence.map(e=>e.code))];
   const engine={engineCodesJson:codes,engineCodeNormalized:codes[0],powerHp:power?Number(power[1]):null,powerKw:null,
     engineVolumeCc:volume?Math.round(Number(volume[1].replace(',','.'))*1000):null,fuelType:fuel,
     yearFrom:years?Math.max(Number(years[1]),source.yearFrom??0):null,yearTo:years?Math.min(Number(years[2]),source.yearTo??9999):null};
   if(engine.yearFrom>engine.yearTo)reasons.push('EMPTY_SOURCE_YEAR_INTERSECTION');
   const recovered={...source,...engine};
   const decision=reasons.length?null:match(recovered,catalog);
   const capacity=parse(original.fillVolumeText,original.systemCode);
   const targets=(decision?.targets??[]).filter(t=>t.independentlyValidated).map(target=>{
     const fingerprint=originalAssociationFingerprint(target.vehicleVariantKey,original,capacity);
     return {...target,originalAssociationFingerprint:fingerprint,denied:denied.has(fingerprint),existingRevisionIds:plan.newRevisions.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===target.vehicleVariantKey).map(r=>r.id)};
   });
   if(capacity.needsReview)reasons.push('CAPACITY_REVIEW');
   if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_REVIEW');
   if(targets.some(t=>t.denied))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
   branches.push({anchorRowId:rowId,anchorHash:sha(raw),evidence,recoveredEngineContext:engine,status:decision?.status??'ANCHOR_REVIEW',
     reasons,reviewReasons:decision?.reviewReasons??[],targets,topCandidates:decision?.topCandidates.slice(0,3)??[],publicationAllowed:false});
 }
 results.push({sourceRequirementId:source.id,sourceHash:sha(original),systemCode:source.systemCode,branches,
   unassignedEvidence:entry.evidence.filter(e=>!relevant.includes(e)),publicationAllowed:false});
 if(results.length%50===0)console.log(JSON.stringify({processed:results.length,total:327}));
}
assert.equal(results.length,327);
const branches=results.flatMap(r=>r.branches),targets=branches.flatMap(r=>r.targets);
const report={planHash:sha(planRaw),inventoryHash:sha(reportRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),rawHash:sha(rawText),
 matcherHash:sha(await readFile(resolve(root,'src/lib/mann-fluid-matcher-v2.ts'),'utf8')),resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),
 targetParserHash:sha(await readFile(resolve(root,'src/lib/mann-engine-code-list.ts'),'utf8')),
 summary:{sources:results.length,branches:branches.length,statuses:Object.fromEntries([...Map.groupBy(branches,r=>r.status)].map(([k,v])=>[k,v.length])),
 confirmedTargets:targets.length,existingTargetPairs:targets.filter(t=>t.existingRevisionIds.length).length,newTargetPairs:targets.filter(t=>!t.existingRevisionIds.length).length},results,productionApplyAllowed:false,
 limitation:'Source-engine-specific diagnostic replay, not publishable revisions. Original technical/gearbox text retained; exact month windows, conditional capacities/equipment and branch-specific technical clauses require replay. Existing target pairs may have narrower scopes.'};
await writeFile(resolve(dir,'mercedes-bulk-source-engine-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
