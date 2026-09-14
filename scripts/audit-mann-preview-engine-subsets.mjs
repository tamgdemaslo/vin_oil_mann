import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
assert.ok(process.argv.length<=3);
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,process.argv[2]??'outputs/mann-bmw-body-restored-preview-2026-09-14');
const [raw,mannRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile('/tmp/mann_filter_applications.sql','utf8')]);
const plan=JSON.parse(raw),variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {splitMannEngineCodeList}=await jiti.import('../src/lib/mann-engine-code-list.ts');
const results=[];
for(const revision of plan.newRevisions){
  const rows=variants.get(revision.vehicleVariantKey);assert.ok(rows?.length);
  const codes=new Set(rows.flatMap(r=>splitMannEngineCodeList(r.engineCode).map(s=>norm(s.trim())).filter(Boolean)));
  const scopes=revision.technicalDataJson.capacityBranches?.map(b=>b.applicabilityJson)??[revision.applicabilityJson];
  for(const [scopeIndex,scope] of scopes.entries()){
    const engines=scope.matchedEngineScope;
    const unsupported=(engines??[]).filter(c=>!codes.has(norm(c)));
    results.push({revisionId:revision.id,revisionHash:sha(revision),sourceRequirementId:revision.sourceRequirementId,vehicleVariantKey:revision.vehicleVariantKey,
      systemCode:revision.systemCode,scopeIndex,matchedEngineScope:engines,mannEngineCodes:[...codes],unsupported,
      status:!engines?.length?'NO_EXPLICIT_ENGINE_SCOPE':unsupported.length?'SCOPE_CONTAINS_NONLITERAL_TARGET_ENGINES':'EXACT_ENGINE_SUBSET',publicationAllowed:false});
  }
}
const report={planHash:sha(raw),mannHash:sha(mannRaw),revisions:plan.newRevisions.length,scopes:results.length,
  parserHash:sha(await readFile(resolve(root,'src/lib/mann-engine-code-list.ts'),'utf8')),
  summary:Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length])),results,productionApplyAllowed:false,
  limitation:'Target-engine subset audit using production code-list parser including strict Mercedes decimal suffix expansion. No family aliases or OEM/complete match validity assertion.'};
await writeFile(resolve(dir,'engine-subset-audit-v2.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,results:undefined},null,2));
