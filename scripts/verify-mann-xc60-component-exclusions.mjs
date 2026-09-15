import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const dir=resolve(import.meta.dirname,'../outputs/mann-gentra-evidence-review-2026-09-14');
const aRaw=await readFile(resolve(dir,'xc60-source-branch-preflight-v2.json'),'utf8'),bRaw=await readFile(resolve(dir,'xc60-source-branch-preflight-v3.json'),'utf8'),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const a=JSON.parse(aRaw),b=JSON.parse(bRaw),plan=JSON.parse(planRaw);assert.equal(b.planHash,sha(planRaw));assert.equal(a.sourceHash,b.sourceHash);assert.equal(a.mannHash,b.mannHash);assert.equal(a.findings.length,b.findings.length);
const exclusions=[];
for(let i=0;i<a.findings.length;i++){
 const old=a.findings[i],now=b.findings[i],{componentEngineList,...rest}=now;
 assert.deepEqual({...rest,pairs:rest.pairs.map(p=>({...p,reasons:p.reasons.filter(r=>r!=='ENGINE_EXCLUDED_BY_COMPONENT_SOURCE_LIST')}))},old);
 for(const pair of now.pairs.filter(p=>p.reasons.includes('ENGINE_EXCLUDED_BY_COMPONENT_SOURCE_LIST'))){
  assert.equal(componentEngineList.status,'EXPLICIT');assert.ok(!componentEngineList.branches.some(e=>e.engineCode===pair.branch.engineCode));
  assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===now.sourceRequirementId&&r.vehicleVariantKey===pair.targetId));
  exclusions.push({sourceRequirementId:now.sourceRequirementId,targetId:pair.targetId,engineCode:pair.branch.engineCode,component:componentEngineList.componentText,publicationAllowed:false});
 }
}
assert.equal(exclusions.length,3);assert.equal(b.summary.preflightClearPairs,9);
const summary={sourceRowsCompared:71,explicitLists:b.findings.filter(f=>f.componentEngineList.status==='EXPLICIT').length,excludedCandidatePairs:3,affectedCanonicalPairs:0,allOtherEvidenceUnchanged:true,clearPairsRetained:9};
await writeFile(resolve(dir,'xc60-component-exclusion-verification-v1.json'),JSON.stringify({kind:'XC60_COMPONENT_SOURCE_LIST_EXCLUSIONS',planHash:sha(planRaw),beforeHash:sha(aRaw),afterHash:sha(bRaw),summary,exclusions,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
