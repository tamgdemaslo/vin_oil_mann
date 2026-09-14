import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
const j=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {mannEquipmentComponentDrives:parse,MANN_EQUIPMENT_COMPONENT_DRIVE_POLICY:policy}=await j.import('../src/lib/mann-equipment-scope.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const {extractFluidAggregateSourceContext:aggregate}=await j.import('../src/lib/fluid-aggregate-source-context.ts');
for(const bad of [null,'4WD','для AWD','для 4WD LSD','для 2WD или 4WD','для 4WD / 2000-2005','01R','HALDEX','для 4WD\nLSD'])assert.equal(parse(bad),null);
assert.deepEqual(parse(' для 2wd и 4wd '),['2WD','4WD']);
const old=JSON.parse(await readFile(new URL('../outputs/mann-identity-scoped-2026-09-14/conditional-equipment-plan-v1.json',import.meta.url),'utf8'));
const base=old.revisions.find(r=>r.systemCode==='REAR_DIFFERENTIAL');assert.ok(base);
let cases=0;
for(const text of ['для 2WD','для 4WD','для 2WD и 4WD']){
 const drives=parse(text),rows=drives.map(drive=>({...base,id:`TEST-${text}-${drive}`,componentModel:text,createdAt:new Date(),reviewConfirmed:false,
  applicabilityJson:{...base.applicabilityJson,componentModel:text,requiredEquipment:{systemCode:'REAR_DIFFERENTIAL',circuit:'REAR_DIFFERENTIAL',drive}},
  provenanceJson:{...base.provenanceJson,sourceAggregateContext:aggregate('МАСЛО в ЗАДНИЙ РЕДУКТОР',text),explicitComponentDriveCondition:{policy,sourceComponentModel:text,drives}},
  run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalEquipmentPolicy:old.policy,equipmentComponentDrivePolicy:policy,automaticProductSelection:false}}
 }));
 const scope=base.applicabilityJson,context={...scope.sourceVehicleScope,engineCode:scope.matchedEngineScope[0],productionMonth:scope.window.intersection.from};
 assert.equal(profile(rows,undefined,context).equipmentOptions.length,drives.length);
 for(const drive of [undefined,'2WD','4WD','AWD']){
  const c={...context,confirmedEquipment:[{circuit:'REAR_DIFFERENTIAL',drive}]};
  const shown=profile(rows,undefined,c);assert.equal(shown.items.length,drives.includes(drive)?1:0);cases++;
  if(shown.items.length){assert.equal(shown.items[0].userConfirmedEquipment.drive,drive);assert.equal(shown.items[0].automaticSelectionEligible,false);}
 }
 for(const row of rows){
  const c={...context,confirmedEquipment:[{circuit:'REAR_DIFFERENTIAL',drive:row.applicabilityJson.requiredEquipment.drive}]};
  for(const wrong of [{engineCode:'WRONG'},{productionMonth:'1800-01'},{confirmedEquipment:undefined},{confirmedEquipment:[...c.confirmedEquipment,...c.confirmedEquipment]}])assert.equal(profile([row],undefined,{...c,...wrong}).items.length,0);
  for(const mutation of [
   {componentModel:text+' LSD'},
   {run:{...row.run,gatesJson:{...row.run.gatesJson,equipmentComponentDrivePolicy:undefined}}},
   {provenanceJson:{...row.provenanceJson,explicitComponentDriveCondition:{...row.provenanceJson.explicitComponentDriveCondition,drives:['AWD']}}},
   {provenanceJson:{...row.provenanceJson,sourceAggregateContext:{...row.provenanceJson.sourceAggregateContext,requiredDrive:row.applicabilityJson.requiredEquipment.drive==='2WD'?'4WD':'2WD'}}},
   {provenanceJson:{...row.provenanceJson,sourceAggregateContext:{...row.provenanceJson.sourceAggregateContext,issues:['UNPARSED_LABEL_CONDITIONS']}}},
   {applicabilityJson:{...row.applicabilityJson,requiredEquipment:{...row.applicabilityJson.requiredEquipment,drive:undefined}}}
  ]){assert.equal(profile([{...row,...mutation}],undefined,c).items.length,0);cases++;}
 }
}
console.log(`Component drive opt-in, two separate branches, exact confirmation and residual-condition rejection PASS (${cases} primary cases)`);
