import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {volvoComponentEngineList} from './lib/mann-volvo-component-engine-list.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);assert.equal(sha(planRaw),'6b436120dd91f8b1ca909fe1fc51556cdb1906b946c2cccc895e9cc03a18e032');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),plan.inputHashes.source);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const rawRows=raw.trim().split('\n').map(JSON.parse),byRaw=new Map(rawRows.map(r=>[r.row_id,r]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts'),{prepareFluidCatalog}=await j.import('../src/lib/fluid-catalog.ts');
const sources=parseCopy(sql,'vehicle_fluid_requirements').filter(s=>byRaw.get(s.sourceRowId)?.brand_slug==='volvo'),fresh=new Map(prepareFluidCatalog({rowsNdjson:raw,mannFiltersCsv:''}).requirements.map(s=>[s.id,s]));
const findings=[];
for(const source of sources){
 const row=byRaw.get(source.sourceRowId),parsed=volvoComponentEngineList(row.application),current=fresh.get(source.id);assert.ok(current);
 const suspiciousMarker=/используется.*(?:двс|двигател)|автомобилях с/iu.test(row.application??'');
 const engineCodes=s=>[...new Set([s.engineCodeNormalized,...s.engineCodesJson??[]].filter(Boolean).map(norm))];
 const listed=parsed.branches.map(b=>norm(b.engineCode)),imported=engineCodes(source),currentCodes=engineCodes(current);
 const extras=parsed.status==='EXPLICIT'?imported.filter(c=>!listed.includes(c)):[],freshExtras=parsed.status==='EXPLICIT'?currentCodes.filter(c=>!listed.includes(c)):[];
 const canonical=plan.newRevisions.filter(r=>r.sourceRequirementId===source.id).map(r=>{
  const scope=r.applicabilityJson.matchedEngineScope??[],normalized=scope.map(norm);
  return {revisionId:r.id,vehicleVariantKey:r.vehicleVariantKey,engineScope:scope,unsupportedByExplicitList:parsed.status==='EXPLICIT'?normalized.filter(c=>!listed.includes(c)):[],engineScopeUnspecified:!scope.length,publicationAllowed:false};
 });
 findings.push({sourceRequirementId:source.id,sourceHash:sha(source),sourceRowId:row.row_id,sourceUrl:row.source_url,rawHash:sha(row),systemCode:source.systemCode,parseStatus:parsed.status,suspiciousUnparsedMarker:suspiciousMarker&&parsed.status!=='EXPLICIT',componentList:parsed,importedEngineCodes:imported,currentParserEngineCodes:currentCodes,importedCodesOutsideList:extras,currentParserCodesOutsideList:freshExtras,explicitCodesMissingFromImport:parsed.status==='EXPLICIT'?listed.filter(c=>!imported.includes(c)):[],canonical,publicationAllowed:false});
}
const explicit=findings.filter(f=>f.parseStatus==='EXPLICIT'),affected=explicit.filter(f=>f.currentParserCodesOutsideList.length),canonicalConflicts=findings.flatMap(f=>f.canonical.filter(c=>c.unsupportedByExplicitList.length).map(c=>({sourceRequirementId:f.sourceRequirementId,...c})));
const summary={volvoSourceRequirements:findings.length,distinctRawRows:new Set(findings.map(f=>f.sourceRowId)).size,explicitComponentLists:explicit.length,unparsedRestrictionSources:findings.filter(f=>f.suspiciousUnparsedMarker).length,importedSourcesWithExtraEngines:explicit.filter(f=>f.importedCodesOutsideList.length).length,currentParserSourcesWithExtraEngines:affected.length,currentParserExtraEngineAssociations:affected.reduce((n,f)=>n+f.currentParserCodesOutsideList.length,0),explicitListCanonicalRevisions:explicit.reduce((n,f)=>n+f.canonical.length,0),canonicalUnsupportedEngineScopes:canonicalConflicts.length,affectedPages:[...new Set(affected.map(f=>f.sourceUrl))].length};
await writeFile(resolve(dir,'volvo-component-engine-scope-audit-v1.json'),JSON.stringify({kind:'ALL_VOLVO_COMPONENT_ENGINE_SCOPE_AUDIT',planHash:sha(planRaw),sourceHash:sha(sql),rawHash:sha(raw),parserHash:sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8')),helperHash:sha(await readFile(resolve(root,'scripts/lib/mann-volvo-component-engine-list.mjs'),'utf8')),summary,canonicalConflicts,findings,productionApplyAllowed:false,limitations:['Only complete recognized literal restriction lists classify excluded engines; ABSENT is not evidence of universal applicability.','Includes current fresh parser replay to distinguish stale SQL data from remaining import behavior.','No automatic removal of source engines or canonical records. Missing and unparsed restrictions require separate handling.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
