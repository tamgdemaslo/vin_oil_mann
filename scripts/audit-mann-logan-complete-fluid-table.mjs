import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);
assert.equal(sha(planRaw),'96a5e0ba9e2586d103e994d56fb02f00ae3ad1bc0f8c6b45c9efc7bda203920b');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sourceRaw),plan.inputHashes.source);assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const rowsRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
const originals=rowsRaw.trim().split('\n').map(JSON.parse),url='https://podbormasla.ru/renault/logan/logan_2/';
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements').filter(s=>s.sourceUrl===url),mann=parseCopy(mannRaw,'mann_filter_applications').filter(r=>r.make==='RENAULT');
assert.equal(sources.length,7);assert.equal(originals.filter(r=>r.source_url===url).length,7);
const key='8edddc03d3a2997c6f9257dc8da33b1264a7bbd15e992901673cbc30c0697321',target=mann.filter(r=>r.vehicleVariantKey===key);assert.equal(target.length,2);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts'),{parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts');
const findings=[];
for(const s of sources){
 const own=originals.find(r=>r.row_id===s.sourceRowId);assert.ok(own);assert.equal(own.table_index,2);
 const scope={...s,engineCodeNormalized:'K7M',engineCodesJson:['K7M']};assert.equal(s.powerHp,null);
 const partitions=[];
 for(const [yearFrom,yearTo] of [[2013,2014],[2015,2022]]){
  const narrowed={...scope,yearFrom,yearTo},decision=match(narrowed,mann),validated=decision.targets.find(t=>t.vehicleVariantKey===key);
  const candidate=decision.topCandidates.find(c=>c.variantIds.includes(key));
  partitions.push({yearFrom,yearTo,window:applicabilityWindow(narrowed,target[0]),status:decision.status,target:validated??null,candidate:candidate??null,reviewReasons:decision.reviewReasons,decisionFingerprint:decision.decisionFingerprint});
 }
 const drafts=plan.newRevisions.filter(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===key);
 const requirements=[];
 if(s.systemCode==='ENGINE_OIL')requirements.push('SELECT_LITERAL_K7M_CAPACITY_NOT_K4M','RESOLVE_SOURCE_INTERVAL_ASTERISK','SEPARATE_REQUIREMENTS_FROM_INTERVAL');
 if(/TRANSMISSION/.test(s.systemCode))requirements.push('CONFIRM_INSTALLED_TRANSMISSION_NOT_INFER_FROM_SHARED_ENGINE_TABLE','PRESERVE_COMPONENT_MODEL_AND_TYPE','PRESERVE_SERVICE_VOLUME_CONTEXT');
 if(s.systemCode==='POWER_STEERING')requirements.push('CONFIRM_HYDRAULIC_STEERING_EQUIPMENT','SEPARATE_MAIN_REQUIREMENT_FROM_ANALOG');
 findings.push({sourceRequirementId:s.id,sourceHash:sha(s),rawRowHash:sha(own),system:s.systemCode,application:own.application,rawModel:own.model,fillVolume:own.fill_volume,specification:own.specification,sourceEngineInherited:s.engineCodesJson,parsedCapacity:parse(s.fillVolumeText,s.systemCode),partitions,existingDraftIds:drafts.map(r=>r.id),remainingRequirements:requirements,readyForPublication:false});
}
const files=['src/lib/mann-fluid-matcher-v2.ts','src/lib/fluid-capacity-parser.ts','src/lib/mann-unified-technical-profile.ts'];
const report={kind:'LOGAN_COMPLETE_SEVEN_ROW_SOURCE_TABLE_AUDIT',planHash:sha(planRaw),sourceHash:sha(sourceRaw),rawRowsHash:sha(rowsRaw),mannHash:sha(mannRaw),vehicleVariantKey:key,findings,runtimeHashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),productionApplyAllowed:false,limitations:['All seven source rows audited, not seven simultaneously applicable fluids.','Shared table engine context does not prove every engine/gearbox combination exists.','Matcher identity evidence is not technical approval; component/equipment/service conditions remain mandatory.']};
await writeFile(resolve(dir,'logan-complete-fluid-table-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(findings.map(f=>({system:f.system,drafts:f.existingDraftIds.length,status:f.partitions.map(p=>p.status),targetValidated:f.partitions.map(p=>!!p.target?.independentlyValidated),blockers:f.partitions[0].candidate?.reviewBlockers,requirements:f.remainingRequirements})),null,2));
