import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(raw),auditRaw=await readFile(resolve(dir,'plan-engine-intersections-v1.json'),'utf8'),audit=JSON.parse(auditRaw);assert.equal(sha(raw),audit.planHash);assert.equal(audit.findings.length,4);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements');
const rowRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(rowRaw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');const rows=rowRaw.trim().split('\n').map(JSON.parse);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const fixture=r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}});
const month=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;let checks=0,excluded=0;
const drafts=audit.findings.map(f=>{
 const before=plan.newRevisions.find(r=>r.id===f.revisionId),source=sources.find(r=>r.id===f.sourceRequirementId),row=rows.find(r=>r.row_id===source.sourceRowId);
 assert.equal(before.systemCode,'TIRES_WHEELS');assert.equal(f.location,'applicabilityJson');assert.deepEqual(f.matchedEngineScope,['3ZRFE','3ZRFAE','FAE']);assert.equal(f.mannEngines.length,1);assert.ok(['3ZRFE','3ZRFAE'].includes(f.mannEngines[0]));
 const anchors=rows.filter(r=>r.source_url===row.source_url&&r.table_index===row.table_index&&r.system_name==='МАСЛО в ДВИГАТЕЛЬ');assert.equal(anchors.length,1);const anchor=anchors[0];assert.equal(anchor.model,'- 3ZR-FE / 146 л.с. - 3ZR-FAE');
 assert.deepEqual(source.engineCodesJson,['3ZR-FE','3ZR-FAE','FAE']);
 const applicability={...before.applicabilityJson,matchedEngineScope:f.mannEngines};
 const semanticFingerprint=sha({policy:before.provenanceJson.catalogPreviewPolicy,sourceRequirementId:before.sourceRequirementId,vehicleVariantKey:before.vehicleVariantKey,applicability,technicalData:before.technicalDataJson});
 const after={...before,id:`mtar_${semanticFingerprint.slice(0,24)}`,semanticFingerprint,applicabilityJson:applicability,provenanceJson:{...before.provenanceJson,engineIntersectionRepair:{parentRevisionId:before.id,parentRevisionHash:sha(before),auditHash:sha(auditRaw),sourceRowHash:sha(row),anchorHash:sha(anchor),removedCodes:f.outside,reason:'EXACT_MANN_VARIANT_INTERSECTION; FAE_NOT_STANDALONE_IN_RAW_ENGINE_ANCHOR',independentOemVerified:false}}};
 const w=applicability.window.intersection;
 for(let m=month(w.from)-1;m<=month(w.to)+1;m++)for(const engineCode of ['3ZRFE','3ZRFAE','FAE','UNRELATED_TEST_ENGINE']){
  const context={...applicability.sourceVehicleScope,engineCode,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
  const old=profile([fixture(before)],undefined,context),now=profile([fixture(after)],undefined,context),expected=m>=month(w.from)&&m<=month(w.to)&&engineCode===f.mannEngines[0];
  assert.equal(now.items.length,expected?1:0);assert.ok(now.items.every(i=>!i.automaticSelectionEligible));
  if(expected)assert.deepEqual(now.items.map(i=>({...i,revisionId:before.id})),old.items);
  if(old.items.length&&!now.items.length)excluded++;checks++;
 }
 return {before,after,sourceRow:row,anchor,sourceRequirementId:source.id};
});
const report={kind:'RAV4_EXACT_ENGINE_SCOPE_REPAIR_DRAFTS',planHash:sha(raw),auditHash:sha(auditRaw),sourceHash:sha(sourceRaw),rawHash:sha(rowRaw),summary:{drafts:drafts.length,checks,excludedWrongEngineMonthCases:excluded},drafts,productionApplyAllowed:false,limitations:['Raw source and MANN intersection, not OEM verification of tire/rim specifications.','Original source engineCodes and all technical facts retained; only selected-variant matchedEngineScope corrected.','Drafts not merged; composition, active successor references and downstream reports still require update.']};
await writeFile(resolve(dir,'rav4-engine-scope-repair-drafts-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
