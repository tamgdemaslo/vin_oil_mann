import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {mannEquipmentScopeMatches:matches,MANN_EQUIPMENT_CIRCUITS:circuits}=await jiti.import('../src/lib/mann-equipment-scope.ts');
const {mannTechnicalScopeMatches:full}=await jiti.import('../src/lib/mann-technical-applicability.ts');
for(const [circuit,systemCode] of Object.entries(circuits)){
  const scope={circuit,systemCode};
  assert.equal(matches(scope),false);assert.equal(matches(scope,[]),false);
  assert.equal(matches(scope,[{circuit}]),true);
  for(const wrong of Object.keys(circuits).filter(k=>k!==circuit))assert.equal(matches(scope,[{circuit:wrong,drive:'4WD'}]),false);
  assert.equal(matches({...scope,systemCode:'WRONG'},[{circuit}]),false);
  assert.equal(matches(scope,[{circuit},{circuit}]),false);
  for(const drive of ['2WD','4WD']){
    assert.equal(matches({...scope,drive},[{circuit}]),false);
    assert.equal(matches({...scope,drive},[{circuit,drive}]),true);
    assert.equal(matches({...scope,drive},[{circuit,drive:drive==='2WD'?'4WD':'2WD'}]),false);
  }
}
const scope={systemCode:'TRANSFER_CASE',circuit:'TRANSFER_CASE',drive:'4WD',attachedTransmissionType:'automatic'};
assert.equal(matches(scope,[{circuit:'TRANSFER_CASE',drive:'4WD'}]),false);
assert.equal(matches(scope,[{circuit:'TRANSFER_CASE',drive:'4WD',attachedTransmissionType:'manual'}]),false);
assert.equal(matches(scope,[{circuit:'TRANSFER_CASE',drive:'4WD',attachedTransmissionType:'automatic'}]),true);
for(const invalid of [null,{},[],{circuit:'ELECTRIC_STEERING',systemCode:'POWER_STEERING'},{...scope,drive:'AWD'},{...scope,unknown:true}])assert.equal(matches(invalid,[scope]),false);
const applicability={requiredEquipment:scope,matchedEngineScope:['CAXA'],sourceVehicleScope:{make:'VW',model:'Golf',generation:'VI'},window:{intersection:{from:'2012-01',to:'2013-12'}}};
const context={make:'VW',model:'Golf',generation:'VI',engineCode:'CAXA',year:2013,confirmedEquipment:[{circuit:'TRANSFER_CASE',drive:'4WD',attachedTransmissionType:'automatic'}]};
assert.equal(full(applicability,context),true);
for(const wrong of [{engineCode:'WRONG'},{year:2014},{model:'Polo'},{confirmedEquipment:undefined}])assert.equal(full(applicability,{...context,...wrong}),false);
console.log('Exact equipment circuit, drive, attached transmission and vehicle scope gates passed');
