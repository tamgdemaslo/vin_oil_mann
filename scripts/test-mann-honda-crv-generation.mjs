import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const j=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {normalizeVehicleModel}=await j.import('../src/lib/vehicle-normalization.ts');
const {normalizeDecodedVehicleForTest:normalize,evaluateMannCandidate:evaluate,hasExactMannModelIdentity:exact}=await j.import('../src/lib/mann-vehicle-resolver.ts');
for(const generation of ['I','II','III','IV','V','VI'])for(const base of ['CR-V','CRV','CR V']){
  const parsed=normalizeVehicleModel(base+generation,'HONDA');
  assert.equal(parsed.canonical,'CR-V');assert.equal(parsed.generation,generation);
  assert.equal(normalizeVehicleModel('CR-V '+generation,'HONDA').generation,generation);
}
assert.equal(normalizeVehicleModel('CR-V','HONDA').generation,undefined);
assert.equal(normalizeVehicleModel('CR-VIII','TOYOTA').generation,undefined);
assert.notEqual(normalizeVehicleModel('CR-VII SPORT','HONDA').canonical,'CR-V');
const raw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(raw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const rows=parseCopy(raw,'mann_filter_applications').filter(r=>r.make==='HONDA'&&/^CR-V/.test(r.model));assert.ok(rows.length);
let concrete=0,generic=0;
for(const row of rows){
  const generation=normalizeVehicleModel(row.model,'HONDA').generation;assert.ok(generation);
  assert.ok(exact('CRV','HONDA',row));assert.equal(exact('HRV','HONDA',row),false);
  const v=normalize({makeRaw:'Honda',modelRaw:'CR-V',generationRaw:generation,sourceMethods:['manual']});
  const evaluation=evaluate(v,row),candidate=evaluation.candidate;
  if(!candidate){assert.deepEqual(evaluation.rejected.reasons,['общая применяемость MANN, не модификация автомобиля']);generic++;continue;}
  concrete++;assert.ok(candidate.matchedFields.includes('поколение'));
  const wrong=normalize({makeRaw:'Honda',modelRaw:'CR-V',generationRaw:generation==='II'?'III':'II',sourceMethods:['manual']});
  const rejected=evaluate(wrong,row);assert.ok(rejected.rejected||rejected.candidate.mismatchedFields.includes('поколение'));
}
assert.ok(concrete>0);
console.log(JSON.stringify({catalogRows:rows.length,concrete,generic,compactModelGenerationChecks:true,crossModelAndGenerationNegatives:true}));
