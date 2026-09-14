import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(raw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),'31f8407dde303ca792f858299a5c40282a4079d65b9e8a9a8e020941e8411c5c');const plan=JSON.parse(planRaw);
const rows=parseCopy(raw,'vehicle_fluid_requirements');assert.equal(rows.length,13296);
const findings=rows.filter(r=>r.serviceVolumeLiters!=null&&Array.isArray(r.capacitiesJson)&&r.capacitiesJson.length>0&&r.capacitiesJson.every(c=>c.kind==='unspecified')).map(r=>({
 sourceRequirementId:r.id,sourceHash:sha(r),systemCode:r.systemCode,make:r.make,model:r.model,
 originalCapacityText:r.fillVolumeText,originalCapacities:r.capacitiesJson,importedServiceVolumeLiters:r.serviceVolumeLiters,
 candidateRevisionIds:plan.newRevisions.filter(c=>c.sourceRequirementId===r.id).map(c=>c.id),
 conclusion:'SERVICE_SEMANTICS_NOT_ESTABLISHED_BY_PARSED_CAPACITY_KIND',publicationAllowed:false
}));
const bySystem={};for(const f of findings)bySystem[f.systemCode]=(bySystem[f.systemCode]??0)+1;
const report={kind:'WHOLE_SOURCE_UNSPECIFIED_CAPACITY_SEMANTICS_AUDIT',sourceHash:sha(raw),planHash:sha(planRaw),parserHash:sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8')),checked:rows.length,unqualifiedServiceFields:findings.length,bySystem,affectedCandidateSources:findings.filter(f=>f.candidateRevisionIds.length).length,affectedCandidateRevisions:findings.reduce((n,f)=>n+f.candidateRevisionIds.length,0),findings,productionApplyAllowed:false,limitations:['This flags imported semantic ambiguity, not incorrect numeric capacity.','Scoped candidate capacities may already have stronger independent evidence; inspect each before changing them.','Existing original fields and canonical revisions are not modified.','Does not count mixed capacity-kind arrays or prove all other records correct.']};
await writeFile(resolve(dir,'unspecified-service-capacity-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined}));
