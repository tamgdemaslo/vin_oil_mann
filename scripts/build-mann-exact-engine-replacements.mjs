import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-bmw-body-restored-preview-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--competitor-fix'));
const competitor=process.argv[2]==='--competitor-fix';
const [planRaw,proposalRaw,auditRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'exact-engine-scope-proposals-v2.json'),'utf8'),readFile(resolve(dir,competitor?'exact-engine-review-details-v2.json':'exact-engine-proposal-recheck-v1.json'),'utf8')]);
const plan=JSON.parse(planRaw),proposals=JSON.parse(proposalRaw),audit=JSON.parse(auditRaw);
assert.equal(proposals.planHash,sha(planRaw));assert.equal(audit.planHash,sha(planRaw));
assert.equal(audit.resolverHash,sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')));
const matcherHash=sha(await readFile(resolve(root,'src/lib/mann-fluid-matcher-v2.ts'),'utf8'));
assert.equal(audit.matcherHash,matcherHash,'Fresh builds require matcher-code-bound audit');
const byId=new Map(plan.newRevisions.map(r=>[r.id,r])),byProposal=new Map(proposals.proposals.map(r=>[r.originalRevisionId,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const replacements=[];let checks=0,bounded=0,open=0;
const runtime=r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,
  productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}});
for(const finding of audit.results.filter(r=>r.status==='NARROWED_TARGET_CONFIRMED')){
  const original=byId.get(finding.originalRevisionId),proposal=byProposal.get(finding.originalRevisionId);
  assert.equal(sha(original),finding.originalRevisionHash);assert.equal(sha(proposal),finding.proposalHash,'Core v2 proposal must equal audited v1');
  assert.equal(proposal.proposedCapacityBranches,null);
  const scope=proposal.proposedApplicability;
  assert.deepEqual({...scope,matchedEngineScope:original.applicabilityJson.matchedEngineScope},original.applicabilityJson);
  const excluded=[...new Set(proposal.residuals.flatMap(r=>r.excludedEngineCodes))];
  assert.deepEqual(new Set([...scope.matchedEngineScope,...excluded]),new Set(original.applicabilityJson.matchedEngineScope));
  assert.ok(!scope.matchedEngineScope.some(c=>excluded.includes(c)));
  const fingerprint=sha({policy:original.provenanceJson.catalogPreviewPolicy,sourceRequirementId:original.sourceRequirementId,
    vehicleVariantKey:original.vehicleVariantKey,applicability:scope,technicalData:original.technicalDataJson});
  const revision={...original,id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,applicabilityJson:scope,
    provenanceJson:{...original.provenanceJson,independentValidation:finding.validation,exactEngineNarrowing:{originalRevisionId:original.id,
      originalRevisionHash:sha(original),proposalHash:sha(proposal),auditHash:sha(auditRaw)},sourceTechnicalReviewRequired:true}};
  assert.equal(revision.applyEligible,false);assert.equal(revision.verificationStatus,'UNVERIFIED');
  const oldRuntime=runtime(original),newRuntime=runtime(revision),w=scope.window.intersection;
  const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
  const months=new Set();
  if(w.from&&w.to){for(let m=index(w.from)-1;m<=index(w.to)+1;m++)months.add(m);bounded++;}
  else{for(const s of [w.from,w.to].filter(Boolean))for(const delta of [-1,0,1])months.add(index(s)+delta);months.add(index('2000-01'));open++;}
  for(const m of months)for(const engineCode of [...scope.matchedEngineScope,...excluded,'WRONG']){
    const ctx={...scope.sourceVehicleScope,engineCode,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
    const output=profile([newRuntime],undefined,ctx).items;
    if(!scope.matchedEngineScope.includes(engineCode))assert.equal(output.length,0);
    else{
      const oldOutput=profile([oldRuntime],undefined,ctx).items;
      assert.equal(output.length,oldOutput.length);
      for(const field of ['capacities','specifications','viscosityGrades','recommendation','replacementInterval'])assert.deepEqual(output.map(r=>r[field]),oldOutput.map(r=>r[field]));
      for(const item of output)assert.equal(item.automaticSelectionEligible,false);
    }
    checks++;
  }
  replacements.push({originalRevisionId:original.id,originalRevisionHash:sha(original),revision,
    residuals:proposal.residuals,runtimeCoverage:w.from&&w.to?'ALL_BOUNDED_MONTHS_PLUS_NEIGHBORS':'OPEN_WINDOW_BOUNDARY_SAMPLES',publicationAllowed:false});
}
const report={planHash:sha(planRaw),proposalsHash:sha(proposalRaw),auditHash:sha(auditRaw),matcherHash,replacements,
  summary:{replacements:replacements.length,boundedWindows:bounded,openWindows:open,profileChecks:checks},productionApplyAllowed:false,
  limitation:'Unapplied semantic replacements; original technical/date/identity fields preserved, only engine subset changed. Open windows sampled, not exhaustive. Requires deduplication, predecessor reconciliation, residual ledger and joint verification.'};
await writeFile(resolve(dir,competitor?'exact-engine-replacement-supplement-v2.json':'exact-engine-replacement-supplement-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
