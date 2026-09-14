import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const dir=resolve(import.meta.dirname,'../outputs/mann-mercedes-transmission-list-preview-2026-09-14');
const [oldRaw,newRaw]=await Promise.all(['toyota-current-replay-v1.json','toyota-az-fix-replay-v1.json'].map(f=>readFile(resolve(dir,f),'utf8')));
const old=JSON.parse(oldRaw),current=JSON.parse(newRaw);
for(const key of ['sourceHash','mannHash','planHash','coverageHash'])assert.equal(old[key],current[key]);
for(const key of ['mann-fluid-matcher-v2.ts','mann-vehicle-resolver.ts'])assert.equal(old.codeHashes[key],current.codeHashes[key]);
assert.notEqual(old.codeHashes['mann-engine-code-list.ts'],current.codeHashes['mann-engine-code-list.ts']);
const byId=new Map(current.results.map(r=>[r.sourceRequirementId,r]));assert.equal(byId.size,old.results.length);
const changed=[],added=[],removed=[];
for(const previous of old.results){
 const next=byId.get(previous.sourceRequirementId);assert.ok(next);assert.equal(previous.replayedSourceHash,next.replayedSourceHash);
 if(JSON.stringify(previous)!==JSON.stringify(next))changed.push({sourceRequirementId:previous.sourceRequirementId,before:previous,after:next});
 for(const key of next.confirmedTargets)if(!previous.confirmedTargets.includes(key))added.push({sourceRequirementId:next.sourceRequirementId,key});
 for(const key of previous.confirmedTargets)if(!next.confirmedTargets.includes(key))removed.push({sourceRequirementId:next.sourceRequirementId,key});
}
const probeId='9c005d68d7600a4a6426d2c38671b81781e128862e94b16ad2bdef11df3900a8';
const beforeProbe=old.results.find(r=>r.sourceRequirementId===probeId),afterProbe=byId.get(probeId);
assert.ok(beforeProbe.topCandidates.some(c=>c.engineCode==='1AZ-FE/FSE'&&c.matchedFields.includes('точный код двигателя')));
assert.ok(!afterProbe.topCandidates.some(c=>c.engineCode==='1AZ-FE/FSE'&&c.matchedFields.includes('точный код двигателя')));
const report={beforeHash:sha(oldRaw),afterHash:sha(newRaw),summary:{sources:byId.size,changedDiagnostics:changed.length,changedStatuses:changed.filter(r=>r.before.status!==r.after.status).length,addedConfirmedPairs:added.length,removedConfirmedPairs:removed.length,falseExactProbeCleared:true},added,removed,changed,productionApplyAllowed:false,limitation:'Full-Toyota differential, unchanged source/identity/other matcher code. Confirmed pairs are matcher outcomes, not publication or OEM approval.'};
await writeFile(resolve(dir,'toyota-az-replay-comparison-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
