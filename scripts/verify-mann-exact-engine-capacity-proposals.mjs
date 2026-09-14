import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-bmw-body-restored-preview-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--capacity-top-scope'));
const version=process.argv[2]==='--capacity-top-scope'?2:1;
const [raw,proposalRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,`exact-engine-scope-proposals-v${version}.json`),'utf8')]);
const plan=JSON.parse(raw),proposals=JSON.parse(proposalRaw);assert.equal(proposals.planHash,sha(raw));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const results=[];let checks=0;
const runtime=r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,
  productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,automaticProductSelection:false}}});
for(const proposal of proposals.proposals.filter(p=>p.status==='CAPACITY_BRANCH_REPLAY_REQUIRED')){
  const old=plan.newRevisions.find(r=>r.id===proposal.originalRevisionId);assert.equal(sha(old),proposal.originalRevisionHash);
  const revised={...old,applicabilityJson:proposal.proposedApplicability,technicalDataJson:{...old.technicalDataJson,capacityBranches:proposal.proposedCapacityBranches}};
  const originalRuntime=runtime(old),revisedRuntime=runtime(revised),before=checks;
  const accepted=new Set(proposal.proposedCapacityBranches.flatMap(b=>b.applicabilityJson.matchedEngineScope));
  for(const [i,branch] of proposal.proposedCapacityBranches.entries()){
    assert.deepEqual({...branch,applicabilityJson:old.technicalDataJson.capacityBranches[i].applicabilityJson},old.technicalDataJson.capacityBranches[i]);
    assert.equal(branch.condition.kind,'transmission');
    const scope=branch.applicabilityJson,w=scope.window.intersection,index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
    const originalEngines=old.technicalDataJson.capacityBranches[i].applicabilityJson.matchedEngineScope;
    for(let m=index(w.from)-1;m<=index(w.to)+1;m++)for(const engineCode of new Set([...originalEngines,'WRONG']))for(const type of [undefined,'manual','automatic','cvt']){
      const context={...scope.sourceVehicleScope,engineCode,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
      const output=profile([revisedRuntime],type,context).items;
      if(!accepted.has(engineCode))assert.equal(output.length,0);
      else{
        const prior=profile([originalRuntime],type,context).items;
        assert.equal(output.length,prior.length);
        assert.deepEqual(output.map(r=>r.capacities),prior.map(r=>r.capacities));
        assert.deepEqual(output.map(r=>r.specifications),prior.map(r=>r.specifications));
        for(const item of output)assert.equal(item.automaticSelectionEligible,false);
      }
      checks++;
    }
  }
  results.push({originalRevisionId:old.id,proposalHash:sha(proposal),profileChecks:checks-before,status:'CAPACITY_MONTH_ENGINE_CHOICES_PASSED',publicationAllowed:false});
}
const report={planHash:sha(raw),proposalsHash:sha(proposalRaw),results,summary:{revisions:results.length,profileChecks:checks},productionApplyAllowed:false,
  limitation:'Exact-engine narrowing preserves old numeric/spec outputs for accepted engines across branch months and gearbox choices. Not source fact correctness or fullmake validation; no changed revision is applied.'};
await writeFile(resolve(dir,`exact-engine-capacity-runtime-v${version}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
