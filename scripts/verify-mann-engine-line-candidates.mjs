import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const [runRaw,branchRaw,supplementRaw,auditRaw,sourceRaw]=await Promise.all([
  readFile(resolve(dir,'engine-line-recheck-v1.json'),'utf8'),readFile(resolve(dir,'engine-line-scopes-v1.json'),'utf8'),
  readFile(resolve(dir,'engine-transmission-scopes-v1.json'),'utf8'),readFile(resolve(dir,'engine-line-transmission-audit-v1.json'),'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8')]);
const run=JSON.parse(runRaw),branches=JSON.parse(branchRaw),supplement=JSON.parse(supplementRaw),audit=JSON.parse(auditRaw);
assert.equal(run.branchHash,sha(branchRaw));assert.equal(supplement.branchHash,sha(branchRaw));
assert.equal(supplement.auditHash,sha(auditRaw));assert.equal(audit.branchHash,sha(branchRaw));
assert.equal(run.sourceHash,sha(sourceRaw));assert.equal(branches.sourceHash,sha(sourceRaw));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {mannTechnicalScopeMatches:matches}=await jiti.import('../src/lib/mann-technical-applicability.ts');
assert.equal(supplement.runtimeHash,sha(await readFile(resolve(root,'src/lib/mann-technical-applicability.ts'),'utf8')));
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
const key=r=>[r.requirementId,r.engineCode,r.engineAnchorRowId].join(':');
const byBranch=new Map(branches.results.map(r=>[key(r),r])),byCondition=new Map(supplement.results.map(r=>[key(r),r]));
const affected=new Set(audit.findings.map(key));
assert.deepEqual([...affected].sort(),[...byCondition.keys()].sort());
const candidates=[];let cases=0;
for(const result of run.results){
  const branch=byBranch.get(key(result));assert.ok(branch);assert.deepEqual(result.scope,branch.scope);
  for(const outcome of result.outcomes.filter(o=>o.status==='ENGINE_CONTEXT_MATCH_CANDIDATE')){
    assert.ok(branch.scope);assert.equal(branch.reasons.length,0);
    const source=sources.get(result.requirementId);assert.ok(source);assert.equal(sha(source),branch.sourceHash);
    const validation=outcome.validation;assert.ok(validation?.independentlyValidated);
    assert.equal(validation.vehicleVariantKey,outcome.vehicleVariantKey);
    assert.deepEqual(validation.hardConflicts,[]);assert.deepEqual(validation.reviewBlockers,[]);assert.deepEqual(outcome.reasons,[]);
    const condition=byCondition.get(key(result));
    if(affected.has(key(result))){assert.ok(condition);assert.deepEqual(condition.reasons,[]);assert.ok(condition.requiredTransmission);}
    const applicability={sourceVehicleScope:result.sourceVehicleScope,matchedEngineScope:[result.engineCode],window:outcome.window,
      ...(condition?{requiredTransmission:condition.requiredTransmission}:{})};
    const month=outcome.window.intersection.from??outcome.window.intersection.to;
    assert.ok(month,'Candidate requires a concrete month for replay');
    const context={...result.sourceVehicleScope,engineCode:result.engineCode,productionMonth:month,
      ...(condition?{confirmedTransmissionType:condition.requiredTransmission.type,transmissionGearCount:condition.requiredTransmission.gearCount}:{})};
    assert.equal(matches(applicability,context),true);cases++;
    assert.equal(matches(applicability,{...context,engineCode:'WRONG_ENGINE'}),false);cases++;
    assert.equal(matches(applicability,{...context,model:'WRONG_MODEL'}),false);cases++;
    if(condition){
      assert.equal(matches(applicability,{...context,confirmedTransmissionType:undefined}),false);cases++;
      assert.equal(matches(applicability,{...context,transmissionGearCount:undefined}),false);cases++;
      assert.equal(matches(applicability,{...context,transmissionGearCount:condition.requiredTransmission.gearCount+1}),false);cases++;
    }
    candidates.push({requirementId:source.id,systemCode:source.systemCode,vehicleVariantKey:outcome.vehicleVariantKey,
      engineAnchorRowId:result.engineAnchorRowId,engineCode:result.engineCode,sourceHash:sha(source),
      sourceAssociationFingerprint:outcome.originalAssociationFingerprint,applicability,sourceEngineScope:branch.scope,
      validation,publicationAllowed:false,sourceTechnicalReviewRequired:true});
  }
}
const report={kind:'ENGINE_LINE_CANDIDATE_SCOPE_REPLAY',runHash:sha(runRaw),branchHash:sha(branchRaw),supplementHash:sha(supplementRaw),sourceHash:sha(sourceRaw),
  productionApplyAllowed:false,summary:{candidateContexts:candidates.length,sourceRequirements:new Set(candidates.map(r=>r.requirementId)).size,
    withTransmissionCondition:candidates.filter(r=>r.applicability.requiredTransmission).length,scopeReplayCases:cases,issues:0},
  limitation:'Applicability replay only, not publication revisions or full technical/source verification. Anchor alternatives preserved separately. Full profile composition and remaining source conditions must be checked.',candidates};
await writeFile(resolve(dir,'engine-line-candidate-scope-replay-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
