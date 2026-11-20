import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
const mock=resolve('scripts/fixtures/mann-fluid-research-mocks.mjs');
const j=createJiti(import.meta.url,{alias:{'@':resolve('src'),'@/lib/db':mock,'@/lib/openai-client':mock,'@/lib/branch-api':mock}});
const {selectSavedVehicleTechnicalConfirmation:select,loadSavedVehicleTechnicalConfirmation:load,savedTransmissionClass:type}=await j.import('../src/lib/mann-saved-vehicle-confirmation.ts');
const vin='WDB2030451A000001',ctx={make:'Mercedes-Benz',model:'C-Klasse',year:2001,engineCode:'M111.955',transmissionType:'REAR_DRIVE',transmissionName:'AUTOMATIC',driveType:'RWD'};
const proof={source:'vehicle_card',confidence:'HIGH',verificationStatus:'CONFIRMED',updatedAt:'2026-11-20T09:00:00.000Z'};
const passport={branchId:'branch1',vin,status:'ACTIVE',verificationStatus:'CONFIRMED',make:'Mercedes-Benz',model:'C-Klasse',year:2001,engineCode:'M111.955',transmissionType:'АКПП',driveType:'Задний',fieldSourcesJson:{transmissionType:proof,driveType:proof}};
const read=rows=>select({branchId:'branch1',vin,vehicleContext:ctx,passports:rows});
assert.equal(read([passport]).transmissionType,'automatic');assert.equal(read([passport]).confirmedDrive,'2WD');
assert.deepEqual(read([passport]).conflicts,[]);
for (const update of [{branchId:'branch2'},{vin:'WDB2030451A139399'},{status:'ARCHIVED'},{verificationStatus:'AUTO_FILLED'},{fieldSourcesJson:{}},{fieldSourcesJson:{transmissionType:{...proof,verificationStatus:'AUTO_FILLED'},driveType:{...proof,confidence:'LOW'}}}]){
 const r=read([{...passport,...update}]);assert.equal(r.transmissionType,undefined);assert.equal(r.confirmedDrive,undefined);
}
for (const update of [{year:2002},{engineCode:'M111.951'},{make:'BMW'},{model:'E-Klasse'}]) {
 const r=read([{...passport,...update}]);assert.equal(r.transmissionType,undefined);assert.equal(r.confirmedDrive,undefined);assert.ok(r.conflicts.includes('identity'));
}
const conflict=read([passport,{...passport,transmissionType:'МКПП',driveType:'Передний'}]);
assert.equal(conflict.transmissionType,undefined);assert.equal(conflict.confirmedDrive,undefined);assert.deepEqual(new Set(conflict.conflicts),new Set(['transmission','drive']));
assert.equal(read([{...passport,transmissionType:'МКПП'}]).transmissionType,undefined,'decoder conflict not overridden');
assert.equal(read([{...passport,driveType:'Полный'}]).confirmedDrive,undefined);
assert.equal(select({branchId:'branch1',vin,vehicleContext:{...ctx,driveType:'FWD'},passports:[passport]}).confirmedDrive,undefined,'front/rear contradiction is not hidden by 2WD');
assert.equal(select({branchId:'branch1',vin,vehicleContext:{...ctx,driveType:'2WD'},passports:[passport]}).confirmedDrive,'2WD');
for (const label of ['FORWARD_CONTROL','ALL_WHEEL_DRIVE','REAR_DRIVE','AUTOMATIC MANUAL','CVT DSG','unknown'])assert.equal(type(label),undefined,label);
for (const [label,expected] of [['AUT','automatic'],['MECHANICAL','manual'],['VARIATOR','cvt'],['DSG','robot'],['АКПП','automatic']])assert.equal(type(label),expected);
assert.equal(select({branchId:'branch1',vin,vehicleContext:{...ctx,make:undefined},passports:[passport]}).transmissionType,undefined);
const {prisma}=await j.import('./fixtures/mann-fluid-research-mocks.mjs');let calls=0;
prisma.clientVehicle={findMany:async({where})=>{calls++;assert.deepEqual(where,{branchId:'branch1',vin,status:'ACTIVE'});return[passport];}};
assert.equal((await load({branchId:'branch1',vin,vehicleContext:ctx})).transmissionType,'automatic');assert.equal(calls,1);
await load({branchId:'branch1',vin:'bad-vin',vehicleContext:ctx});assert.equal(calls,1);
console.log('PASS saved passport confirmation: scoped exact VIN, per-field proof, identity/decoder conflict, distinct CVT/robot and no model/gear inference');
// Exercise the authenticated technical-profile entry point and saved scope.
const s=globalThis.fluidResearchTest={applications:[],rows:[],sources:[],requirements:[],links:[],calls:0,branchContext:{branchId:'branch1',organizationId:'org1'}};
const {POST}=await j.import('../src/app/api/mann-catalog/technical-profile/route.ts');
let selectedType,selectedContext;
const {createMaintenanceVinProfileLoader}=await import('./lib/maintenance-vin-profile.mjs');
const original={make:'KIA',model:'Rio',engineCode:'ABC'};
const loaded=await createMaintenanceVinProfileLoader({organization:'org1','match-only':true},{
 getMannUnifiedTechnicalProfile:async(_keys,type,context)=>{selectedType=type;selectedContext=context;return {items:[]};},
 withMannEngineOilReference:p=>p,addMannResearchCatalogToProfile:async input=>{assert.equal(input.transmissionType,'automatic');assert.equal(input.vehicleContext.confirmedTransmissionType,'automatic');assert.equal(input.materializeSaved,false);return input.profile;}
})(['key'],original,'automatic');
assert.equal(selectedType,'automatic');assert.equal(selectedContext.confirmedTransmissionType,'automatic');assert.equal(original.confirmedTransmissionType,undefined);assert.deepEqual(loaded,{items:[]});
const post=async extra=>{const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({variantKeys:['key'],vin,vehicleContext:{make:ctx.make,model:ctx.model,year:ctx.year,engineCode:ctx.engineCode},decodedPowertrain:{transmissionType:ctx.transmissionType,transmissionName:ctx.transmissionName,driveType:ctx.driveType},...extra})}));assert.equal(response.status,200);return response.json();};
const restored=await post({});assert.equal(restored.selectedTransmissionType,'automatic');assert.equal(restored.savedVehicleConfirmation.confirmedDrive,'2WD');
const explicit=await post({transmissionType:'manual'});assert.equal(explicit.selectedTransmissionType,'manual','new explicit choice takes precedence over saved choice');
const withoutVin=await post({vin:undefined});assert.equal(withoutVin.selectedTransmissionType,undefined);assert.equal(withoutVin.savedVehicleConfirmation,undefined);
prisma.clientVehicle.findMany=async()=>[{...passport,transmissionType:'МКПП'}];
const disagrees=await post({});assert.equal(disagrees.selectedTransmissionType,undefined);assert.match(disagrees.notice,/расходятся/);
prisma.clientVehicle.findMany=async()=>{throw Error('private DB diagnostic');};
const unavailable=await post({});assert.equal(unavailable.selectedTransmissionType,undefined);assert.match(unavailable.notice,/недоступны/);assert.doesNotMatch(JSON.stringify(unavailable),/private DB diagnostic/);
assert.equal(s.calls,0);
console.log('PASS authenticated profile restores saved selection, explicit override, missing VIN, conflict/failure notices; batch forwards same selected scope, no AI');
