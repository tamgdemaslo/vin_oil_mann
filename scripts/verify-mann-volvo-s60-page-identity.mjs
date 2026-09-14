import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-source-quality-preview-2026-09-14');
const path=resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/page-results/8cd422e6d6e9180dbc3af30b.json');
const [pageRaw,sourceRaw,planRaw,impactRaw]=await Promise.all([readFile(path,'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'page-year-preview-impact-v1.json'),'utf8')]);
const page=JSON.parse(pageRaw),plan=JSON.parse(planRaw),impact=JSON.parse(impactRaw);
assert.equal(plan.inputHashes.source,sha(sourceRaw));assert.equal(impact.planHash,sha(planRaw));
const url='https://podbormasla.ru/volvo/s60/2gen/';
assert.equal(page.page.source_url,url);assert.equal(page.page.canonical_url,url);assert.equal(page.final_url,url);
const webpages=page.json_ld.flatMap(d=>d['@graph']??[]).filter(n=>n['@type']==='WebPage'&&n.url===url);
assert.equal(webpages.length,1);const identity=webpages[0];
assert.equal(identity.name,'Подбор масла для VOLVO S60 II (134) 2010-2018 года');
assert.equal(page.page.title,'Подбор масла для VOLVO V60 (2 поколение), 2016-2018 г.');
const breadcrumb=identity.breadcrumb.itemListElement;
assert.ok(breadcrumb.some(b=>b.name==='VOLVO S60'&&b.item==='https://podbormasla.ru/volvo/s60/'));
assert.ok(breadcrumb.some(b=>b.name==='VOLVO S60 II, 2010-2018 года'));
const sections=identity.mainEntity.itemListElement;
assert.equal(sections.length,7);
for(const section of sections){assert.match(section.name,/^VOLVO S60 /);assert.ok(section.url.startsWith(url+'#volvo-s60-'));}
const rawRows=new Map(page.rows.map(r=>[r.row_id,r]));
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements').filter(r=>r.sourceUrl===url);
assert.equal(sources.length,69);assert.equal(rawRows.size,69);
for(const source of sources){
  const row=rawRows.get(source.sourceRowId);assert.ok(row);
  assert.equal(row.page_sha256,page.page.page_sha256);assert.equal(row.source_url,url);
  assert.equal(source.make,'volvo');assert.equal(source.model,'s60');
}
const sourceIds=new Set(sources.map(r=>r.id));
const revisions=plan.newRevisions.filter(r=>sourceIds.has(r.sourceRequirementId));
assert.equal(revisions.length,20);
assert.deepEqual(revisions.map(r=>r.id).sort(),impact.results.filter(r=>r.sourceUrl===url).map(r=>r.revisionId).sort());
const checks=revisions.map(r=>{
  const scope=r.applicabilityJson,window=scope.window.intersection;
  assert.equal(scope.sourceVehicleScope.make,'volvo');assert.equal(scope.sourceVehicleScope.model,'s60');
  assert.equal(scope.sourceVehicleScope.generation,'II');
  assert.ok(window.from>='2010-01'&&window.to<='2018-12');
  return {revisionId:r.id,revisionHash:sha(r),sourceRequirementId:r.sourceRequirementId,window,
    sourceModelConsistent:true,withinStructuredPageYears:true,publicationAllowed:false};
});
const report={kind:'SOURCE_PAGE_METADATA_CONTRADICTION_RESOLUTION',productionApplyAllowed:false,
  sourceUrl:url,pageArchivePath:path,pageArchiveHash:sha(pageRaw),pageHtmlHash:page.page.page_sha256,
  sourceHash:sha(sourceRaw),planHash:sha(planRaw),impactAuditHash:sha(impactRaw),
  evidence:{htmlTitle:page.page.title,structuredWebPageName:identity.name,description:identity.description,
    breadcrumb,sections,canonicalUrl:page.page.canonical_url},
  conclusion:'SOURCE_INTERNAL_IDENTITY_SUPPORTS_S60_II_2010_2018_TITLE_IS_INCONSISTENT',
  summary:{sourceRequirements:sources.length,sectionIdentities:sections.length,previewRevisions:checks.length,
    previewModelMismatches:0,previewOutsideStructuredPageYears:0},
  limitation:'Resolves the title-only warning for these existing source identities/windows, not independent OEM verification of fluid approvals, capacity or exact per-engine dates. All source and preview data preserved; no general preference for JSON-LD over titles.',
  sources:sources.map(r=>({id:r.id,sourceHash:sha(r),rawRowHash:sha(rawRows.get(r.sourceRowId))})),checks};
await writeFile(resolve(dir,'volvo-s60-page-identity-resolution-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
