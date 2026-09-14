import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-engine-inclusive-preview-2026-09-14');
const [sourceRaw,snapshotRaw,planRaw]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const plan=JSON.parse(planRaw);assert.equal(plan.inputHashes.source,sha(sourceRaw));
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements'),rows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const jiti=createJiti(import.meta.url);
const {extractRawProductionCondition:extract}=await jiti.import('../src/lib/fluid-raw-production-condition.ts');
const findings=[],missing=[];
for(const source of sources){
  const row=rows.get(source.sourceRowId);if(!row){missing.push(source.id);continue;}
  const condition=extract(row.production_years??'');if(!condition)continue;
  assert.equal(row.source_url,source.sourceUrl);
  const affected=plan.newRevisions.filter(r=>r.sourceRequirementId===source.id).map(r=>{
    const previous=r.applicabilityJson.window?.intersection;assert.ok(previous);
    if(condition.status!=='SCOPED')return {revisionId:r.id,status:'REVIEW'};
    const from=[previous.from,condition.from].filter(Boolean).sort().at(-1)??null,to=[previous.to,condition.to].filter(Boolean).sort()[0]??null;
    return {revisionId:r.id,previous,intersection:from&&to&&from>to?null:{from,to},status:from&&to&&from>to?'EMPTY_INTERSECTION':from!==previous.from||to!==previous.to?'NARROWING_REQUIRED':'ALREADY_WITHIN_CONDITION'};
  });
  findings.push({requirementId:source.id,sourceRowId:row.row_id,sourceHash:sha(source),rawRowHash:sha(row),sourceUrl:source.sourceUrl,
    systemCode:source.systemCode,parsedYears:{from:source.yearFrom,to:source.yearTo},rawApplication:row.application,condition,affected,publicationAllowed:false});
}
const affected=findings.flatMap(f=>f.affected);
const report={kind:'WHOLE_SOURCE_RAW_PRODUCTION_QUALIFIERS',sourceHash:sha(sourceRaw),snapshotHash:sha(snapshotRaw),planHash:sha(planRaw),
  helperHash:sha(await readFile(resolve(root,'src/lib/fluid-raw-production-condition.ts'),'utf8')),
  dateHelperHash:sha(await readFile(resolve(root,'src/lib/fluid-source-date-condition.ts'),'utf8')),productionApplyAllowed:false,
  summary:{sourceRequirements:sources.length,missingRawRows:missing.length,qualifiedRequirements:findings.length,affectedRevisions:affected.length,
    statuses:Object.fromEntries([...Map.groupBy(affected,r=>r.status)].map(([k,v])=>[k,v.length]))},missing,findings,
  limitation:'Scans own production_years qualifiers only; ordinary ranges, inherited table/header dates and other source conditions require separate audits. Proposed intersections, not revised publication rows.'};
await writeFile(resolve(dir,'raw-production-condition-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
