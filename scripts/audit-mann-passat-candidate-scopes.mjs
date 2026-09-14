import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-disputed-year-preview-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&['--b7','--dates','--specific-dates'].includes(process.argv[2])));
const specific=process.argv[2]==='--specific-dates',dates=process.argv[2]==='--dates'||specific,b7=process.argv[2]==='--b7'||dates;
const dateOnly=c=>c&&!c.hardConflicts.length&&c.reviewBlockers.length===1&&c.reviewBlockers[0]==='диапазон MANN покрывает только часть лет источника; требуется ограничить применяемость';
const [parentRaw,sourceRaw,mannRaw,snapshotRaw]=await Promise.all([
  readFile(resolve(dir,specific?'passat-source-body-recheck-v4.json':b7?'passat-source-body-recheck-v3.json':'passat-source-body-recheck-v2.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const parent=JSON.parse(parentRaw);
const indexRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/page-results/86b3455ac19442c55aaf16a0.json'),'utf8');
assert.equal(parent.indexHash,sha(indexRaw));
const indexProducts=JSON.parse(indexRaw).json_ld.flatMap(d=>d['@graph']??[])
  .filter(n=>n['@type']==='WebPage'&&n.url==='https://podbormasla.ru/volkswagen/passat/')
  .flatMap(n=>n.mainEntity.itemListElement.map(e=>e.item));
assert.equal(parent.sourceHash,sha(sourceRaw));assert.equal(parent.mannHash,sha(mannRaw));
assert.equal(parent.resolverHash,sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const rawRows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {extractRawProductionCondition:condition}=await jiti.import('../src/lib/fluid-raw-production-condition.ts');
const {extractFluidEngineLineContext:lines}=await jiti.import('../src/lib/fluid-engine-line-context.ts');
const results=[];
for(const prior of parent.results.filter(r=>dates?dateOnly(r.decision.topCandidates?.[0]):['CONFIRMED_SINGLE','CONFIRMED_MULTI_APPLICABILITY'].includes(r.status))){
  const source=sources.get(prior.requirementId),raw=rawRows.get(source?.sourceRowId);assert.ok(source&&raw);
  assert.equal(sha(source),prior.sourceHash);assert.equal(sha(raw),prior.evidence.rawRowHash);
  assert.ok(indexProducts.some(p=>sha(p)===sha(prior.evidence.product)));
  const pageYears=prior.evidence.product.productionDate.match(/^(\d{4})-(\d{4})$/);assert.ok(pageYears);
  const effectiveSource={...source,yearFrom:source.yearFrom??Number(pageYears[1]),yearTo:source.yearTo??Number(pageYears[2])};
  const engines=new Set([source.engineCodeNormalized,...(source.engineCodesJson??[])].map(normalizeEngineCode).filter(Boolean));
  const own=String(raw.production_years??'').trim(),range=own.match(/^((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})(?:\s*г(?:\.|ода?)?)?$/iu);
  const qualifier=condition(own);
  const targets=dates?[...new Set(prior.decision.topCandidates.filter(dateOnly).flatMap(c=>c.variantIds))].map(vehicleVariantKey=>({vehicleVariantKey})):prior.decision.targets;
  for(const target of targets){
    if(!dates)assert.equal(target.independentlyValidated,true);
    const rows=variants.get(target.vehicleVariantKey);assert.ok(rows?.length);
    for(const row of rows){
      const reasons=[];
      const matching=[...new Set(String(row.engineCode??'').split(/[,;/]+/).map(normalizeEngineCode).filter(c=>engines.has(c)))];
      if(!matching.length)reasons.push('NO_EXACT_ENGINE_INTERSECTION');
      const window=applicabilityWindow(effectiveSource,row);
      if(!window)reasons.push('NO_EXACT_MONTH_WINDOW');
      if(own&&!range&&!qualifier)reasons.push('UNPARSED_OWN_PRODUCTION_TEXT');
      if(qualifier?.status==='REVIEW')reasons.push('UNPARSED_DATE_QUALIFIER');
      let from=window?.intersection.from,to=window?.intersection.to;
      if(range){from=[from,`${range[1]}-01`].filter(Boolean).sort().at(-1);to=[to,`${range[2]}-12`].filter(Boolean).sort()[0];}
      if(qualifier?.status==='SCOPED'){from=[from,qualifier.from].filter(Boolean).sort().at(-1);to=[to,qualifier.to].filter(Boolean).sort()[0];}
      if(!from||!to||from>to)reasons.push('EMPTY_OR_UNBOUNDED_WINDOW');
      const engineLines=matching.map(code=>({code,context:lines(raw.application??'',code)}));
      for(const item of engineLines){
        reasons.push(...item.context.reasons);
        if(item.context.matchingLines.length)reasons.push('LITERAL_ENGINE_LINE_REQUIRES_SCOPE_REPLAY');
      }
      results.push({requirementId:source.id,sourceHash:sha(source),sourceRowId:raw.row_id,rawRowHash:sha(raw),systemCode:source.systemCode,
        vehicleVariantKey:target.vehicleVariantKey,mannRowId:row.id,mannRowHash:sha(row),bodyCodes:prior.bodyAfter,
        sourceYears:{from:source.yearFrom,to:source.yearTo},effectiveYears:{from:effectiveSource.yearFrom,to:effectiveSource.yearTo},
        fallbackPageYearEvidence:(source.yearFrom==null||source.yearTo==null)?{indexHash:sha(indexRaw),product:prior.evidence.product}:null,
        matchedEngineScope:matching,originalWindow:window,proposedWindow:{from:from??null,to:to??null},rawProductionYears:own,
        qualifier,engineLines,status:reasons.length?'SOURCE_SCOPE_REVIEW':'MONTH_ENGINE_SCOPE_CANDIDATE',reasons:[...new Set(reasons)],publicationAllowed:false});
    }
  }
}
const report={kind:'PASSAT_CANDIDATE_RAW_SCOPE_AUDIT',parentHash:sha(parentRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),snapshotHash:sha(snapshotRaw),
  productionApplyAllowed:false,summary:{requirements:new Set(results.map(r=>r.requirementId)).size,contexts:results.length,
    statuses:Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length]))},
  limitation:'Month/engine/source-text scope extraction only, not final source quality approval, profile replay, protected-fingerprint screening or production coverage.',results};
await writeFile(resolve(dir,specific?'passat-date-candidate-scopes-v2.json':dates?'passat-date-candidate-scopes-v1.json':b7?'passat-candidate-scope-audit-v4.json':'passat-candidate-scope-audit-v3.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
