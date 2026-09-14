import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-passat-cbab-inclusive-preview-2026-09-14');
const [planRaw,sourceRaw,mannRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8')]);
const plan=JSON.parse(planRaw);assert.equal(plan.inputHashes.source,sha(sourceRaw));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>r.make==='BMW');
const archives=new Map();
for(const [url,file] of [['https://podbormasla.ru/bmw/x5/gen3/','3d0dd0b416f9938c3bdef8e4'],['https://podbormasla.ru/bmw/x6/gen2/','1075e21a347afce4bf8e429f'],['https://podbormasla.ru/bmw/x3/gen3/','e6262164fd8e0ec6ac26cbb1']]){
  const path=resolve(root,`../vin-oil-mann/outputs/podbormasla-20260723/page-results/${file}.json`),raw=await readFile(path,'utf8'),page=JSON.parse(raw);
  assert.equal(page.page.canonical_url,url);archives.set(url,{path,hash:sha(raw),page});
}
const results=[];
for(const held of plan.sourceBodyHeld){
  const revision=held.revision,source=sources.get(revision.sourceRequirementId);assert.ok(source);
  const original=overlay.originalById.get(source.id),archive=archives.get(source.sourceUrl);assert.ok(archive);
  const raw=archive.page.rows.find(r=>r.row_id===source.sourceRowId);assert.ok(raw);
  const graph=archive.page.json_ld.flatMap(d=>d['@graph']??[]);
  let product,bodyCodes,engineText;
  if(source.model==='x5'){
    const list=graph.find(n=>n['@id']===`${source.sourceUrl}#oil-selection-list`);assert.ok(list);
    const entry=list.itemListElement.find(e=>e.item?.name==='Масла и технические жидкости для BMW X5 4.4 л');assert.ok(entry);
    product=entry.item;bodyCodes=product.vehicleConfiguration.vehicleConfiguration.split(',').map(s=>s.trim());
    engineText=product.vehicleConfiguration.vehicleEngine.map(e=>e.engineModel).join(',');
  }else if(source.model==='x6'){
    const page=graph.find(n=>n['@type']==='WebPage'&&n.url===source.sourceUrl);assert.ok(page);
    product=page.mainEntity.itemListElement.find(p=>p['@id']===`${source.sourceUrl}#bmw-x6-4.4L`);assert.ok(product);
    const found=product.name.match(/\(Поколение 2, (F16, F86), 2015-2019\)/);assert.ok(found);
    bodyCodes=found[1].split(',').map(s=>s.trim());engineText=product.model;
  }else{
    assert.equal(source.model,'x3');assert.ok(!JSON.stringify(archive.page.json_ld).includes('F97'));
    results.push({revisionId:revision.id,sourceRequirementId:source.id,archiveHash:archive.hash,status:'MISSING_EXPLICIT_SOURCE_M_BODY',publicationAllowed:false});continue;
  }
  // Both the exact section and its engine list must support the held branch;
  // an M-body mention elsewhere on the page is insufficient.
  const sectionEngines=new Set(engineText.split(/[,/]+/).map(norm).filter(Boolean));
  assert.ok(revision.applicabilityJson.matchedEngineScope.every(c=>sectionEngines.has(norm(c))));
  const table=archive.page.rows.filter(r=>r.table_index===raw.table_index);
  assert.ok(table.some(r=>revision.applicabilityJson.matchedEngineScope.some(c=>String(r.model??'').split(/[,/]+/).map(norm).includes(norm(c)))));
  const window=revision.applicabilityJson.window.intersection;
  const scoped={...source,...(revision.provenanceJson.sourceEngineScope??{}),bodyCodesJson:bodyCodes,
    yearFrom:window.from?Number(window.from.slice(0,4)):null,yearTo:window.to?Number(window.to.slice(0,4)):null};
  const decision=match(scoped,catalog),target=decision.targets.find(t=>t.vehicleVariantKey===revision.vehicleVariantKey);
  results.push({revisionId:revision.id,revisionHash:sha(revision),sourceRequirementId:source.id,sourceHash:sha(original),
    evidence:{archivePath:archive.path,archiveHash:archive.hash,rawRowHash:sha(raw),tableIndex:raw.table_index,product,bodyCodes,sectionEngines:[...sectionEngines]},
    status:target?.independentlyValidated?'SOURCE_BODY_SCOPED_MATCH':'REVIEW',decision,publicationAllowed:false});
}
const report={planHash:sha(planRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),
  summary:Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length])),results,productionApplyAllowed:false,
  limitation:'Secondary source explicit section body/engine evidence and fullmake rerank only. No restored revisions, OEM approval, source technical validation or date expansion.'};
await writeFile(resolve(dir,'bmw-m-source-body-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
