import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const read=async p=>{const raw=await readFile(p,'utf8');return {raw,data:JSON.parse(raw)}};
const recheck=await read(resolve(dir,'date-volvo-anchor-recheck-v1.json')),old=await read(resolve(dir,'confirmed-date-fluid-preflight-v1.json')),plan=await read(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'));
assert.equal(sha(plan.raw),recheck.data.planHash);assert.equal(sha(old.raw),recheck.data.oldPreflightHash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),plan.data.inputHashes.source);
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const findings=[];
for(const x of recheck.data.findings.filter(f=>f.allAnchorsParsed&&f.exactEnginePowerWindowBranches.length===1)){
 const f=old.data.findings.find(f=>f.sourceRequirementId===x.sourceRequirementId),s=sources.get(f.sourceRequirementId),branch=x.exactEnginePowerWindowBranches[0];
 assert.equal(sha(s),f.sourceHash);assert.equal(x.alreadyDrafted,false);
 const reasons=f.reasons.filter(r=>!['UNPARSED_ENGINE_APPLICATION','EXACT_UNIQUE_ENGINE_POWER_DATE_BRANCH_NOT_PROVEN'].includes(r));
 if(s.systemCode==='ENGINE_OIL'&&branch.anchorRowId===s.sourceRowId){const i=reasons.indexOf('OWN_ENGINE_APPLICATION_NOT_PROVEN');if(i>=0)reasons.splice(i,1);}
 if(branch.driveCondition)reasons.push('SOURCE_DRIVE_REQUIRES_EQUIPMENT_SCOPE');
 if(/Для\s+двс\s+/iu.test(s.specificationText??''))reasons.push('ENGINE_CONDITIONAL_SPECIFICATIONS_REQUIRE_SEPARATION');
 findings.push({...f,branch,scope:{...f.scope,...(branch.requiredMarket?{requiredMarket:branch.requiredMarket}:{})},reasons:[...new Set(reasons)],status:reasons.length?'HOLD':'READY_FOR_SCOPED_DRAFT'});
}
assert.equal(findings.length,9);assert.equal(findings.filter(f=>!f.reasons.length).length,1);
assert.equal(findings.find(f=>!f.reasons.length).sourceRequirementId,'68a9cb6c34211a219ea8cc99072221a96bf4edd7d73f9e9d3b73871aae270572');
const summary={pairs:9,ready:1,held:8,reasons:Object.fromEntries([...Map.groupBy(findings.flatMap(f=>f.reasons),r=>r)].map(([r,a])=>[r,a.length]))};
await writeFile(resolve(dir,'recovered-volvo-fluid-preflight-v1.json'),JSON.stringify({...old.data,kind:'RECOVERED_VOLVO_FLUID_PREFLIGHT',planHash:sha(plan.raw),recheckHash:sha(recheck.raw),oldPreflightHash:sha(old.raw),summary,findings},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
