import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
const j=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {parseConditionalFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-conditions.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const {mannTechnicalContextFromVehicle:context}=await j.import('../src/lib/mann-technical-request-context.ts');
const report=JSON.parse(await readFile(new URL('../outputs/mann-current-full-rematch-2026-09-14-v2/pajero-engine-market-date-rematch-v1.json',import.meta.url),'utf8'));
let checks=0;
for(const f of report.findings){
 const parsed=parse(f.capacityEvidence.original,'ENGINE_COOLANT');assert.equal(parsed.status,'structured',parsed.reason);assert.equal(parsed.branches.length,2);
 const r={id:'rear-air-test',vehicleVariantKey:f.vehicleVariantKey,sourceRequirementId:f.sourceRequirementId,systemCode:'ENGINE_COOLANT',applicabilityJson:f.scope,technicalDataJson:{fillVolumeText:f.capacityEvidence.original,capacityBranches:parsed.branches.map(b=>({...b,applicabilityJson:f.scope,validation:{independentlyValidated:true,hardConflicts:[],reviewBlockers:[]}})),specifications:[{type:'TEST',value:'SYNTHETIC-SPEC'}],viscosityGrades:[]},fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_HIGH','technical.specifications':'SECONDARY_SOURCE_PARSED_HIGH'},verifiedFieldsJson:[],evidenceJson:[{publisher:'Test fixture',title:'Synthetic profile test'}],provenanceJson:{catalogPreviewPolicy:'MANN_CONDITIONAL_CAPACITY_PREVIEW_V1',catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,independentValidation:{independentlyValidated:true,hardConflicts:[],reviewBlockers:[]}},state:'STAGED',verificationStatus:'UNVERIFIED',applyEligible:false,reviewConfirmed:false,matchScore:100,matchClass:'CONFIRMED_SINGLE',createdAt:new Date(),run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:'MANN_CONDITIONAL_CAPACITY_PREVIEW_V1',automaticProductSelection:false}}};
 const base={...f.scope.sourceVehicleScope,engineCode:f.scope.matchedEngineScope[0],confirmedMarket:f.scope.requiredMarket,productionMonth:f.scope.window.intersection.from};
 for(const rearAirConditioning of [undefined,false,true,'false',0,null]){
  const result=profile([r],undefined,{...base,rearAirConditioning});assert.equal(result.rearAirConditioningRequired,true);assert.equal(result.items.length,1);
  const expected=typeof rearAirConditioning==='boolean'?[rearAirConditioning?10.5:9]:[];assert.deepEqual(result.items[0].capacities.map(c=>c.nominalLiters),expected);assert.equal(result.items[0].automaticSelectionEligible,false);checks++;
 }
 for(const wrong of [{engineCode:'WRONG'},{confirmedMarket:'UNKNOWN'},{productionMonth:'1900-01'}]){const result=profile([r],undefined,{...base,...wrong,rearAirConditioning:true});assert.equal(result.items.length,0);assert.equal(result.rearAirConditioningRequired,undefined);}
 assert.equal(profile([{...r,run:{...r.run,status:'PLANNED'}}],undefined,base).rearAirConditioningRequired,undefined);
}
for(const value of [undefined,false,true])assert.equal(context({}, {rearAirConditioning:value}).rearAirConditioning,value);
assert.equal(context({rearAirConditioning:true}).rearAirConditioning,undefined,'Never infer from decoded/manual vehicle fields');
const fixture=new URL('./fixtures/mann-market-route-stubs.mjs',import.meta.url).pathname;
const routeJ=createJiti(import.meta.url,{moduleCache:false,alias:{'@':new URL('../src',import.meta.url).pathname,'@/lib/branch-api':fixture,'@/lib/mann-unified-technical-profile':fixture}});
const {POST}=await routeJ.import('../src/app/api/mann-catalog/technical-profile/route.ts');
for(const value of [undefined,true,false,'false',0,null]){const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:['test'],vehicleContext:{rearAirConditioning:value}})}));assert.equal(response.status,value===undefined||typeof value==='boolean'?200:400);if(response.status===200)assert.equal((await response.json()).vehicleContext.rearAirConditioning,value);}
console.log(JSON.stringify({fivePajeroScopes:report.findings.length,capacityChecks:checks,unknownIsNotFalse:true,requestSchemaChecked:true}));
