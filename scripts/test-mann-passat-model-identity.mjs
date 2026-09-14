import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(import.meta.dirname,'../src')}});
const {hasExactMannModelIdentity:exact}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
for(const model of ['Passat B5.5(3B3/3B6)','Passat B8(3G2,3G5)','Passat B6(3C2/3C5)/Passat CCB6(357)','Passat B7(362,365)']){
  assert.equal(exact('passat','VOLKSWAGEN',{model}),true,model);
  assert.equal(exact('golf','VOLKSWAGEN',{model}),false,model);
}
for(const model of ['Passat CC B6(357)','Passat CCB6(357)','Passat B8 Alltrack','Passat B10','Passat B5.6','Passat B8 Sport']){
  assert.equal(exact('passat','VOLKSWAGEN',{model}),false,model);
}
assert.equal(exact('passat','TOYOTA',{model:'Passat B8(3G2,3G5)'}),false);
assert.equal(exact('passat cc','VOLKSWAGEN',{model:'Passat B8(3G2,3G5)'}),false);
console.log('Passat base-model identity checks passed');
const {normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
for(const codes of [['3B3','3B6'],['3C2','3C5'],['3G2','3G5'],['8K2']]){
  const normalized=normalize({id:'body-regression',make:'volkswagen',model:'passat',systemCode:'ENGINE_OIL',bodyCodesJson:codes});
  assert.ok(normalized);assert.deepEqual(normalized.bodyCodes,codes);
}
console.log('Digit-leading body-code retention checks passed');
assert.deepEqual(normalize({id:'numeric-body',make:'volkswagen',model:'passat',systemCode:'ENGINE_OIL',bodyCodesJson:['362','365']}).bodyCodes,['362','365']);
assert.deepEqual(normalize({id:'numeric-other',make:'toyota',model:'camry',systemCode:'ENGINE_OIL',bodyCodesJson:['362','365']}).bodyCodes,[]);
assert.deepEqual(normalize({id:'numeric-power',make:'volkswagen',model:'passat',systemCode:'ENGINE_OIL',powerHp:362,powerKw:365}).bodyCodes,[]);
const {evaluateMannCandidate:evaluate}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {rowBodyCodes}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const sharedModel='Passat B6(3C2/3C5)/Passat CCB6(357)';
for(const [vehicleText,expected] of [['2.0TDI(357)',['357']],['2.0TDI(3C2/3C5)',['3C2','3C5']]]){
  const row={make:'VW (VOLKSWAGEN)',model:sharedModel,vehicleText,effectiveVehicleText:vehicleText,vehicleVariantKey:vehicleText,engineCode:'CBAB'};
  assert.deepEqual(rowBodyCodes(row),expected);
  for(const body of [['3C2','3C5'],['357']]){
    const v=normalize({id:'specific',make:'volkswagen',model:'passat',systemCode:'ENGINE_OIL',bodyCodesJson:body,engineCodeNormalized:'CBAB'});
    assert.equal(evaluate(v,row).candidate.matchedFields.includes('код кузова'),body.some(c=>expected.includes(c)));
  }
}
assert.deepEqual(rowBodyCodes({make:'VW (VOLKSWAGEN)',model:'Passat B7(362,365)/Passat CCB6(357)',vehicleText:'1.4TSI(362,365)'}),['362','365']);
for(const detail of ['2.0TDI','2.0TDI(140)','2.0TDI(UNKNOWN)']){
  assert.ok(rowBodyCodes({make:'VW (VOLKSWAGEN)',model:sharedModel,vehicleText:detail}).includes('3C2'));
}
const numericVehicle=normalize({id:'b7',make:'volkswagen',model:'passat',systemCode:'ENGINE_OIL',bodyCodesJson:['362','365'],engineCodeNormalized:'CAXA'});
for(const [model,expectMatch] of [['Passat B7(362,365)/Passat CCB6(357)',true],['Passat B6(3C2/3C5)/Passat CCB6(357)',false],['Passat CCB6(357)',false]]){
  const result=evaluate(numericVehicle,{make:'VW (VOLKSWAGEN)',model,vehicleVariantKey:model,engineCode:'CAXA'});
  assert.ok(result.candidate);
  assert.equal(result.candidate.matchedFields.includes('код кузова'),expectMatch,model);
}
for(const [text,codes] of [['3G2,3G5',['3G2','3G5']],['F22,F23',['F22','F23']],['3B3/3B6',['3B3','3B6']],['5K1/5,AJ5',['5K1','AJ5']]]){
  assert.deepEqual(normalize({id:'list-body',make:'volkswagen',model:'passat',systemCode:'ENGINE_OIL',bodyCodesJson:[text]}).bodyCodes,codes);
}
for(const text of ['2.0T8','2,0T8','1.6GT2','4X4','4X2','2WD','4WD']){
  const normalized=normalize({id:'non-body',make:'volkswagen',model:'passat',systemCode:'ENGINE_OIL',bodyCodesJson:[text]});
  assert.ok(normalized);assert.deepEqual(normalized.bodyCodes,[],text);
}
