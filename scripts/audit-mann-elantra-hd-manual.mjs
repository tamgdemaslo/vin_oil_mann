import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const factsRaw=await readFile(resolve(dir,'elantra-hd-manual-reviewed-facts-v1.json'),'utf8'),facts=JSON.parse(factsRaw);
const pdf=await readFile(resolve(root,facts.source.path));assert.equal(createHash('sha256').update(pdf).digest('hex'),facts.source.sha256);
assert.deepEqual(facts.source.visuallyReviewedPages,[1,4,92,304,305]);assert.equal(facts.productionApplyAllowed,false);
const proposalRaw=await readFile(resolve(dir,'online-hd-additive-proposal-v1.json'),'utf8');assert.equal(sha(proposalRaw),'076be3a39f00d5d76faf54164c8d75bbad9045865ee8a7031e77987a0bad9dd5');const proposal=JSON.parse(proposalRaw);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),proposal.planHash);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const branches={ENGINE_OIL:'gasoline 2.0 L',MANUAL_TRANSMISSION:'gasoline 2.0 L / diesel',AUTOMATIC_TRANSMISSION:'gasoline 2.0 L / diesel',POWER_STEERING:'hydraulic equipment, no engine split printed',ENGINE_COOLANT:'gasoline 2.0 L',BRAKE_FLUID:'brake / clutch hydraulic fluid'};
const findings=proposal.sourceProbes.map(p=>{
 const source=sources.get(p.sourceRequirementId);assert.ok(source);assert.deepEqual(source,p.originalSource);assert.equal(sha(source),p.sourceHash);
 const rows=facts.table.rows.filter(r=>r.systemCode===source.systemCode&&r.branch===branches[source.systemCode]);assert.equal(rows.length,1);const row=rows[0];
 assert.equal(Number(source.fillVolumeMinLiters),row.min);assert.equal(Number(source.fillVolumeMaxLiters),row.max);
 assert.equal(source.capacitiesJson.length,1);assert.equal(source.capacitiesJson[0].kind,'unspecified');
 assert.ok(source.serviceVolumeLiters,'Imported service field exists but is not automatically proven by numeric agreement');
 return {sourceRequirementId:source.id,sourceHash:sha(source),originalSource:source,manualRow:row,
  volumeComparison:'NUMERIC_RANGE_AGREES_WITH_TABLE',technicalVerification:'PARTIAL_MANUAL_CORROBORATION_ONLY',
  manualCapacityQualifier:row.capacityQualifier??null,serviceFillSemanticsVerified:false,
  preservedSourceSpecification:source.specificationText,preservedSourceIntervals:source.replacementIntervalText,
  equipmentReviewRequired:source.systemCode==='POWER_STEERING',
  extraSourceRecommendationNotVerified:source.systemCode==='ENGINE_COOLANT'?['phosphate chemistry','LLC A-110']:[],
  requiredGates:['MANUAL_EDITION_MARKET_AND_MONTH_SCOPE','SOURCE_TO_MANUAL_ENGINE_BRANCH','GENERATION_RECONCILIATION','CAPACITY_USAGE_AND_INTERVAL_SEMANTICS',...(source.systemCode.includes('TRANSMISSION')?['TRANSMISSION_TYPE_COUNT_OR_MODEL']:[]),...(source.systemCode==='POWER_STEERING'?['HYDRAULIC_VS_EPS_EQUIPMENT']:[])],publicationAllowed:false};
});
assert.equal(findings.length,6);assert.equal(new Set(findings.map(f=>f.originalSource.systemCode)).size,6);
assert.equal(findings.filter(f=>f.equipmentReviewRequired).length,1);
const report={kind:'ELANTRA_HD_SOURCE_MANUAL_COMPARISON',factsHash:sha(factsRaw),manualHash:facts.source.sha256,planHash:sha(planRaw),sourceHash:sha(sourceRaw),proposalHash:sha(proposalRaw),checked:findings.length,numericRangesCorroborated:findings.length,fluidSourcesFullyVerified:0,findings,productionApplyAllowed:false,canonicalChanged:false};
await writeFile(resolve(dir,'elantra-hd-manual-source-review-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,findings:findings.map(f=>({system:f.originalSource.systemCode,volume:f.volumeComparison,equipmentReview:f.equipmentReviewRequired}))}));
