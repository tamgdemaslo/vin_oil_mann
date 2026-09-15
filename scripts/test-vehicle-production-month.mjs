import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
const j=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {toVehicle}=await j.import('../src/lib/vehicle-identity.ts');
const {mannTechnicalContextFromVehicle:context}=await j.import('../src/lib/mann-technical-request-context.ts');
const {consistentVehicleProductionMonth:consistent}=await j.import('../src/lib/vehicle-production-month.ts');
const {mannTechnicalScopeMatches:matches}=await j.import('../src/lib/mann-technical-applicability.ts');
for(const date of ['2021-06','2021-06-30']){
 const vehicle=toVehicle({Brand:'Haval',Model:'Jolion',EngineCode:'GW4G15K',ProduceDate:date},'tronk_vindecode');
 assert.equal(vehicle.productionMonth,'2021-06');assert.equal(vehicle.year,2021);
 const scope={matchedEngineScope:['GW4G15K'],window:{intersection:{from:'2021-06',to:'2021-12'}}};
 assert.equal(matches(scope,context(vehicle)),true);
 assert.equal(matches(scope,context({...vehicle,productionMonth:undefined})),false);
 assert.equal(matches(scope,context(vehicle,{productionMonth:'2021-05'})),false);
 assert.equal(context({...vehicle,productionMonth:undefined}).productionMonth,undefined);
}
for(const date of ['2021','2021-02-29','2021-04-31','2021-00','2021-13','06/07/2021','2021-06 to 2021-12','2021-06-01junk',202106,null,{}]){
 assert.equal(toVehicle({ProduceDate:date},'tronk_vindecode').productionMonth,undefined,JSON.stringify(date));
}
assert.equal(consistent(['2020-02-29','2020-02'],2020),'2020-02');
assert.equal(consistent(['2021-06','2021-07'],2021),undefined);
assert.equal(consistent(['2021-06'],2022),undefined);
assert.equal(toVehicle({ProduceDate:'2021-06',produce_date:'2021-07'},'tronk_vindecode').productionMonth,undefined);
for(const data of [{Year:2021},{ModelYear:2021},{StartYear:2021},{Year:2022,ProduceDate:'2021-06'}])assert.equal(toVehicle(data,'tronk_vindecode').productionMonth,undefined);
// Across the current plan, quantify date-gate improvements only, not full fluid approval.
const plan=JSON.parse(await readFile(new URL('../outputs/mann-gentra-evidence-review-2026-09-14/plan.json',import.meta.url),'utf8'));
let bounded=0,recovered=0;
assert.equal(plan.newRevisions.length,plan.summary.candidateRevisions);
for(const row of plan.newRevisions){
 const window=row.applicabilityJson?.window;
 const date=window?.intersection?.from;
 if(!date)continue;
 const vehicle=toVehicle({ProduceDate:date},'tronk_vindecode');
 if(!vehicle.productionMonth)continue;
 bounded++;
 const scope={window};
 if(matches(scope,context(vehicle))&&!matches(scope,context({...vehicle,productionMonth:undefined})))recovered++;
}
assert.ok(recovered>0);
console.log(JSON.stringify({boundedDraftDateProbes:bounded,dateGatesRecovered:recovered,limitation:'Synthetic provider fields and date-only gates; not real VINs or newly approved fluid records.'}));
