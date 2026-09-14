import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
import { sha } from './lib/mann-offline-scope.mjs';
import {compareSpecificationSets} from './lib/mann-specification-comparison.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,process.argv[2]??'outputs/mann-combined-preview-plan-2026-09-13');
const raw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(raw);
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');
assert.equal(sha(liveRaw),plan.inputHashes.live);
const protectedIds=new Set(plan.existingActions.filter(a=>a.action==='PRESERVE_PROTECTED').map(a=>a.revisionId));
const primary=JSON.parse(liveRaw).filter(r=>protectedIds.has(r.id)).map(r=>({...r,createdAt:new Date(r.createdAt)}));
assert.equal(primary.length,protectedIds.size);
const rows=[...plan.newRevisions.map(r=>({...r,createdAt:new Date('2026-09-13'),reviewConfirmed:false,
  run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,
    gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,transmissionTypeCountPolicy:r.provenanceJson.explicitTransmissionTypeCount?.policy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,
      conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,equipmentComponentDrivePolicy:r.provenanceJson.explicitComponentDriveCondition?.policy,equipmentModelPolicy:r.provenanceJson.explicitEquipmentModel?.policy,transmissionModelListPolicy:r.provenanceJson.explicitTransmissionModelList?.policy,automaticProductSelection:false}}})),...primary];
const variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts');
const {explicitMannTransmissionModels,explicitMannCvtModels,explicitMannAlphanumericModels,explicitMannTransmissionModelYears}=await jiti.import('../src/lib/mann-transmission-model-list.ts');
const {mannTechnicalScopeMatches:scopeMatches}=await jiti.import('../src/lib/mann-technical-applicability.ts');
const {readMannEquipmentScope}=await jiti.import('../src/lib/mann-equipment-scope.ts');
const {VEHICLE_DESTINATION_MARKETS}=await jiti.import('../src/lib/vehicle-market.ts');
const fingerprint=i=>sha({systemCode:i.systemCode,componentModel:i.componentModel,capacities:i.capacities,specifications:i.specifications,
  viscosityGrades:i.viscosityGrades,recommendation:i.recommendation,replacementInterval:i.replacementInterval});
let cases=0,multiSystemCases=0,multiEquipmentCases=0;const conflicts=new Map(),seen=new Set(),isolatedSeen=new Set();
const specificationDifferences=new Map();
for(const [variant,group] of variants){
  const contexts=new Map();
  for(const row of group){
    const scopes=row.technicalDataJson.capacityBranches?.map(b=>b.applicabilityJson)??[row.applicabilityJson];
    for(const scope of scopes){
      for(const engineCode of scope.matchedEngineScope??[undefined]){
        const dates=[scope.window?.intersection?.from,scope.window?.intersection?.to].filter(Boolean);
        if(!dates.length)dates.push(undefined);
        const markets=group.some(r=>r.applicabilityJson.requiredMarket||r.technicalDataJson.capacityBranches?.some(b=>b.applicabilityJson?.requiredMarket))?[undefined,...VEHICLE_DESTINATION_MARKETS,'DE']:[undefined];
        for(const productionMonth of dates)for(const confirmedMarket of markets){
          const c={...row.applicabilityJson.sourceVehicleScope,engineCode,productionMonth,...(confirmedMarket?{confirmedMarket}:{})};contexts.set(sha(c),c);
          const model=component(row.componentModel),gear=scope.transmissionGearCount;
          const parseList=row.provenanceJson.explicitTransmissionModelList?.policy==='EXPLICIT_ALPHANUMERIC_SOURCE_MODEL_LIST_V1'?explicitMannAlphanumericModels:row.provenanceJson.explicitTransmissionModelList?.policy==='EXPLICIT_CVT_SOURCE_MODEL_LIST_V1'?explicitMannCvtModels:explicitMannTransmissionModels;
          const dated=row.provenanceJson.explicitTransmissionModelList?.policy==='EXPLICIT_SOURCE_MODEL_YEAR_RANGE_V1'?explicitMannTransmissionModelYears(row.componentModel):null;
          const models=dated?[dated.model]:model.kind==='model'?[model.model]:row.provenanceJson.explicitTransmissionModelList?parseList(row.componentModel)??[]:[];
          for(const transmissionGearCount of new Set([undefined,gear]))for(const transmissionModel of new Set([undefined,...models])){
            const selected={...c,transmissionGearCount,transmissionModel};contexts.set(sha(selected),selected);
          }
        }
      }
    }
  }
  // Exercise every per-circuit choice combination alongside gearbox contexts.
  // Never silently cap the matrix or replace evidence with a guessed aggregate.
  for(const context of [...contexts.values()]){
    const options=new Map();
    for(const row of group){
      const {requiredEquipment,...rest}=row.applicabilityJson;
      const equipment=readMannEquipmentScope(requiredEquipment);
      if(equipment&&scopeMatches(rest,context)){
        const {systemCode,...confirmation}=equipment;options.set(sha(confirmation),confirmation);
      }
    }
    let combinations=[[]];
    for(const choices of Map.groupBy([...options.values()],c=>c.circuit).values()){
      combinations=combinations.flatMap(existing=>[existing,...choices.map(c=>[...existing,c])]);
    }
    assert.ok(combinations.length<=4096,'Unexpected equipment choice matrix; audit explicitly before expanding');
    for(const confirmedEquipment of combinations.filter(c=>c.length)){
      const selected={...context,confirmedEquipment};contexts.set(sha(selected),selected);
    }
  }
  for(const context of contexts.values())for(const type of [undefined,'automatic','manual','cvt','robot']){
    const isolated=group.flatMap(row=>profile([row],type,context).items);
    for(const item of isolated)isolatedSeen.add(item.revisionId);
    const primarySystems=new Set(isolated.filter(i=>i.sourceStatus==='primary_source').map(i=>i.systemCode));
    const expected=isolated.filter(i=>i.sourceStatus==='primary_source'||!primarySystems.has(i.systemCode));
    const actual=profile(group,type,context);
    for(const item of actual.items)seen.add(item.revisionId);
    assert.deepEqual(new Set(actual.items.map(fingerprint)),new Set(expected.map(fingerprint)),`Profile loss: ${variant}`);
    assert.ok(actual.items.every(i=>!i.automaticSelectionEligible));
    if(new Set(actual.items.map(i=>i.systemCode)).size>1)multiSystemCases++;
    if(actual.items.filter(i=>i.userConfirmedEquipment).length>1)multiEquipmentCases++;
    for(const [system,items] of Map.groupBy(actual.items,i=>i.systemCode)){
      if(['v4','v5'].includes(process.argv[3]))for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
        const a=items[i],b=items[j],ar=group.find(r=>r.id===a.revisionId),br=group.find(r=>r.id===b.revisionId);
        // Different installed circuits are not competing fluid recommendations.
        if(ar?.applicabilityJson.requiredEquipment?.circuit!==br?.applicabilityJson.requiredEquipment?.circuit)continue;
        if(a.componentModel!==b.componentModel)continue;
        const specifications=compareSpecificationSets(a.specifications,b.specifications);
        const viscosity=compareSpecificationSets(a.viscosityGrades,b.viscosityGrades);
        if(specifications.kind==='IDENTICAL'&&viscosity.kind==='IDENTICAL')continue;
        const pair=sha({variant,system,ids:[a.revisionId,b.revisionId].sort()});
        if(!specificationDifferences.has(pair))specificationDifferences.set(pair,{vehicleVariantKey:variant,systemCode:system,
          revisionIds:[a.revisionId,b.revisionId],sourceRequirementIds:[ar?.sourceRequirementId,br?.sourceRequirementId],
          specifications,viscosity,overlapCases:0,examples:[],status:'SOURCE_REQUIREMENTS_DIVERGE_COMPATIBILITY_NOT_PROVED'});
        const finding=specificationDifferences.get(pair);finding.overlapCases++;
        if(finding.examples.length<5)finding.examples.push({transmissionType:type??null,context});
      }
      const numeric=items.filter(i=>i.capacities.length);
      if(new Set(numeric.map(i=>sha(i.capacities))).size<2)continue;
      const key=sha({variant,system,type,context,ids:numeric.map(i=>i.revisionId).sort()});
      conflicts.set(key,{vehicleVariantKey:variant,systemCode:system,transmissionType:type??null,context,
        rows:numeric.map(i=>({revisionId:i.revisionId,capacities:i.capacities,sourceStatus:i.sourceStatus,specifications:i.specifications})),
        status:'OVERLAPPING_DIFFERENT_CAPACITIES_REQUIRES_REVIEW'});
    }
    cases++;
  }
}
const unseen=plan.newRevisions.filter(r=>!seen.has(r.id)).map(r=>r.id);
const unresolvedRepresentation=[];
const equivalentRows=unseen.flatMap(id=>{
  const row=plan.newRevisions.find(r=>r.id===id);
  const equivalent=plan.newRevisions.find(other=>seen.has(other.id)&&other.vehicleVariantKey===row.vehicleVariantKey&&
    other.systemCode===row.systemCode&&other.componentModel===row.componentModel&&
    sha(other.applicabilityJson)===sha(row.applicabilityJson)&&sha(other.technicalDataJson)===sha(row.technicalDataJson));
  if(!equivalent){unresolvedRepresentation.push({revisionId:id,reason:'NO_EXACT_TECHNICAL_AND_SCOPE_DUPLICATE'});return [];}
  return [{revisionId:id,representedBy:equivalent.id,reason:'EXACT_TECHNICAL_AND_APPLICABILITY_DUPLICATE'}];
});
const unexercised=plan.newRevisions.filter(r=>!isolatedSeen.has(r.id)).map(r=>r.id);
const report={kind:'COMBINED_PROFILE_COMPOSITION_AUDIT',planSha256:sha(raw),variants:variants.size,cases,multiSystemCases,multiEquipmentCases,
  candidateRevisions:plan.newRevisions.length,seenCandidateRevisions:plan.newRevisions.length-unseen.length,unseenCandidateRevisions:unseen,
  individuallyExercisedCandidates:plan.newRevisions.length-unexercised.length,unexercisedCandidates:unexercised,equivalentRows,
  ...(['v3','v4','v5'].includes(process.argv[3])?{unresolvedRepresentation}:{}),
  ...(['v4','v5'].includes(process.argv[3])?{specificationDivergencePairs:specificationDifferences.size,specificationDifferences:[...specificationDifferences.values()]}:{}),
  ...(process.argv[3]==='v5'?{supportedMarkets:VEHICLE_DESTINATION_MARKETS,codeHashes:Object.fromEntries(await Promise.all(['src/lib/vehicle-market.ts','src/lib/mann-technical-applicability.ts','src/lib/mann-unified-technical-profile.ts'].map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))])))}:{}),
  droppedExpectedItems:0,capacityConflictCases:conflicts.size,conflictingVariants:new Set([...conflicts.values()].map(c=>c.vehicleVariantKey)).size,
  productionApplyAllowed:false,limitation:'Synthetic post-merge candidate/primary composition, sampled scope endpoints; not production HTTP, full month coverage, or technical fact verification.',conflicts:[...conflicts.values()]};
assert.ok(!process.argv[3]||['v2','v3','v4','v5'].includes(process.argv[3]));
await writeFile(resolve(dir,`profile-composition-audit${process.argv[3]?`-${process.argv[3]}`:''}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,conflicts:undefined},null,2));
assert.equal(unexercised.length,0,'Candidate never exercised individually');
assert.equal(unseen.length,equivalentRows.length,'Candidate not represented in joint profile');
assert.equal(conflicts.size,0,'Conflicting capacities prevent merge approval');
