import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
const j=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {explicitMannTransmissionModelYears:parse}=await j.import('../src/lib/mann-transmission-model-list.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const policy='EXPLICIT_SOURCE_MODEL_YEAR_RANGE_V1';
for(const invalid of [null,'A343F','6AT / 1998-2002','A343F / 2002-1998','A343F / 98-02','A343F / 1998-2002 LSD','A343F / A750F / 1998-2002','A343F (1998-2002)'])assert.equal(parse(invalid),null);
const plan=JSON.parse(await readFile(new URL('../outputs/mann-equipment-drive-added-preview-2026-09-14/plan.json',import.meta.url),'utf8'));
const base=plan.newRevisions.find(r=>r.systemCode==='AUTOMATIC_TRANSMISSION'&&r.provenanceJson.conditionalTransmissionPolicy);assert.ok(base);
const rows=[['A343F / 1998-2002',4],['A750F / 2002-2007',5]].map(([componentModel,count])=>{
 const range=parse(componentModel);return {...base,id:`TEST-${range.model}`,sourceRequirementId:`TEST-${range.model}`,componentModel,createdAt:new Date(),reviewConfirmed:false,
  applicabilityJson:{sourceVehicleScope:{make:'toyota',model:'land cruiser',generation:'X'},matchedEngineScope:['2UZFE'],componentModel,transmissionType:'automatic',transmissionGearCount:count,window:{intersection:{from:`${range.yearFrom}-01`,to:`${range.yearTo}-12`}}},
  provenanceJson:{...base.provenanceJson,explicitTransmissionModelList:{policy,sourceComponentModel:componentModel,models:[range.model],modelYearRange:range}},
  run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalTransmissionPolicy:'USER_CONFIRMED_TRANSMISSION_V1',transmissionModelListPolicy:policy,automaticProductSelection:false}}
 };
});
let cases=0,positive=0;
for(let year=1997;year<=2008;year++)for(let m=1;m<=12;m++)for(const row of rows){
 const range=parse(row.componentModel),context={...row.applicabilityJson.sourceVehicleScope,engineCode:'2UZFE',productionMonth:`${year}-${String(m).padStart(2,'0')}`,transmissionModel:range.model,transmissionGearCount:row.applicabilityJson.transmissionGearCount};
 for(const mutation of [{},{engineCode:'WRONG'},{transmissionModel:undefined},{transmissionModel:'WRONG'},{transmissionGearCount:undefined},{transmissionGearCount:99}]){
  const expected=Object.keys(mutation).length===0&&year>=range.yearFrom&&year<=range.yearTo;
  const items=profile(rows,'automatic',{...context,...mutation}).items;assert.equal(items.length,expected?1:0);cases++;
  if(expected){positive++;assert.equal(items[0].revisionId,row.id);assert.equal(items[0].componentModel,row.componentModel);assert.equal(items[0].automaticSelectionEligible,false);}
 }
}
for(const row of rows){
 const range=parse(row.componentModel),context={...row.applicabilityJson.sourceVehicleScope,engineCode:'2UZFE',year:2002,transmissionModel:range.model,transmissionGearCount:row.applicabilityJson.transmissionGearCount};
 for(const mutation of [
  {run:{...row.run,gatesJson:{...row.run.gatesJson,transmissionModelListPolicy:undefined}}},
  {provenanceJson:{...row.provenanceJson,explicitTransmissionModelList:{...row.provenanceJson.explicitTransmissionModelList,modelYearRange:{...range,yearTo:2099}}}},
  ...[{from:'1997-01',to:'2007-12'},{from:'2002-01',to:'2099-12'},{from:'2002-13',to:'2002-14'},{from:null,to:null}].map(intersection=>({applicabilityJson:{...row.applicabilityJson,window:{intersection}}}))
 ])assert.equal(profile([{...row,...mutation}],'automatic',context).items.length,0);
}
console.log(JSON.stringify({cases,positive,qualifiedYearBoundsPreserved:true,wrongModelCountEngineRejected:true,productionApplyAllowed:false}));
