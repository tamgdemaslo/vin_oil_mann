import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const raw=await readFile(resolve(dir,'source-engine-branches-v1.json'),'utf8'),branches=JSON.parse(raw);
const snapshotRaw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(snapshotRaw),branches.snapshotHash);
const rows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {extractFluidEngineLineContext:extract,narrowFluidEngineLineScope:narrow}=await jiti.import('../src/lib/fluid-engine-line-context.ts');
const results=branches.results.map(branch=>{
  const row=rows.get(branch.engineAnchorRowId);assert.ok(row);assert.equal(sha(row),branch.engineAnchorRowHash);assert.ok(branch.scope);
  const context=extract(row.application??'',branch.engineCode),result=narrow(branch.scope,context);
  if(result.scope){
    for(const k of Object.keys(branch.scope).filter(k=>!['yearFrom','yearTo','powerHp','powerKw'].includes(k)))assert.deepEqual(result.scope[k],branch.scope[k]);
    assert.ok((result.scope.yearFrom??-Infinity)>=(branch.scope.yearFrom??-Infinity));
    assert.ok((result.scope.yearTo??Infinity)<=(branch.scope.yearTo??Infinity));
  }
  return {...branch,anchorScope:branch.scope,scope:result.scope,literalLineContext:context,reasons:result.reasons,
    status:result.scope?'LINE_SCOPED_NEEDS_REMATCH':'LINE_CONTEXT_REVIEW',publicationAllowed:false};
});
const report={kind:'LITERAL_ENGINE_LINE_SCOPES',branchHash:sha(raw),sourceHash:branches.sourceHash,snapshotHash:sha(snapshotRaw),
  helperHash:sha(await readFile(resolve(root,'src/lib/fluid-engine-line-context.ts'),'utf8')),productionApplyAllowed:false,
  summary:{branches:results.length,scoped:results.filter(r=>r.scope).length,changedScopes:results.filter(r=>r.scope&&sha(r.scope)!==sha(r.anchorScope)).length,
    review:results.filter(r=>!r.scope).length,reasons:Object.fromEntries([...Map.groupBy(results.flatMap(r=>r.reasons),r=>r)].map(([k,v])=>[k,v.length]))},
  limitation:'Source scopes only, not rematched or eligible revisions. Unparsed source conditions still require review; no technical fluid values changed.',results};
await writeFile(resolve(dir,'engine-line-scopes-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
