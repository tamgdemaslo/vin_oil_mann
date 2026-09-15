import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {selectExplicitFuelCapacity} from './lib/mann-explicit-fuel-capacity.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const preRaw=await readFile(resolve(dir,'xc60-source-branch-preflight-v3.json'),'utf8'),pre=JSON.parse(preRaw),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),pre.planHash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),pre.sourceHash);const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),pre.rawHash);const rawById=new Map(raw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const findings=[];
for(const sourceFinding of pre.findings.filter(f=>/TRANSMISSION/.test(f.systemCode)&&f.pairs.length)){
 const source=sources.get(sourceFinding.sourceRequirementId);assert.equal(sha(source),sourceFinding.originalSourceHash);
 for(const pair of sourceFinding.pairs){
  const anchor=rawById.get(pair.branch.anchorRowId);assert.equal(sha(anchor),pair.branch.anchorHash);
  const fuel=anchor.fuel_type==='Бензин'?'gasoline':anchor.fuel_type==='Дизель'?'diesel':null;
  const selected=selectExplicitFuelCapacity(source.fillVolumeText,fuel);
  const excluded=pair.reasons.includes('ENGINE_EXCLUDED_BY_COMPONENT_SOURCE_LIST');
  const reasons=[...pair.reasons];
  if(selected){
   assert.equal(source.fuelType,fuel,'Imported and raw source fuel disagree');
   assert.equal(sourceFinding.componentEngineList.status,'EXPLICIT');
   assert.ok(sourceFinding.componentEngineList.branches.some(b=>b.engineCode===pair.branch.engineCode&&b.powerHp===pair.branch.powerHp));
   assert.ok(sourceFinding.parsedCapacity.capacities.some(c=>c.nominalLiters===selected.liters));
   assert.ok(sourceFinding.parsedCapacity.suspicious.every(s=>s.code==='UNRESOLVED_CONDITIONAL_CAPACITY'));
   assert.deepEqual(sourceFinding.parsedCapacity.rejected,[]);
   assert.ok(reasons.includes('SOURCE_CAPACITY_REVIEW'));reasons.splice(reasons.indexOf('SOURCE_CAPACITY_REVIEW'),1);
  }
  findings.push({sourceRequirementId:source.id,originalSourceHash:sha(source),targetId:pair.targetId,branch:pair.branch,originalFillVolumeText:source.fillVolumeText,originalCapacities:sourceFinding.parsedCapacity,anchorFuelText:anchor.fuel_type,sourceFuelType:source.fuelType,selectedFuelCapacity:selected,requiredComponent:sourceFinding.componentEngineList.componentText,status:excluded?'EXCLUDED_BY_COMPONENT_ENGINE_LIST':selected?'EXPLICIT_FUEL_CAPACITY_BRANCH':sourceFinding.parsedCapacity.needsReview?'CAPACITY_CONDITION_STILL_UNRESOLVED':'SCALAR_CAPACITY_RETAINED',remainingReasons:reasons,publicationAllowed:false});
 }
}
assert.equal(findings.length,10);assert.equal(findings.filter(f=>f.selectedFuelCapacity).length,4);assert.equal(findings.filter(f=>f.status==='EXCLUDED_BY_COMPONENT_ENGINE_LIST').length,3);
const summary={candidatePairs:findings.length,fuelScopedCapacityPairs:4,excludedPairs:3,otherUnresolvedCapacityPairs:findings.filter(f=>f.status==='CAPACITY_CONDITION_STILL_UNRESOLVED').length,scalarCapacityPairs:findings.filter(f=>f.status==='SCALAR_CAPACITY_RETAINED').length};
await writeFile(resolve(dir,'xc60-transmission-capacity-branches-v1.json'),JSON.stringify({kind:'XC60_TRANSMISSION_CAPACITY_BRANCH_EVIDENCE',planHash:sha(planRaw),preflightHash:sha(preRaw),helperHash:sha(await readFile(resolve(root,'scripts/lib/mann-explicit-fuel-capacity.mjs'),'utf8')),summary,findings,productionApplyAllowed:false,limitations:['Capacity text is secondary source evidence, not OEM validation or an oil-change quantity recommendation.','Selected branches require raw/source fuel agreement and explicit component-engine membership.','Installed gearbox/model and source dates remain mandatory; no profile draft or canonical edit performed.','Cylinder-count-dependent M66 volumes remain unresolved; no cylinder count inferred from engine-code digits.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
