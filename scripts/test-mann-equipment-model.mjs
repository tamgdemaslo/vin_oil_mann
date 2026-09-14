import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {mannExactEquipmentModel:parse,mannEquipmentScopeMatches:matches,mannEquipmentChoiceKey:key,MANN_EXACT_EQUIPMENT_MODEL_POLICY:policy}=await jiti.import('../src/lib/mann-equipment-scope.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
for(const text of ['01R','0BD','TY21C','ATX90A','R145'])assert.equal(parse(`- ${text.toLowerCase()}`),text);
for(const text of ['',null,'LSD','HALDEX','4WD','2WD','4X4','6AT','01R / 0BD','01R (LSD)','01R *','01R 2000-2005','01R\n0BD'])assert.equal(parse(text),null);
const plan=JSON.parse(await readFile(new URL('../outputs/mann-identity-scoped-2026-09-14/conditional-equipment-plan-v1.json',import.meta.url),'utf8'));
const base=plan.revisions.find(r=>r.systemCode==='REAR_DIFFERENTIAL');assert.ok(base);
const rows=['01R','0BD'].map(model=>({...base,id:`TEST-${model}`,componentModel:`- ${model}`,
 createdAt:new Date(),reviewConfirmed:false,
 applicabilityJson:{...base.applicabilityJson,componentModel:`- ${model}`,requiredEquipment:{...base.applicabilityJson.requiredEquipment,componentModel:model}},
 provenanceJson:{...base.provenanceJson,explicitEquipmentModel:{policy,sourceComponentModel:`- ${model}`,model}},
 run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalEquipmentPolicy:plan.policy,automaticProductSelection:false,equipmentModelPolicy:policy}}
}));
const scope=rows[0].applicabilityJson;
const context={...scope.sourceVehicleScope,engineCode:scope.matchedEngineScope[0],productionMonth:scope.window.intersection.from};
assert.equal(profile(rows,undefined,context).items.length,0);
assert.equal(new Set(profile(rows,undefined,context).equipmentOptions.map(key)).size,2);
for(const row of rows){
 const {systemCode,...confirmation}=row.applicabilityJson.requiredEquipment;
 const c={...context,confirmedEquipment:[confirmation]};
 const result=profile(rows,undefined,c);assert.equal(result.items.length,1);assert.equal(result.items[0].revisionId,row.id);
 const withOriginalIssue={...row,provenanceJson:{...row.provenanceJson,sourceAggregateContext:{...row.provenanceJson.sourceAggregateContext,issues:['COMPONENT_OR_CONDITIONS_REQUIRE_REVIEW']}}};
 assert.equal(profile([withOriginalIssue],undefined,c).items.length,1,'Exact model discharges only the original component review issue');
 const withoutOptIn={...withOriginalIssue,run:{...row.run,gatesJson:{...row.run.gatesJson,equipmentModelPolicy:undefined}}};
 assert.equal(profile([withoutOptIn],undefined,c).items.length,0);
 assert.equal(result.items[0].componentModel,confirmation.componentModel);assert.equal(result.items[0].automaticSelectionEligible,false);
 for(const componentModel of [undefined,'WRONG1','01r','- 01R',null,{},'LSD']){
  assert.equal(matches(row.applicabilityJson.requiredEquipment,[{...confirmation,componentModel}]),false);
  assert.equal(profile([row],undefined,{...c,confirmedEquipment:[{...confirmation,componentModel}]}).items.length,0);
 }
 for(const wrong of [{engineCode:'WRONG'},{productionMonth:'1800-01'},{confirmedEquipment:[confirmation,confirmation]}])assert.equal(profile(rows,undefined,{...c,...wrong}).items.length,0);
 const mutations=[{componentModel:'01R (LSD)'},{applicabilityJson:{...row.applicabilityJson,componentModel:'WRONG1'}},
  {run:{...row.run,gatesJson:{...row.run.gatesJson,equipmentModelPolicy:undefined}}},
  {provenanceJson:{...row.provenanceJson,explicitEquipmentModel:undefined}},
  {provenanceJson:{...row.provenanceJson,explicitEquipmentModel:{...row.provenanceJson.explicitEquipmentModel,model:'WRONG1'}}},
  {provenanceJson:{...row.provenanceJson,sourceAggregateContext:{...row.provenanceJson.sourceAggregateContext,issues:['UNPARSED_CONDITION']}}}];
 for(const mutation of mutations)assert.equal(profile([{...row,...mutation}],undefined,c).items.length,0);
}
console.log('Exact equipment model policy, model-isolated output, missing/wrong model, evidence gates and choice keys PASS');
