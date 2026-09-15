import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
const j=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {mannTechnicalScopeMatches:matches}=await j.import('../src/lib/mann-technical-applicability.ts');
const {mannTechnicalContextFromVehicle:context}=await j.import('../src/lib/mann-technical-request-context.ts');
for(const requiredVehicleDrive of ['2WD','4WD'])for(const confirmedDrive of [undefined,'2WD','4WD','AWD','FWD',false,null])assert.equal(matches({requiredVehicleDrive},{confirmedDrive}),requiredVehicleDrive===confirmedDrive);
for(const requiredVehicleDrive of [undefined,null,'awd',['2WD','4WD'],{},false])assert.equal(matches({requiredVehicleDrive},{confirmedDrive:'2WD'}),false);
assert.equal(matches({},{}),true);
for(const driveType of ['awd','2WD','4WD'])assert.equal(context({driveType}).confirmedDrive,undefined,'Legacy/decoded field is not explicit confirmation');
assert.equal(context({driveType:'awd'},{confirmedDrive:'2WD'}).confirmedDrive,'2WD');
assert.equal(context({},{confirmedEquipment:[{circuit:'REAR_DIFFERENTIAL',drive:'4WD'}]}).confirmedDrive,undefined,'Component choice must not silently confirm whole vehicle');
const {buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const draft=JSON.parse(await readFile(new URL('../outputs/mann-current-full-rematch-2026-09-14-v2/recovered-volvo-fluid-drafts-v1.json',import.meta.url),'utf8')).newRevisions[0];
const row={...draft,applicabilityJson:{...draft.applicabilityJson,requiredVehicleDrive:'2WD'},createdAt:new Date(),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:draft.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}};
const base={...draft.applicabilityJson.sourceVehicleScope,engineCode:draft.applicabilityJson.matchedEngineScope[0],productionMonth:draft.applicabilityJson.window.intersection.from};
for(const confirmedDrive of [undefined,'2WD','4WD']){const result=profile([row],undefined,{...base,confirmedDrive});assert.equal(result.vehicleDriveRequired,true);assert.equal(result.items.length,confirmedDrive==='2WD'?1:0);}
for(const bad of [{engineCode:'WRONG'},{productionMonth:'1900-01'}])assert.equal(profile([row],undefined,{...base,...bad}).vehicleDriveRequired,undefined);
assert.equal(profile([{...row,run:{...row.run,status:'PLANNED'}}],undefined,base).vehicleDriveRequired,undefined);
assert.equal(profile([{...row,applicabilityJson:{...row.applicabilityJson,requiredVehicleDrive:'AWD'}}],undefined,base).vehicleDriveRequired,undefined);
const fixture=new URL('./fixtures/mann-market-route-stubs.mjs',import.meta.url).pathname;
const routeJ=createJiti(import.meta.url,{moduleCache:false,alias:{'@':new URL('../src',import.meta.url).pathname,'@/lib/branch-api':fixture,'@/lib/mann-unified-technical-profile':fixture}});
const {POST}=await routeJ.import('../src/app/api/mann-catalog/technical-profile/route.ts');
for(const confirmedDrive of [undefined,'2WD','4WD','AWD','FWD',null,false]){
 const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:['test'],vehicleContext:{confirmedDrive}})}));
 assert.equal(response.status,confirmedDrive===undefined||['2WD','4WD'].includes(confirmedDrive)?200:400);
 if(response.status===200)assert.equal((await response.json()).vehicleContext.confirmedDrive,confirmedDrive);
}
console.log('PASS strict whole-vehicle drive scope, unknown/malformed rejection, no legacy/component inference, actual POST schema');
