import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const dir=resolve(import.meta.dirname,'../outputs/mann-source-quality-preview-2026-09-14');
const auditRaw=await readFile(resolve(dir,'page-year-consistency-v2.json'),'utf8');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const audit=JSON.parse(auditRaw),plan=JSON.parse(planRaw);
assert.equal(audit.planHash,sha(planRaw));
const revisions=new Map(plan.newRevisions.map(r=>[r.id,r]));
const results=[];
for(const finding of audit.findings){
  for(const id of finding.localRevisionIds){
    const revision=revisions.get(id);assert.ok(revision);
    assert.equal(revision.sourceRequirementId,finding.requirementId);
    const window=revision.applicabilityJson?.window?.intersection;
    assert.ok(window&&/^\d{4}-\d{2}$/.test(window.from)&&/^\d{4}-\d{2}$/.test(window.to));
    const page={from:`${finding.pageRange.from}-01`,to:`${finding.pageRange.to}-12`};
    const outside=window.from<page.from||window.to>page.to;
    results.push({revisionId:id,revisionHash:sha(revision),requirementId:finding.requirementId,
      sourceUrl:finding.sourceUrl,systemCode:revision.systemCode,window,pageWindow:page,
      status:outside?'PREVIEW_EXTENDS_BEYOND_PAGE_TITLE':'PREVIEW_WITHIN_PAGE_TITLE',
      automaticCorrectionAllowed:false});
  }
}
assert.equal(results.length,audit.summary.affectedLocalRevisions);
const report={kind:'PAGE_YEAR_PREVIEW_SCOPE_IMPACT',auditHash:sha(auditRaw),planHash:sha(planRaw),productionApplyAllowed:false,
  summary:{revisions:results.length,statuses:Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length]))},
  limitation:'Static month-window comparison with secondary page-title dates only; not OEM evidence, no approved date changes. Within-title does not establish technical validity.',results};
await writeFile(resolve(dir,'page-year-preview-impact-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
console.log(JSON.stringify([...Map.groupBy(results.filter(r=>r.status==='PREVIEW_EXTENDS_BEYOND_PAGE_TITLE'),r=>r.sourceUrl)].map(([url,rows])=>({url,count:rows.length,windows:rows.map(r=>r.window)})),null,2));
