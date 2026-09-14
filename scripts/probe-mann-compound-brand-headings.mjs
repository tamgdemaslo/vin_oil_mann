import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14');
const raw=await readFile(resolve(dir,'catalog-gap-retrieval-audit-v1.json'),'utf8'),audit=JSON.parse(raw),sql=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sql),audit.mannHash);
const rows=parseCopy(sql,'mann_filter_applications');
const headings={FAW:['BESTURN / FAW'],EXEED:['EXEED (CHERY)'],DAEWOO:['CHEVROLET EUROPE / DAEWOO (GM)','DAEWOO - FS LUBLIN']};
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{diagnoseMannCandidatesForTest:diagnose}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const selected=audit.findings.filter(f=>Object.hasOwn(headings,f.make));assert.equal(selected.length,169);
const findings=selected.map(f=>{
 assert.equal(f.status,'NO_BRAND_ROWS_IN_SNAPSHOT');const originals=rows.filter(r=>headings[f.make].includes(r.make));assert.ok(originals.length);
 // Deliberately offline experiment: production normalization is NOT changed.
 const trial=originals.map(r=>({...r,make:f.make,makeNormalized:f.make})),result=diagnose(f.effectiveVehicle,trial);
 return {sourceRequirementId:f.sourceRequirementId,make:f.make,originalSource:f.originalSource,sourceHash:f.sourceHash,originalHeadings:headings[f.make],targetRowIds:originals.map(r=>r.id),retrievedCount:result.retrievedCount,rankedCandidates:result.rankedCandidates,rejected:result.rejected,publicationAllowed:false};
});
const summary=Object.fromEntries([...Map.groupBy(findings,f=>f.make)].map(([make,group])=>[make,{sources:group.length,retrieved:group.filter(f=>f.retrievedCount>0).length,ranked:group.filter(f=>f.rankedCandidates.length>0).length}]));
const report={auditHash:sha(raw),planHash:audit.planHash,mannHash:sha(sql),headings,checked:findings.length,summary,findings,productionApplyAllowed:false,limitation:'Offline declared-heading normalization probe only. Virtual row make replacement is not production evidence or fluid approval. Shared Chevrolet/Daewoo headings require model-specific isolation tests; manufacturers/vehicles are not generally interchangeable.'};
await writeFile(resolve(dir,'compound-brand-heading-probe-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
