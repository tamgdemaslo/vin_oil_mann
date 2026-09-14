import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-disputed-year-preview-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--specific-body'));
const archive=resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/page-results');
const indexRaw=await readFile(resolve(archive,'86b3455ac19442c55aaf16a0.json'),'utf8'),index=JSON.parse(indexRaw);
const indexUrl='https://podbormasla.ru/volkswagen/passat/';
assert.equal(index.page.canonical_url,indexUrl);
const webpage=index.json_ld.flatMap(x=>x['@graph']??[]).filter(x=>x['@type']==='WebPage'&&x.url===indexUrl);
assert.equal(webpage.length,1);
const bodyByGeneration=new Map();
for(const entry of webpage[0].mainEntity.itemListElement){
  const product=entry.item;assert.match(product.model,/^B[5-8]$/);
  const generation=product.additionalProperty.find(p=>p.name==='Поколение')?.value;
  assert.equal(product.model,`B${generation}`);
  const body=product.additionalProperty.find(p=>p.name==='Кузов')?.value;assert.ok(body);
  const codes=body.split(',').map(s=>s.trim());assert.ok(codes.every(s=>/^[A-Z0-9]{3}$/.test(s)));
  bodyByGeneration.set(Number(generation),{codes,product});
}
assert.equal(bodyByGeneration.size,4);
const pageFiles={5:'af70dffe8fc43729885a9a3a',6:'c597a25335572d5c9530b71c',7:'f093b7f0f80d1463f4e8191e',8:'91cda56bdb29b8e6e39a2844'};
const pages=new Map();
for(const [generation,file] of Object.entries(pageFiles)){
  const raw=await readFile(resolve(archive,`${file}.json`),'utf8'),page=JSON.parse(raw);
  assert.equal(page.page.canonical_url,`${indexUrl}gen${generation}/`);
  pages.set(Number(generation),{hash:sha(raw),page,rows:new Map(page.rows.map(r=>[r.row_id,r]))});
}
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
const priorRaw=await readFile(resolve(dir,'passat-base-identity-recheck-v1.json'),'utf8'),prior=JSON.parse(priorRaw);
assert.equal(prior.sourceHash,sha(sourceRaw));assert.equal(prior.mannHash,sha(mannRaw));
const overlay=await loadIdentityOverlay(root,sourceRaw,prior.identityCorrections.path,prior.identityCorrections.sha256);
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>r.make==='VW (VOLKSWAGEN)');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const results=[];
for(const previous of prior.results){
  const source=sources.get(previous.requirementId);assert.ok(source);
  assert.equal(sha(overlay.originalById.get(source.id)),previous.sourceHash);
  const generation=Number(source.sourceUrl.match(/\/gen([5-8])\/$/)?.[1]);
  const evidence=bodyByGeneration.get(generation),page=pages.get(generation);assert.ok(evidence&&page);
  assert.equal(source.generation,{5:'V',6:'VI',7:'VII',8:'VIII'}[generation]);
  const row=page.rows.get(source.sourceRowId);assert.ok(row);assert.equal(row.source_url,source.sourceUrl);
  assert.equal(row.page_sha256,page.page.page.page_sha256);
  const oldCodes=source.bodyCodesJson??[];
  // Existing unsupported body evidence is a conflict, never silently overwritten.
  const conflicts=oldCodes.filter(code=>!evidence.codes.includes(code));
  if(conflicts.length){results.push({requirementId:source.id,status:'EXISTING_BODY_CONFLICT',conflicts,publicationAllowed:false});continue;}
  const scoped={...source,bodyCodesJson:evidence.codes};
  for(const key of Object.keys(source).filter(k=>k!=='bodyCodesJson'))assert.deepEqual(scoped[key],source[key]);
  const decision=match(scoped,catalog);
  results.push({requirementId:source.id,sourceHash:previous.sourceHash,systemCode:source.systemCode,
    bodyBefore:oldCodes,bodyAfter:evidence.codes,evidence:{indexHash:sha(indexRaw),product:evidence.product,
      sourcePageHash:page.hash,rawRowHash:sha(row)},beforeStatus:previous.decision.status,status:decision.status,decision,publicationAllowed:false});
  if(results.length%20===0)console.log(JSON.stringify({processed:results.length,total:prior.results.length}));
}
const report={kind:'PASSAT_SOURCE_BODY_EVIDENCE_RECHECK',productionApplyAllowed:false,sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),
  priorHash:sha(priorRaw),indexHash:sha(indexRaw),resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),
  summary:{requirements:results.length,statuses:Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length]))},
  limitation:'Source-internal generation/body mapping and full-make rematch only. No technical changes, date clipping, new preview or publication. Exact month windows and per-engine raw conditions still require validation.',results};
await writeFile(resolve(dir,process.argv[2]==='--specific-body'?'passat-source-body-recheck-v4.json':'passat-source-body-recheck-v3.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
