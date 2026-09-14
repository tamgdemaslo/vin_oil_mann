import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
import {coreScopeContains} from './lib/mann-core-scope-containment.mjs';
assert.ok(process.argv.length<=4&&(!process.argv[3]||['v3','v4','v5'].includes(process.argv[3])));
const dir=resolve(import.meta.dirname,'..',process.argv[2]??'outputs/mann-engine-inclusive-preview-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),auditRaw=await readFile(resolve(dir,`profile-composition-audit-${process.argv[3]??'v3'}.json`),'utf8');
const plan=JSON.parse(planRaw),audit=JSON.parse(auditRaw);assert.equal(audit.planSha256,sha(planRaw));
const unseen=new Set(audit.unseenCandidateRevisions),seen=plan.newRevisions.filter(r=>!unseen.has(r.id));
const findings=audit.unresolvedRepresentation.map(f=>{
  const row=plan.newRevisions.find(r=>r.id===f.revisionId);assert.ok(row);
  const covering=seen.filter(other=>other.vehicleVariantKey===row.vehicleVariantKey&&other.systemCode===row.systemCode&&other.componentModel===row.componentModel&&
    sha(other.technicalDataJson)===sha(row.technicalDataJson)&&coreScopeContains(other.applicabilityJson,row.applicabilityJson));
  return {revisionId:row.id,sourceRequirementId:row.sourceRequirementId,scope:row.applicabilityJson,
    status:covering.length?'FULL_CORE_SCOPE_CONTAINMENT_PROVED':'UNRESOLVED',coveringRevisionIds:covering.map(r=>r.id),
    technicalDataHash:sha(row.technicalDataJson),publicationAllowed:false};
});
const report={kind:'SHADOWED_CORE_SCOPE_CONTAINMENT',planHash:sha(planRaw),auditHash:sha(auditRaw),productionApplyAllowed:false,
  summary:{unresolvedRepresentation:findings.length,proved:findings.filter(r=>r.coveringRevisionIds.length).length,unresolved:findings.filter(r=>!r.coveringRevisionIds.length).length},
  limitation:'Static full-scope containment for identical technical payload only. Does not remove rows, approve capacity conflicts, or replace publication/source verification.',findings};
await writeFile(resolve(dir,process.argv[3]==='v5'?'shadowed-core-scope-verification-v2.json':'shadowed-core-scope-verification-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
