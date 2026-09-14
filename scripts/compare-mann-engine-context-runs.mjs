import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const dir=resolve(import.meta.dirname,'../outputs/mann-identity-scoped-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--literal-lines'));
const literalLines=process.argv[2]==='--literal-lines';
const broadRaw=await readFile(resolve(dir,literalLines?'source-engine-branch-recheck-v1.json':'large-engine-list-diagnostic-v1.json'),'utf8'),narrowRaw=await readFile(resolve(dir,literalLines?'engine-line-recheck-v1.json':'source-engine-branch-recheck-v1.json'),'utf8');
const broad=JSON.parse(broadRaw),narrow=JSON.parse(narrowRaw);
assert.equal(broad.sourceHash,narrow.sourceHash);assert.equal(broad.mannHash,narrow.mannHash);
assert.equal(broad.identityCorrections.sha256,narrow.identityCorrections.sha256);
const key=r=>`${r.requirementId}:${r.engineCode}:${r.vehicleVariantKey}`;
const oldRows=broad.results.flatMap(r=>r.outcomes.filter(o=>o.status===(literalLines?'ENGINE_CONTEXT_MATCH_CANDIDATE':'SINGLE_ENGINE_MATCH_DIAGNOSTIC')).map(o=>({...o,engineCode:o.engineCode??r.engineCode,requirementId:r.requirementId})));
const newRows=narrow.results.flatMap(r=>r.outcomes.filter(o=>o.status==='ENGINE_CONTEXT_MATCH_CANDIDATE').map(o=>({...o,requirementId:r.requirementId,engineCode:r.engineCode,engineAnchorRowId:r.engineAnchorRowId,sourceScope:r.scope})));
const oldMap=Map.groupBy(oldRows,key),newMap=Map.groupBy(newRows,key);
const removed=[...oldMap.keys()].filter(k=>!newMap.has(k)).map(k=>({key:k,previous:oldMap.get(k)}));
const added=[...newMap.keys()].filter(k=>!oldMap.has(k)).map(k=>({key:k,current:newMap.get(k)}));
const shared=[];
for(const [k,rows] of newMap){
  const previous=oldMap.get(k);if(!previous)continue;
  for(const row of rows){
    const now=row.window.intersection;
    assert.ok(previous.some(old=>{
      const before=old.window.intersection;
      return (now.from??'0000-00')>=(before.from??'0000-00')&&(now.to??'9999-99')<=(before.to??'9999-99');
    }),'Narrowed source context unexpectedly expanded a shared target date window');
  }
  shared.push({key:k,previous,current:rows});
}
const report={kind:'BROAD_VS_ENGINE_ANCHOR_DIAGNOSTIC_COMPARISON',broadHash:sha(broadRaw),narrowHash:sha(narrowRaw),productionApplyAllowed:false,
  summary:{broadPairs:oldMap.size,narrowPairs:newMap.size,retainedPairs:shared.length,removedPairs:removed.length,addedPairs:added.length,
    broadRequirements:new Set(oldRows.map(r=>r.requirementId)).size,narrowRequirements:new Set(newRows.map(r=>r.requirementId)).size},
  limitation:'Comparison of local candidates, not publication approval; removed broad matches must not be imported.',removed,added,shared};
await writeFile(resolve(dir,literalLines?'engine-line-run-comparison-v1.json':'engine-context-run-comparison-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
