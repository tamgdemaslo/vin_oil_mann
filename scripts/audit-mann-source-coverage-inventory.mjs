import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),archive=resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723'),out=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const read=async path=>{const raw=await readFile(path,'utf8');return {raw,hash:sha(raw)};};
const sitemap=await read(resolve(archive,'sitemap.xml')),pagesFile=await read(resolve(archive,'podbormasla_pages.ndjson')),rowsFile=await read(resolve(archive,'podbormasla_rows.ndjson')),summaryFile=await read(resolve(archive,'podbormasla_summary.json'));
const summary=JSON.parse(summaryFile.raw),pages=pagesFile.raw.trim().split('\n').map(JSON.parse),rows=rowsFile.raw.trim().split('\n').map(JSON.parse);
// Actual read-only HTTPS GET on 2026-09-15 returned this exact original body hash.
// This pins an observed result, not a claim this script fetched the site again.
const currentSitemapObservation={url:'https://podbormasla.ru/sitemap.xml',observedDate:'2026-09-15',httpStatus:200,bodySha256:'70b6bb4bcec7757c94b1fe53d76d9c914e6c05a4ae9d141f69bcfdb83b542fbb',urlCount:1353,addedUrls:[],source:'Read-only direct HTTPS GET verified in task tool output; no VIN sent.'};
assert.equal(sitemap.hash,currentSitemapObservation.bodySha256);assert.equal(sitemap.hash,summary.source.sitemap_sha256);
const urls=[...sitemap.raw.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map(m=>m[1].trim());
assert.equal(urls.length,1353);assert.equal(new Set(urls).size,1353);assert.equal(pages.length,1353);
assert.deepEqual([...new Set(pages.map(p=>p.source_url))].sort(),[...urls].sort());
assert.equal(rows.length,13287);
const rowsByUrl=Map.groupBy(rows,r=>r.source_url);
for(const p of pages)assert.equal((rowsByUrl.get(p.source_url)??[]).length,p.row_count,p.source_url);
assert.equal(pages.filter(p=>p.row_count).length,772);
const empty=pages.filter(p=>!p.row_count);
assert.equal(empty.length,581);assert.equal(empty.filter(p=>p.path_depth>=3).length,0);
const inventory=[...Map.groupBy(pages.filter(p=>p.row_count),p=>p.brand_slug)].map(([brand,brandPages])=>({brand,pages:brandPages.length,rows:brandPages.reduce((n,p)=>n+p.row_count,0),models:[...new Set(brandPages.map(p=>p.model_slug))].sort()})).sort((a,b)=>a.brand.localeCompare(b.brand));
const gapsFile=await read(resolve(out,'recorded-vin-source-gaps-v1.json')),replayFile=await read(resolve(out,'recorded-vin-fluid-replay-v5.json'));
const gaps=JSON.parse(gapsFile.raw),replay=JSON.parse(replayFile.raw),current=new Map(replay.findings.map(f=>[f.sampleRef,f]));
const cohort=gaps.findings.filter(f=>f.category==='NO_EXACT_MODEL_IN_SOURCE_INDEX');assert.equal(cohort.length,29);
const groupMap=new Map();
for(const f of cohort){
  const latest=current.get(f.sampleRef);assert.ok(latest);
  assert.ok(!latest.evaluations.some(e=>e.candidates.some(c=>c.draftCount)),'Historical gap now has drafts; reclassify it');
  for(const e of f.evaluations){
    const key=JSON.stringify([e.make,e.model]);
    if(!groupMap.has(key))groupMap.set(key,{make:e.make,model:e.model,sampleRefs:new Set(),candidateVariantKeys:new Set(),sourceIndexCount:e.sameModelSourceCount});
    const g=groupMap.get(key);g.sampleRefs.add(f.sampleRef);
    for(const c of e.candidates)for(const key of c.variantIds)g.candidateVariantKeys.add(key);
  }
}
const sourceAcquisitionGroups=[...groupMap.values()].map(g=>({...g,samples:g.sampleRefs.size,sampleRefs:[...g.sampleRefs],candidateVariantKeys:[...g.candidateVariantKeys],action:'FIND_ADDITIONAL_EXACT_MODEL_SOURCE_OR_PROVE_ALIAS; DO_NOT_COPY_OTHER_MODELS'})).sort((a,b)=>b.samples-a.samples||a.make.localeCompare(b.make)||a.model.localeCompare(b.model));
const report={kind:'SOURCE_COVERAGE_AND_ACQUISITION_INVENTORY',inputHashes:{sitemap:sitemap.hash,pages:pagesFile.hash,rows:rowsFile.hash,summary:summaryFile.hash,gaps:gapsFile.hash,replay:replayFile.hash},currentSitemapObservation,
  summary:{sitemapPages:1353,pagesWithRows:772,pagesWithoutRows:581,unaccountedUrls:0,rawRows:13287,emptyDeepPages:0,zeroRowPageDepths:Object.fromEntries([...Map.groupBy(empty,p=>p.path_depth)].map(([k,v])=>[k,v.length])),missingSourceCohortSamples:29,sourceAcquisitionGroups:sourceAcquisitionGroups.length},inventory,sourceAcquisitionGroups,
  supplementalSourceLeads:[{publisher:'LIQUI MOLY',url:'https://www.liqui-moly.com/en/us/service/oil-guide.html',status:'OFFICIAL_GUIDE_DISCOVERED; EXACT_VEHICLE_COVERAGE_AND_REUSE_NOT_VALIDATED'},{publisher:'Shell',url:'https://support.shell.de/hc/de/articles/360011069938-Wie-finde-ich-heraus-welches-%C3%96l-f%C3%BCr-mein-Fahrzeug-richtig-ist',status:'OFFICIAL_GUIDE_REFERENCE_DISCOVERED; EXACT_VEHICLE_COVERAGE_AND_REUSE_NOT_VALIDATED'}],
  productionApplyAllowed:false,limitations:['Identical sitemap proves no added listed URLs, not unchanged page content or absence of unlisted pages.','No empty deep pages does not prove all fluid fields or tables were parsed correctly.','29 cases are an exact-model index gap cohort, not proof no alias-equivalent data exists anywhere.','Candidate MANN variants are offered possibilities, not confirmed vehicle facts.','Public guide discovery is not permission for bulk reuse or proof of complete systems/volumes/OEM approvals.']};
await writeFile(resolve(out,'source-coverage-inventory-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({summary:report.summary,groups:sourceAcquisitionGroups.map(({make,model,samples})=>({make,model,samples}))}));
