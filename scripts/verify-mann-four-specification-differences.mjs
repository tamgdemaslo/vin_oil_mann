import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const auditRaw=await readFile(resolve(dir,'profile-composition-audit-v5.json'),'utf8'),audit=JSON.parse(auditRaw);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),audit.planSha256);const plan=JSON.parse(planRaw);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const byId=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const byRaw=new Map(raw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
assert.equal(audit.specificationDifferences.length,4);
const findings=audit.specificationDifferences.map(f=>{
 assert.equal(f.systemCode,'TIRES_WHEELS');
 const evidence=f.revisionIds.map(id=>{
  const r=plan.newRevisions.find(r=>r.id===id);assert.ok(r);assert.equal(r.vehicleVariantKey,f.vehicleVariantKey);assert.equal(r.systemCode,f.systemCode);
  const s=byId.get(r.sourceRequirementId),raw=byRaw.get(s.sourceRowId);assert.ok(raw);assert.equal(raw.system_name,s.systemNameRaw);
  const role={'РАЗМЕР ШИН':'TIRE_DIMENSIONS','РАЗМЕР КОЛЁСНЫХ ДИСКОВ':'RIM_DIMENSIONS'}[s.systemNameRaw];assert.ok(role);
  assert.equal(s.make,'toyota');assert.equal(s.model,'rav4');assert.equal(r.technicalDataJson.specificationText,s.specificationText);
  return {revisionId:id,sourceRequirementId:s.id,sourceHash:sha(s),originalSource:s,rawRow:raw,rawHash:sha(raw),role};
 });
 assert.deepEqual(evidence.map(e=>e.role).sort(),['RIM_DIMENSIONS','TIRE_DIMENSIONS']);
 return {vehicleVariantKey:f.vehicleVariantKey,status:'DISTINCT_SOURCE_MEASUREMENTS_NOT_FLUID_CONFLICT',evidence,compatibilityVerified:false,publicationAllowed:false};
});
const report={kind:'FOUR_SPECIFICATION_DIVERGENCE_SOURCE_REVIEW',planHash:sha(planRaw),auditHash:sha(auditRaw),sourceSqlHash:sha(sql),rawHash:sha(raw),checked:4,fluidConflictPairsInThisAudit:0,distinctTireRimPairs:4,findings,productionApplyAllowed:false,limitations:['Classifies these four observed pairs only, not all source specifications or OEM correctness.','Separate tire and rim measurements do not establish approved combinations, trim applicability or interchangeability. Raw records are retained, not merged.']};
await writeFile(resolve(dir,'four-specification-differences-review-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined}));
