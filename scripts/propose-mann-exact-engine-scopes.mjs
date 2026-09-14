import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-bmw-body-restored-preview-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--capacity-top-scope'));
const capacityTop=process.argv[2]==='--capacity-top-scope';
const [raw,auditRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'engine-scope-excess-classification-v1.json'),'utf8')]);
const plan=JSON.parse(raw),audit=JSON.parse(auditRaw);assert.equal(audit.planHash,sha(raw));
const byId=new Map(plan.newRevisions.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const proposals=[];let profileChecks=0;
for(const [id,entries] of Map.groupBy(audit.results,r=>r.revisionId)){
  const original=byId.get(id);assert.ok(original);assert.ok(entries.every(e=>e.revisionHash===sha(original)));
  const proposed=structuredClone(original),residuals=[];
  for(const entry of entries){
    assert.ok(entry.exactTargetEngineScope.length);
    const scope=proposed.technicalDataJson.capacityBranches?.[entry.scopeIndex]?.applicabilityJson??proposed.applicabilityJson;
    assert.deepEqual(scope.matchedEngineScope,entry.matchedEngineScope);
    residuals.push({scopeIndex:entry.scopeIndex,originalScope:structuredClone(scope),excludedEngineCodes:entry.unsupported});
    scope.matchedEngineScope=entry.exactTargetEngineScope;
  }
  const capacityBranch=Boolean(proposed.technicalDataJson.capacityBranches);
  if(capacityBranch&&capacityTop){
    const union=[...new Set(proposed.technicalDataJson.capacityBranches.flatMap(b=>b.applicabilityJson.matchedEngineScope))];
    const before=proposed.applicabilityJson.matchedEngineScope;
    assert.ok(union.every(c=>before.includes(c)));
    proposed.applicabilityJson.matchedEngineScope=union;
  }
  if(!capacityBranch){
    assert.deepEqual(proposed.technicalDataJson,original.technicalDataJson);
    const runtime={...proposed,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',
      independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:proposed.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}};
    const scope=proposed.applicabilityJson,productionMonth=scope.window?.intersection?.from??scope.window?.intersection?.to;
    for(const engineCode of scope.matchedEngineScope){
      assert.equal(profile([runtime],undefined,{...scope.sourceVehicleScope,engineCode,productionMonth}).items.length,1);profileChecks++;
    }
    for(const engineCode of residuals.flatMap(r=>r.excludedEngineCodes)){
      assert.equal(profile([runtime],undefined,{...scope.sourceVehicleScope,engineCode,productionMonth}).items.length,0);profileChecks++;
    }
  }
  // Proposed payload is deliberately not a staged revision: do not reuse its
  // original identity after a semantic scope change.
  proposals.push({originalRevisionId:id,originalRevisionHash:sha(original),sourceRequirementId:original.sourceRequirementId,
    vehicleVariantKey:original.vehicleVariantKey,proposedApplicability:proposed.applicabilityJson,
    proposedCapacityBranches:proposed.technicalDataJson.capacityBranches??null,residuals,
    status:capacityBranch?'CAPACITY_BRANCH_REPLAY_REQUIRED':'ENDPOINT_ENGINE_GATES_PASSED',publicationAllowed:false});
}
const report={planHash:sha(raw),classificationHash:sha(auditRaw),proposals,summary:{proposals:proposals.length,profileChecks,
  statuses:Object.fromEntries([...Map.groupBy(proposals,r=>r.status)].map(([k,v])=>[k,v.length]))},productionApplyAllowed:false,
  limitation:'Non-applied scope proposals with retained original/residual scopes. Core endpoint checks only; source identity/fullmake, aliases, all-month and capacity-branch checks, semantic IDs and predecessor reconciliation still required.'};
await writeFile(resolve(dir,capacityTop?'exact-engine-scope-proposals-v2.json':'exact-engine-scope-proposals-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
