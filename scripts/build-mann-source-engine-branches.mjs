import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
const [raw,sourceRaw,snapshotRaw]=await Promise.all([readFile(resolve(dir,'large-engine-context-provenance-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const provenance=JSON.parse(raw);assert.equal(sha(sourceRaw),provenance.sourceHash);assert.equal(sha(snapshotRaw),provenance.snapshotHash);
assert.equal(sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8')),provenance.parserHash);
const source=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r])),rawRows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {prepareFluidCatalog}=await jiti.import('../src/lib/fluid-catalog.ts');
const {narrowFluidEngineContext:narrow}=await jiti.import('../src/lib/fluid-engine-context-branch.ts');
const prepared=new Map(prepareFluidCatalog({rowsNdjson:snapshotRaw,mannFiltersCsv:''}).requirements.map(r=>[r.id,r]));
const fields=['engineCodeNormalized','engineCodesJson','yearFrom','yearTo','engineVolumeCc','powerHp','powerKw','fuelType'];
const results=[];
for(const finding of provenance.findings){
  const r=source.get(finding.requirementId),row=rawRows.get(finding.sourceRowId);assert.ok(r&&row);
  assert.equal(sha(r),finding.sourceHash);assert.equal(sha(row),finding.rawRowHash);
  for(const branch of finding.branches)for(const evidence of branch.evidence){
    const anchor=prepared.get(evidence.engineRequirementId),anchorRow=rawRows.get(evidence.sourceRowId);assert.ok(anchor&&anchorRow);
    assert.equal(sha(anchorRow),evidence.rawRowHash);
    assert.deepEqual(Object.fromEntries(['yearFrom','yearTo','engineVolumeCc','powerHp','powerKw','fuelType'].map(k=>[k,anchor[k]])),evidence.context);
    const result=narrow(r,row,anchor,anchorRow,branch.engineCode);
    if(result.requirement){
      // Every non-scope field including source identity and technical data stays exact.
      for(const key of Object.keys(r).filter(k=>!fields.includes(k)))assert.deepEqual(result.requirement[key],r[key]);
    }
    const scope=result.requirement?Object.fromEntries(fields.map(k=>[k,result.requirement[k]])):null;
    results.push({requirementId:r.id,sourceRowId:r.sourceRowId,sourceHash:sha(r),engineCode:branch.engineCode,
      engineAnchorRequirementId:anchor.id,engineAnchorRowId:anchorRow.row_id,engineAnchorRowHash:sha(anchorRow),
      originalYears:finding.originalYears,scope,status:scope?'SCOPED_ENGINE_CONTEXT':'REVIEW',reasons:result.reasons,publicationAllowed:false});
  }
}
const report={kind:'RAW_SOURCE_ENGINE_CONTEXT_BRANCHES',provenanceHash:sha(raw),sourceHash:sha(sourceRaw),snapshotHash:sha(snapshotRaw),
  helperHash:sha(await readFile(resolve(root,'src/lib/fluid-engine-context-branch.ts'),'utf8')),productionApplyAllowed:false,
  summary:{requirements:provenance.findings.length,anchorBranches:results.length,scoped:results.filter(r=>r.scope).length,review:results.filter(r=>!r.scope).length,
    reasons:Object.fromEntries([...Map.groupBy(results.flatMap(r=>r.reasons),r=>r)].map(([k,v])=>[k,v.length]))},
  limitation:'Narrowed source context only. Branches still need full-make rematch and original source technical-condition review. No engine alternatives merged.',results};
await writeFile(resolve(dir,'source-engine-branches-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
