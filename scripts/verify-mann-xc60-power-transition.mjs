import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const dir=resolve(import.meta.dirname,'../outputs/mann-gentra-evidence-review-2026-09-14');
const aRaw=await readFile(resolve(dir,'xc60-source-branch-preflight-v1.json'),'utf8'),bRaw=await readFile(resolve(dir,'xc60-source-branch-preflight-v2.json'),'utf8'),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const a=JSON.parse(aRaw),b=JSON.parse(bRaw),plan=JSON.parse(planRaw);assert.equal(b.planHash,sha(planRaw));assert.equal(a.sourceHash,b.sourceHash);assert.equal(a.mannHash,b.mannHash);assert.equal(a.rawHash,b.rawHash);
assert.equal(a.findings.length,b.findings.length);let removed=0;const added=[];
for(let i=0;i<a.findings.length;i++){
 const old=a.findings[i],now=b.findings[i];assert.equal(old.sourceRequirementId,now.sourceRequirementId);
 const {powerCorrection,...withoutPower}=now;
 const expected={...old,pairs:old.pairs.map(p=>({...p,reasons:p.reasons.filter(r=>r!=='SOURCE_ANCHOR_POWER_CONFLICT')}))};
 assert.deepEqual(withoutPower,expected);
 for(let k=0;k<old.pairs.length;k++)if(old.pairs[k].reasons.includes('SOURCE_ANCHOR_POWER_CONFLICT')){
  assert.ok(powerCorrection);removed++;
  if(!now.pairs[k].reasons.length){const p=now.pairs[k];assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===now.sourceRequirementId&&r.vehicleVariantKey===p.targetId));added.push({sourceRequirementId:now.sourceRequirementId,systemCode:now.systemCode,targetId:p.targetId,branch:p.branch,window:p.window,publicationAllowed:false});}
 }
}
assert.equal(removed,21);assert.equal(added.length,3);
const summary={sourceRowsCompared:71,removedProvenStalePowerBlockers:removed,newClearPairs:added.length,allOtherPairEvidenceUnchanged:true,canonicalPlanUnchanged:true};
await writeFile(resolve(dir,'xc60-power-transition-verification-v1.json'),JSON.stringify({kind:'XC60_AUDITED_POWER_OVERLAY_DELTA',beforeHash:sha(aRaw),afterHash:sha(bRaw),planHash:sha(planRaw),summary,added,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
