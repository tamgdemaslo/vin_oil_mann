import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const raw=await readFile(resolve(dir,'conditional-equipment-plan-v1.json'),'utf8'),plan=JSON.parse(raw);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),plan.inputHashes.source);
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {mannTechnicalScopeMatches:matches}=await jiti.import('../src/lib/mann-technical-applicability.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const runtimeRows=plan.revisions.map(row=>({...row,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,
  productionApplyAuthorized:false,gatesJson:{conditionalEquipmentPolicy:plan.policy,automaticProductSelection:false}}}));
let cases=0;const conflicts=[];
for(const row of plan.revisions){
  const s=sources.get(row.sourceRequirementId);assert.ok(s);
  assert.equal(row.systemCode,s.systemCode);assert.equal(row.technicalDataJson.fillVolumeText,s.fillVolumeText);
  assert.deepEqual(row.technicalDataJson.specifications,s.specificationsJson);assert.equal(row.applyEligible,false);
  const scope=row.applicabilityJson,{systemCode,...confirmation}=scope.requiredEquipment;
  assert.equal(systemCode,row.systemCode);
  for(const engineCode of scope.matchedEngineScope)for(const productionMonth of new Set([scope.window.intersection.from,scope.window.intersection.to].filter(Boolean))){
    const context={...scope.sourceVehicleScope,engineCode,productionMonth,confirmedEquipment:[confirmation]};
    assert.equal(matches(scope,context),true);
    for(const wrong of [{confirmedEquipment:undefined},{confirmedEquipment:[]},{confirmedEquipment:[{circuit:'WRONG',drive:'4WD'}]},
      {engineCode:'WRONG'},{model:'WRONG'},{productionMonth:'1800-01'},{confirmedEquipment:[confirmation,confirmation]}])assert.equal(matches(scope,{...context,...wrong}),false);
    if(confirmation.drive){
      assert.equal(matches(scope,{...context,confirmedEquipment:[{...confirmation,drive:undefined}]}),false);
      assert.equal(matches(scope,{...context,confirmedEquipment:[{...confirmation,drive:confirmation.drive==='4WD'?'2WD':'4WD'}]}),false);
    }
    const runtime=runtimeRows.find(r=>r.id===row.id);
    const shown=profile([runtime],undefined,context);
    assert.equal(shown.items.length,1,row.id);
    assert.equal(shown.items[0].capacities.length,row.technicalDataJson.capacities.length,'Preserve available volumes, never invent missing ones');
    assert.deepEqual(shown.items[0].userConfirmedEquipment,confirmation);
    assert.equal(shown.items[0].userConfirmedTransmission,false);assert.equal(shown.items[0].automaticSelectionEligible,false);
    const unconfirmed=profile([runtime],undefined,{...context,confirmedEquipment:undefined});
    assert.equal(unconfirmed.items.length,0);assert.equal(unconfirmed.equipmentOptions.length,1);
    for(const wrong of [{confirmedEquipment:[]},{confirmedEquipment:[{circuit:'WRONG',drive:'4WD'}]},
      {engineCode:'WRONG'},{model:'WRONG'},{productionMonth:'1800-01'},{confirmedEquipment:[confirmation,confirmation]}]){
      assert.equal(profile([runtime],undefined,{...context,...wrong}).items.length,0);
    }
    for(const wrong of [{engineCode:'WRONG'},{model:'WRONG'},{productionMonth:'1800-01'}])assert.equal(profile([runtime],undefined,{...context,...wrong}).equipmentOptions,undefined);
    const group=runtimeRows.filter(r=>r.vehicleVariantKey===row.vehicleVariantKey),combined=profile(group,undefined,context);
    for(const [system,items] of Map.groupBy(combined.items,i=>i.systemCode)){
      if(new Set(items.map(i=>sha(i.capacities))).size>1)conflicts.push({vehicleVariantKey:row.vehicleVariantKey,context,system,items});
    }
    cases++;
  }
}
const fixture=runtimeRows[0],scope=fixture.applicabilityJson;
const {systemCode,...equipment}=scope.requiredEquipment;
const context={...scope.sourceVehicleScope,engineCode:scope.matchedEngineScope[0],productionMonth:scope.window.intersection.from,confirmedEquipment:[equipment]};
const attachedFixture={...fixture,applicabilityJson:{...scope,requiredEquipment:{...scope.requiredEquipment,attachedTransmissionType:'automatic'}},
  provenanceJson:{...fixture.provenanceJson,sourceAggregateContext:{...fixture.provenanceJson.sourceAggregateContext,attachedTransmissionType:'automatic'}}};
const attachedContext={...context,confirmedEquipment:[{...equipment,attachedTransmissionType:'automatic'}]};
assert.equal(profile([attachedFixture],'automatic',attachedContext).items.length,1);
assert.equal(profile([attachedFixture],'manual',attachedContext).items.length,0,'Selected gearbox contradicts attached gearbox');
assert.equal(profile([attachedFixture],'manual',attachedContext).equipmentOptions,undefined);
assert.equal(profile([attachedFixture],'automatic',context).items.length,0,'Type alone is not circuit confirmation');
for(const mutation of [{state:'ACTIVE'},{applyEligible:true},{matchScore:79},{matchClass:'CONFIRMED_SINGLE'},
  {componentModel:'UNREVIEWED_MODEL'},{verificationStatus:'PRIMARY_SOURCE_VERIFIED_FIELDS'},
  {provenanceJson:{...fixture.provenanceJson,conditionalEquipmentEligible:false}},
  {provenanceJson:{...fixture.provenanceJson,independentValidation:{...fixture.provenanceJson.independentValidation,reviewBlockers:['OTHER']}}},
  {provenanceJson:{...fixture.provenanceJson,sourceAggregateContext:{...fixture.provenanceJson.sourceAggregateContext,fluidRequired:false}}},
  {run:{...fixture.run,productionApplyAuthorized:true}},
  {run:{...fixture.run,gatesJson:{...fixture.run.gatesJson,automaticProductSelection:true}}}]){
  const result=profile([{...fixture,...mutation}],undefined,context);assert.equal(result.items.length,0);assert.equal(result.equipmentOptions,undefined);
}
const report={kind:'EQUIPMENT_RUNTIME_VERIFICATION',planSha256:sha(raw),revisions:plan.revisions.length,cases,individualIssues:0,
  compositionConflictCases:conflicts.length,conflicts,publicationPolicyImplemented:true,productionApplyAllowed:false,
  limitation:'Local runtime and sampled endpoints. API schema added but UI and production integration not yet verified.'};
const reportPath=resolve(dir,'conditional-equipment-runtime-v2.json'),reportRaw=JSON.stringify(report,null,2)+'\n';
try{await writeFile(reportPath,reportRaw,{flag:'wx'});}
catch(error){if(error.code!=='EEXIST')throw error;assert.equal(await readFile(reportPath,'utf8'),reportRaw,'Use new artifact version when audit changes');}
console.log(JSON.stringify({...report,conflicts:undefined},null,2));
assert.equal(conflicts.length,0,'Conflicting equipment capacities prevent merge');
