import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const rawPlan=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(rawPlan),'df04fc11f498bb6e4c48d0b2976e2f01ecc9442ae6fcbc7c3973c7329224c3e5');const plan=JSON.parse(rawPlan);
const evidenceRaw=await readFile(resolve(dir,'replacement-engine-format-verification-v1.json'),'utf8'),entries=JSON.parse(evidenceRaw).findings.filter(f=>f.reasons.some(r=>r.status==='SOURCE_SCOPE_REVIEW'));assert.equal(entries.length,4);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');const mann=parseCopy(mannRaw,'mann_filter_applications');
const rawRows=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(rawRows),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');const rows=rawRows.trim().split('\n').map(JSON.parse);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{splitMannEngineCodeList:split}=await j.import('../src/lib/mann-engine-code-list.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
let cases=0;
const drafts=entries.map(entry=>{
 const action=plan.existingActions.find(a=>a.revisionId===entry.revisionId),before=plan.newRevisions.find(r=>r.id===action.successorId),source=sources.get(entry.sourceRequirementId);
 assert.equal(before.provenanceJson.catalogPreviewPolicy,'MANN_ENGINE_DATE_SCOPED_PREVIEW_V1');
 const row=rows.find(r=>r.row_id===source.sourceRowId);assert.equal(row.source_url,source.sourceUrl);
 const anchors=row.system_name==='МАСЛО в ДВИГАТЕЛЬ'?[row]:rows.filter(r=>r.source_url===row.source_url&&r.table_index===row.table_index&&r.system_name==='МАСЛО в ДВИГАТЕЛЬ');assert.equal(anchors.length,1);
 const anchor=anchors[0],restored=entry.reasons.flatMap(r=>r.parts.filter(p=>!p.retainedByRuntime&&p.listedByMann).map(p=>p.raw));assert.equal(restored.length,1);assert.ok(['Z18XER','CTHA'].includes(restored[0]));
 const targets=mann.filter(r=>r.vehicleVariantKey===before.vehicleVariantKey);assert.ok(targets.length);
 for(const code of [...before.applicabilityJson.matchedEngineScope,...restored]){
  assert.ok(source.engineCodesJson.includes(code));assert.ok(new RegExp(`(^|[^A-Z0-9])${code}([^A-Z0-9]|$)`).test(anchor.model));
  assert.ok(targets.every(t=>split(t.engineCode).map(s=>s.trim()).includes(code)));
 }
 const applicability={...before.applicabilityJson,matchedEngineScope:[...before.applicabilityJson.matchedEngineScope,...restored]};
 const semanticFingerprint=sha({policy:before.provenanceJson.catalogPreviewPolicy,sourceRequirementId:source.id,vehicleVariantKey:before.vehicleVariantKey,applicability,technicalData:before.technicalDataJson});
 const after={...before,id:`mtar_${semanticFingerprint.slice(0,24)}`,semanticFingerprint,applicabilityJson:applicability,provenanceJson:{...before.provenanceJson,engineScopeRestoration:{parentRevisionId:before.id,parentRevisionHash:sha(before),rawAnchorId:anchor.row_id,rawAnchorHash:sha(anchor),sourceRowHash:sha(row),restoredCodes:restored,scope:'EXPLICIT_SECONDARY_SOURCE_AND_SAME_MANN_VARIANT_INTERSECTION',independentOemVerified:false}}};
 const fixture=r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}});
 const win=applicability.window.intersection;
 const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
 let restoredPositive=0;
 for(let m=index(win.from)-1;m<=index(win.to)+1;m++)for(const engineCode of [...new Set([...source.engineCodesJson,'UNRELATED_TEST_ENGINE'])]){
  const context={...applicability.sourceVehicleScope,engineCode,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
  const old=profile([fixture(before)],undefined,context),now=profile([fixture(after)],undefined,context);
  const allowed=m>=index(win.from)&&m<=index(win.to)&&applicability.matchedEngineScope.includes(engineCode);
  assert.equal(now.items.length,allowed?1:0);assert.ok(now.items.every(i=>!i.automaticSelectionEligible));
  if(restored.includes(engineCode)&&allowed){assert.equal(old.items.length,0);restoredPositive++;}
  else assert.deepEqual(now.items.map(i=>({...i,revisionId:before.id})),old.items);
  cases++;
 }
 assert.ok(restoredPositive);
 return {before,after,originalSource:source,sourceRow:row,anchor,mannEvidence:targets,restoredPositive};
});
const report={kind:'FOUR_EXPLICIT_ENGINE_RESTORATION_DRAFTS',planHash:sha(rawPlan),evidenceHash:sha(evidenceRaw),sourceHash:sha(sourceRaw),rawHash:sha(rawRows),mannHash:sha(mannRaw),drafts,summary:{drafts:drafts.length,restoredEngineBranches:4,profileCases:cases},productionApplyAllowed:false,limitations:['Secondary source applicability restoration only, not OEM fluid approval.','Dates, market/vehicle scope, technical payload and verification status unchanged.','Synthetic completed staging-run fixtures, not database or deployed VIN tests.','Drafts not merged into canonical plan; downstream references and joint composition still require verification.']};
await writeFile(resolve(dir,'four-engine-restoration-drafts-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
