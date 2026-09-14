import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseDocument,DomUtils} from 'htmlparser2';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'online-c2029-gap-evidence-v2.json'),'utf8'),report=JSON.parse(raw),html=await readFile(report.sourceHtml.path,'utf8');
assert.equal(sha(html),report.sourceHtml.sha256);assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),report.planHash);
assert.equal(sha(await readFile(resolve(root,'scripts/lib/mann-online-product-applications.mjs'),'utf8')),report.parserHash);
const dom=parseDocument(html),links=DomUtils.findAll(n=>n.name==='a'&&Object.hasOwn(n.attribs??{},'data-g-binding-application-link'),dom.children);assert.equal(links.length,98);
const groups=Map.groupBy(links,l=>Object.fromEntries(new URLSearchParams(decodeURIComponent(l.attribs['data-g-binding-params']))).vehicleTypeId);assert.equal(groups.size,49);
for(const finding of report.findings){
 const row=finding.application,matching=groups.get(row.manufacturerTypeId);assert.equal(matching.length,2);
 for(const link of matching){assert.equal(link.attribs['data-g-binding-params'],row.rawBinding);assert.deepEqual(Object.fromEntries(new URLSearchParams(decodeURIComponent(link.attribs['data-g-binding-params']))),row.binding);}
 assert.equal(finding.publicationAllowed,false);
}
const sql=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sql),report.mannHash);const rows=parseCopy(sql,'mann_filter_applications');
assert.equal(rows.filter(r=>r.make==='HYUNDAI'&&/Elantra/i.test(r.model)&&/\bHD\b/.test(`${r.model} ${r.vehicleText} ${r.effectiveVehicleText}`)).length,0);
const hd=report.findings.find(f=>f.application.manufacturerTypeId==='00000000219218');assert.equal(hd.application.vehicleText,'2.0 16V DOHC (HD)');assert.equal(hd.application.engineCode,'G4GC');assert.equal(hd.application.hp,'143');
assert.deepEqual(hd.application.manufactureMonths,{from:'2006-10',to:'2011-05',precision:'MONTH_FROM_RENDERED_TABLE'});
assert.equal(report.sourceLinks.length,12);assert.equal(new Set(report.sourceLinks.map(s=>s.sourceRequirementId)).size,12);
const selected=report.sourceLinks.filter(s=>s.onlineManufacturerTypeIds.length);assert.equal(selected.length,6);
for(const s of selected){assert.equal(sha(s.originalSource),s.sourceHash);assert.deepEqual(s.originalSource.engineCodesJson,['G4GC']);assert.equal(s.originalSource.powerHp,143);assert.equal(s.sourceBodyEvidence.bodyLiteral,'HD (2WD)');assert.deepEqual(s.onlineManufacturerTypeIds,['00000000219218']);assert.equal(s.publicationAllowed,false);}
const result={kind:'INDEPENDENT_ONLINE_APPLICATION_BINDING_CHECK',reportHash:sha(raw),htmlHash:sha(html),planHash:report.planHash,checkedLinks:98,checkedManufacturerIdentities:49,newHdSourceCandidates:6,canonicalRowsChanged:0,productionApplyAllowed:false,limitation:'Authenticates saved source and candidate inventory only; no publication, generation-alias resolution, whole-online-catalog coverage or OEM fluid approval.'};
await writeFile(resolve(dir,'online-c2029-gap-verification-v1.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
