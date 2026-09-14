import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
const j=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {mannExplicitTransmissionTypeCount:parse,mannTransmissionComponent:component}=await j.import('../src/lib/mann-transmission-component.ts');
const {extractFluidSourceSystemContext:sourceContext}=await j.import('../src/lib/fluid-source-system-context.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
for(const bad of [null,'AT','2AT','19AT','6AT / A750F','7DCT (wet)','6AT 2000-2005','01V','CVT6'])assert.equal(parse(bad),null);
const p=JSON.parse(await readFile(new URL('../outputs/mann-gearbox-year-added-preview-2026-09-14/plan.json',import.meta.url),'utf8'));
const base=p.newRevisions.find(r=>r.provenanceJson.conditionalTransmissionPolicy==='USER_CONFIRMED_TRANSMISSION_V1');assert.ok(base);
let cases=0;
for(const [text,label] of [['6AT','МАСЛО в АКПП-6'],['7DCT','МАСЛО в РОБОТ-7']]){
 const parsed=parse(text),source=sourceContext(label,text);assert.equal(component(text).kind,'conditions','Do not globally convert held source strings');
 const row={...base,id:`TEST-${text}`,componentModel:text,systemCode:source.destinationSystemCode,createdAt:new Date(),reviewConfirmed:false,
  applicabilityJson:{sourceVehicleScope:{make:'haval',model:'h6'},matchedEngineScope:['TESTENGINE'],componentModel:text,transmissionType:parsed.type,transmissionGearCount:parsed.gearCount,window:{intersection:{from:'2015-01',to:'2020-12'}}},
  provenanceJson:{conditionalTransmissionPolicy:'USER_CONFIRMED_TRANSMISSION_V1',conditionalTransmissionEligible:true,sourceTransmissionContext:source,explicitTransmissionTypeCount:{policy:'EXPLICIT_SOURCE_TYPE_COUNT_V1',sourceComponentModel:text,typeCount:parsed},independentValidation:{vehicleIdentityIndependentlyValidated:true,hardConflicts:[],reviewBlockers:['MANN variant не подтверждает тип или модель коробки']}},
  run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalTransmissionPolicy:'USER_CONFIRMED_TRANSMISSION_V1',transmissionTypeCountPolicy:'EXPLICIT_SOURCE_TYPE_COUNT_V1',automaticProductSelection:false}}
 };
 const context={make:'haval',model:'h6',engineCode:'TESTENGINE',productionMonth:'2017-05',transmissionGearCount:parsed.gearCount};
 for(const type of [undefined,'automatic','manual','cvt','robot'])for(const count of [undefined,parsed.gearCount,99])for(const engine of [undefined,'WRONG','TESTENGINE']){
  const result=profile([row],type,{...context,engineCode:engine,transmissionGearCount:count});const expected=type===parsed.type&&count===parsed.gearCount&&engine==='TESTENGINE';assert.equal(result.items.length,expected?1:0);cases++;
  if(expected){assert.equal(result.items[0].componentModel,text);assert.ok(!result.items[0].userConfirmedTransmissionModel);assert.equal(result.items[0].automaticSelectionEligible,false);assert.equal(result.transmissionComponentOptions,undefined);assert.equal(result.transmissionConditionsToReview,undefined);}
 }
 for(const mutation of [
  {componentModel:text+' LSD'},
  {run:{...row.run,gatesJson:{...row.run.gatesJson,transmissionTypeCountPolicy:undefined}}},
  {provenanceJson:{...row.provenanceJson,explicitTransmissionTypeCount:undefined}},
  {provenanceJson:{...row.provenanceJson,sourceTransmissionContext:{...source,transmissionGearCount:99}}},
  {provenanceJson:{...row.provenanceJson,sourceTransmissionContext:{...source,evidence:{...source.evidence,systemName:'МАСЛО в РОБОТ-6'}}}},
  {provenanceJson:{...row.provenanceJson,sourceTransmissionContext:{...source,hasAdditionalLabelConditions:true}}},
  {provenanceJson:{...row.provenanceJson,sourceTransmissionContext:{...source,issues:['GEAR_COUNT_CONFLICT']}}}
 ])assert.equal(profile([{...row,...mutation}],parsed.type,context).items.length,0);
 for(const wrong of [{productionMonth:'2014-12'},{productionMonth:'2021-01'},{model:'WRONG'}])assert.equal(profile([row],parsed.type,{...context,...wrong}).items.length,0);
}
console.log(`Source type/count opt-in PASS: ${cases} combinations, no inferred model, malformed/conflicting/evidence gates rejected`);
