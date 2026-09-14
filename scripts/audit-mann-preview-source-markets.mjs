import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
assert.ok(process.argv.length<=3);
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,process.argv[2]??'outputs/mann-market-power-held-preview-2026-09-14');
const [planRaw,sql,rawText]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const plan=JSON.parse(planRaw),sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r])),rows=rawText.trim().split('\n').map(JSON.parse),byId=new Map(rows.map(r=>[r.row_id,r])),anchors=Map.groupBy(rows.filter(r=>r.system_name==='МАСЛО в ДВИГАТЕЛЬ'),r=>`${r.source_url}:${r.table_index}`),findings=[];let missingRaw=0;
for(const revision of plan.newRevisions){
 const original=sources.get(revision.sourceRequirementId);assert.ok(original);const raw=byId.get(original.sourceRowId);if(!raw){missingRaw++;continue;}
 const sameTable=anchors.get(`${raw.source_url}:${raw.table_index}`)??[];
 for(const anchor of sameTable){
  const markets=[...new Set(anchor.model.match(/Россия|Япония|Европа|США|ОАЭ|Ю\. Корея|Ю-В Азия/giu)??[])];if(!markets.length)continue;
  const scopes=revision.technicalDataJson.capacityBranches?.map(b=>b.applicabilityJson)??[revision.applicabilityJson],unscoped=scopes.map((scope,i)=>({scope,index:i})).filter(e=>!e.scope.requiredMarket);
  findings.push({revisionId:revision.id,revisionHash:sha(revision),sourceRequirementId:original.id,sourceHash:sha(original),make:original.make,model:original.model,anchorHash:sha(anchor),anchor,markets,unscopedIndices:unscoped.map(e=>e.index),scopes,status:unscoped.length?'MARKET_CONTEXT_WITHOUT_SCOPE':'HAS_MARKET_SCOPE_NEEDS_BRANCH_RECONCILIATION',publicationAllowed:false});
 }
}
const unscoped=findings.filter(f=>f.unscopedIndices.length);
const report={planHash:sha(planRaw),sourceHash:sha(sql),rawHash:sha(rawText),summary:{revisions:plan.newRevisions.length,missingRawRows:missingRaw,withMarketContext:findings.length,withoutMarketScope:unscoped.length,byMake:Object.fromEntries([...Map.groupBy(unscoped,f=>f.make)].map(([k,v])=>[k,v.length]))},findings,productionApplyAllowed:false,limitation:'Triage of explicit market labels in same-table source engine anchors, not automatic market assignment. Mixed engines/powers/markets and branch-specific years require exact reconciliation; unrecognized market wording is not covered.'};
await writeFile(resolve(dir,'source-market-context-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
