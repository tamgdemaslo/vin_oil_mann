import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const auditRaw=await readFile(resolve(dir,'partial-table-power-audit-v1.json'),'utf8'),audit=JSON.parse(auditRaw);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),audit.planHash);const plan=JSON.parse(planRaw);
const sql=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sql),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');const targets=Map.groupBy(parseCopy(sql,'mann_filter_applications'),r=>r.vehicleVariantKey);
const findings=[];
for(const f of audit.findings.filter(f=>f.existingRevisionIds.length))for(const id of f.existingRevisionIds){
 const rev=plan.newRevisions.find(r=>r.id===id);assert.ok(rev);assert.equal(rev.sourceRequirementId,f.sourceRequirementId);assert.equal(sha(f.originalSource),f.sourceHash);
 const scope=rev.provenanceJson?.sourceEngineScope;
 const codes=rev.applicabilityJson?.matchedEngineScope??rev.applicabilityJson?.engineCodes??[];
 const linkedIds=rev.provenanceJson?.engineAnchorRowIds??[];
 const anchors=f.engineAnchors.filter(a=>linkedIds.includes(a.source.sourceRowId));
 const rows=targets.get(rev.vehicleVariantKey)??[];
 const reasons=[];
 if(!codes.length)reasons.push('NO_EXPLICIT_ENGINE_SCOPE');
 if(!scope||scope.powerHp==null)reasons.push('NO_INDEPENDENT_SCOPED_POWER');
 if(!anchors.length||anchors.length!==linkedIds.length)reasons.push('ENGINE_ANCHOR_LINK_NOT_RESOLVED');
 if(!codes.every(c=>anchors.some(a=>a.source.engineCodesJson.includes(c))))reasons.push('SCOPED_ENGINE_NOT_IN_LINKED_ANCHOR');
 if(anchors.some(a=>a.source.powerHp==null||a.source.powerHp!==scope?.powerHp))reasons.push('ANCHOR_POWER_MISSING_OR_DISAGREES');
 if(!rows.length||rows.some(r=>Number(r.hp)!==scope?.powerHp))reasons.push('TARGET_POWER_NOT_EXACT');
 findings.push({revisionId:id,sourceRequirementId:f.sourceRequirementId,sourceHash:f.sourceHash,engineScope:codes,scopedPower:scope??null,linkedAnchorIds:linkedIds,anchors,targetRows:rows,reasons,status:reasons.length?'SCOPED_POWER_REVIEW_REQUIRED':'SCOPED_POWER_INDEPENDENTLY_SUPPORTED',publicationAllowed:false});
}
assert.equal(findings.length,20);
const report={kind:'TABLE_POWER_20_DRAFT_INDEPENDENT_SCOPE_CHECK',auditHash:sha(auditRaw),planHash:sha(planRaw),mannHash:sha(sql),checked:20,statusCounts:Object.fromEntries([...Map.groupBy(findings,f=>f.status)].map(([k,v])=>[k,v.length])),findings,productionApplyAllowed:false,limitations:['Only tests whether scoped draft power has independent exact engine-anchor and target support. Does not approve fluid OEM truth or other applicability dimensions.','Unresolved references are held for investigation, not automatically deleted or judged false.']};
await writeFile(resolve(dir,'table-power-draft-scopes-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:findings.filter(f=>f.reasons.length).map(f=>({id:f.revisionId,reasons:f.reasons}))}));
