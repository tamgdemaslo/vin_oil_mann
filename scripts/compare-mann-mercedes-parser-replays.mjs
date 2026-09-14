import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-compressed-preview-2026-09-14');
const oldRaw=await readFile(resolve(dir,'mercedes-parser-legacy-replay-v1.json'),'utf8'),newRaw=await readFile(resolve(dir,'mercedes-parser-current-replay-v1.json'),'utf8');
const before=JSON.parse(oldRaw),after=JSON.parse(newRaw);
for(const field of ['sourceHash','mannHash','matcherHash','resolverHash'])assert.equal(before[field],after[field]);
assert.equal(before.results.length,523);assert.equal(after.results.length,523);
const prior=new Map(before.results.map(r=>[r.sourceRequirementId,r]));
const changes=[],regressions=[];let unchanged=0;
for(const fresh of after.results){
 const old=prior.get(fresh.sourceRequirementId);assert.ok(old);assert.equal(old.sourceHash,fresh.sourceHash);
 const added=fresh.confirmedTargets.filter(id=>!old.confirmedTargets.includes(id)),removed=old.confirmedTargets.filter(id=>!fresh.confirmedTargets.includes(id));
 const statusChanged=old.status!==fresh.status;
 if(removed.length)regressions.push({sourceRequirementId:fresh.sourceRequirementId,removed,before:old,after:fresh});
 if(added.length||removed.length||statusChanged)changes.push({sourceRequirementId:fresh.sourceRequirementId,systemCode:fresh.systemCode,added,removed,before:old,after:fresh});
 else unchanged++;
}
const report={legacyHash:sha(oldRaw),currentHash:sha(newRaw),summary:{sources:523,unchangedStatusAndConfirmedTargets:unchanged,changed:changes.length,regressions:regressions.length,
 addedTargets:changes.reduce((n,r)=>n+r.added.length,0),removedTargets:changes.reduce((n,r)=>n+r.removed.length,0)},changes,regressions,
 productionApplyAllowed:false,limitation:'Comparison covers all original Mercedes source records without later engine/date/condition overlays. Not whole-source multi-make clearance, recovered-source replay or technical verification.'};
await writeFile(resolve(dir,'mercedes-parser-comparison-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary));
