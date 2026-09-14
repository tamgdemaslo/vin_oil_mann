import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';

const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-source-quality-preview-2026-09-14');
const [sourceRaw,snapshotRaw,planRaw]=await Promise.all([
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
  readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8'),
  readFile(resolve(dir,'plan.json'),'utf8'),
]);
const plan=JSON.parse(planRaw);assert.equal(plan.inputHashes.source,sha(sourceRaw));
const sources=parseCopy(sourceRaw,'vehicle_fluid_requirements');
const rows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
function range(text,page=false){
  const expression=page?/(?:\s|\|)((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})\s*г(?:ода?)?\.?\s*$/iu:/^\s*((?:19|20)\d{2})\s*[-–—]\s*((?:19|20)\d{2})(?:\s*г(?:\.|ода?)?)?\s*$/iu;
  const m=text.match(expression);
  return m&&Number(m[1])<=Number(m[2])?{from:Number(m[1]),to:Number(m[2])}:null;
}
assert.deepEqual(range('Модель | 6 поколение (А6) | 2010-2019 г.',true),{from:2010,to:2019});
assert.equal(range('Модель | 2010-2019 г. кроме AWD',true),null);
assert.equal(range('Модель 2010-2019',true),null);
assert.equal(range('2022–2010'),null);
assert.deepEqual(range('Модель (2 Gen), 2012-2018 года',true),{from:2012,to:2018});
assert.deepEqual(range('Модель (2 Gen) 2012-2018 года.',true),{from:2012,to:2018});
assert.equal(range('Модель, 2012-н.в.',true),null);
const revisions=new Map();
for(const revision of plan.newRevisions){
  const list=revisions.get(revision.sourceRequirementId)??[];
  list.push(revision.id);revisions.set(revision.sourceRequirementId,list);
}
const findings=[];let parsedTitles=0,parsedOwnRanges=0;
for(const source of sources){
  const row=rows.get(source.sourceRowId);assert.ok(row);assert.equal(row.source_url,source.sourceUrl);
  const page=range(row.page_title??'',true);if(!page)continue;parsedTitles++;
  const own=range(row.production_years??'');if(own)parsedOwnRanges++;
  const parsed={from:source.yearFrom,to:source.yearTo};
  const outside=r=>r&&((r.from!=null&&r.from<page.from)||(r.to!=null&&r.to>page.to));
  if(!outside(parsed)&&!outside(own))continue;
  findings.push({requirementId:source.id,sourceHash:sha(source),sourceRowId:row.row_id,rawRowHash:sha(row),
    sourceUrl:source.sourceUrl,systemCode:source.systemCode,pageTitle:row.page_title,pageRange:page,
    ownRange:own,rawProductionYears:row.production_years,parsedRange:parsed,
    status:outside(own)?'EXPLICIT_ROW_AND_PAGE_DISAGREE':'PARSED_RANGE_OUTSIDE_PAGE',
    localRevisionIds:revisions.get(source.id)??[],automaticCorrectionAllowed:false,publicationAllowed:false});
}
const groups=[...Map.groupBy(findings,r=>r.sourceUrl)].map(([url,items])=>({url,
  requirements:items.length,explicitRowConflicts:items.filter(r=>r.status==='EXPLICIT_ROW_AND_PAGE_DISAGREE').length,
  localRevisions:items.reduce((n,r)=>n+r.localRevisionIds.length,0)})).sort((a,b)=>b.localRevisions-a.localRevisions||b.requirements-a.requirements);
const report={kind:'WHOLE_SOURCE_PAGE_YEAR_CONSISTENCY_DIAGNOSTIC',productionApplyAllowed:false,
  sourceHash:sha(sourceRaw),snapshotHash:sha(snapshotRaw),planHash:sha(planRaw),
  summary:{requirements:sources.length,parsedTitles,unparsedTitles:sources.length-parsedTitles,parsedOwnRanges,
    conflicts:findings.length,pages:groups.length,affectedLocalRevisions:findings.reduce((n,r)=>n+r.localRevisionIds.length,0),
    statuses:Object.fromEntries([...Map.groupBy(findings,r=>r.status)].map(([k,v])=>[k,v.length]))},
  limitation:'Page title is not authoritative fitment evidence. Contradictions require source/vehicle investigation; no automatic clipping or approval. Unparsed titles are not cleared. Local revision links indicate source impact, not proven scope overlap.',groups,findings};
await writeFile(resolve(dir,'page-year-consistency-v2.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({summary:report.summary,topPages:groups.slice(0,12)},null,2));
