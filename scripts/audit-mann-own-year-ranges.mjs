import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-source-quality-preview-2026-09-14');
const [sourceRaw,snapshotRaw,planRaw]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const plan=JSON.parse(planRaw);assert.equal(plan.inputHashes.source,sha(sourceRaw));
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements'),rows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const parse=text=>{
  const match=text.trim().match(/^((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})(?:\s*г(?:\.|ода?)?)?$/iu);
  return match&&Number(match[1])<=Number(match[2])?{from:Number(match[1]),to:Number(match[2])}:null;
};
assert.deepEqual(parse('2011 - 2016'),{from:2011,to:2016});assert.equal(parse('2016-2011'),null);assert.equal(parse('2011-2016 кроме 4WD'),null);
let explicitRanges=0;const findings=[];
for(const source of sources){
  const row=rows.get(source.sourceRowId);assert.ok(row);assert.equal(row.source_url,source.sourceUrl);
  const own=parse(row.production_years??'');if(!own)continue;explicitRanges++;
  const previous={from:source.yearFrom,to:source.yearTo};
  if(previous.from===own.from&&previous.to===own.to)continue;
  const from=Math.max(previous.from??-Infinity,own.from),to=Math.min(previous.to??Infinity,own.to);
  const revisions=plan.newRevisions.filter(r=>r.sourceRequirementId===source.id);
  findings.push({requirementId:source.id,sourceHash:sha(source),sourceRowId:row.row_id,rawRowHash:sha(row),sourceUrl:source.sourceUrl,
    systemCode:source.systemCode,previous,own,rawProductionYears:row.production_years,
    status:from>to?'DISJOINT_SOURCE_AND_OWN_YEARS':from!==previous.from||to!==previous.to?'OWN_ROW_NARROWING_NEEDED':'PARSED_RANGE_ALREADY_NARROWER',
    proposedIntersection:from>to?null:{from,to},localRevisionIds:revisions.map(r=>r.id),publicationAllowed:false});
}
const report={kind:'WHOLE_SOURCE_OWN_YEAR_RANGE_RETENTION',sourceHash:sha(sourceRaw),snapshotHash:sha(snapshotRaw),planHash:sha(planRaw),productionApplyAllowed:false,
  summary:{sourceRequirements:sources.length,explicitRanges,differentRanges:findings.length,
    statuses:Object.fromEntries([...Map.groupBy(findings,r=>r.status)].map(([k,v])=>[k,v.length])),affectedLocalRevisions:findings.reduce((n,f)=>n+f.localRevisionIds.length,0)},
  limitation:'Strict own-row year ranges only. Differences are diagnostic, not permission to overwrite inherited/engine constraints or publish.',findings};
await writeFile(resolve(dir,'own-year-range-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
