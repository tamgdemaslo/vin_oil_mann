import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-live-audit-1789469257907');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8'),archiveRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(sourceRaw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');assert.equal(sha(archiveRaw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const originals=parseCopy(sourceRaw,'vehicle_fluid_requirements'),mann=parseCopy(mannRaw,'mann_filter_applications'),archive=new Map(archiveRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {normalizeVehicleMake}=await j.import('../src/lib/vehicle-normalization.ts');
const brand=mann.filter(r=>normalizeVehicleMake(r.make)==='SKODA');assert.ok(brand.length);
const findings=[];
for(const s of originals.filter(s=>s.sourceUrl==='https://podbormasla.ru/skoda/fabia/fabia_2/')){
 const own=archive.get(s.sourceRowId);assert.ok(own);assert.equal(own.page_title,'Масло для Шкода Фабия 2 (MK2) 2007-2015');assert.equal(own.generation_slug,'fabia_2');assert.equal(s.generation,null);assert.deepEqual(s.bodyCodesJson,['MK2']);
 // Exact source-page identity reinterpretation only. No claim MK2 is a MANN
 // chassis alias; do not assign 5J6/5J9 or infer generation from dates/engine.
 const corrected={...s,generation:'II',generationNumber:2,bodyCodesJson:[]};
 const before=match(s,brand),after=match(corrected,brand);
 const scoped=[];
 for(const candidate of after.topCandidates.filter(c=>!c.hardConflicts.length))for(const key of candidate.variantIds){
  const rows=brand.filter(r=>r.vehicleVariantKey===key),windows=rows.map(r=>applicabilityWindow(corrected,r));
  if(!windows.every(w=>w?.intersection?.from&&w.intersection.to)||new Set(windows.map(sha)).size!==1)continue;
  const window=windows[0],narrowed={...corrected,yearFrom:Number(window.intersection.from.slice(0,4)),yearTo:Number(window.intersection.to.slice(0,4))};
  const decision=match(narrowed,brand),target=decision.targets.find(t=>t.vehicleVariantKey===key&&t.independentlyValidated),rechecked=decision.topCandidates.find(c=>c.variantIds.includes(key));
  scoped.push({key,window,target:target??null,candidate:rechecked??null});
 }
 findings.push({sourceId:s.id,sourceHash:sha(s),pageHash:own.page_sha256,sourceRowHash:sha(own),beforeIdentity:{generation:s.generation,generationNumber:s.generationNumber,bodyCodesJson:s.bodyCodesJson},afterIdentity:{generation:'II',generationNumber:2,bodyCodesJson:[]},system:s.systemCode,beforeStatus:before.status,afterStatus:after.status,afterTopConflicts:after.topCandidates[0]?.hardConflicts??[],scoped});
}
assert.ok(findings.length>5);
const summary={sources:findings.length,originalConflicts:findings.filter(f=>f.beforeStatus==='CONFLICT').length,remainingConflicts:findings.filter(f=>f.afterStatus==='CONFLICT').length,scopedValidatedAssociations:findings.flatMap(f=>f.scoped.filter(s=>s.target)).length};
await writeFile(resolve(dir,'fabia-mk2-identity-audit.json'),JSON.stringify({kind:'EXACT_SOURCE_PAGE_MK2_GENERATION_AUDIT',sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),archiveHash:sha(archiveRaw),summary,findings,productionApplyAllowed:false,limitations:['Source-page-specific proposed identity correction, no DB or parser mutation.','Model generation is not a body-code alias. All dates/engines/power/fluid fields remain original except explicit intersection in scoped probes.','Successful matching is not fluid approval; transmission/component/equipment conditions remain.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
