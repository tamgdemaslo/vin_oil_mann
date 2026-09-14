import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'cn-market-parser-transition-v1.json'),'utf8'),transition=JSON.parse(raw);
assert.equal(transition.afterCodeHash,sha(await readFile(resolve(root,'scripts/lib/mann-source-market-branches.mjs'),'utf8')));
const archive=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(archive),transition.rawHash);
const rows=archive.trim().split('\n').map(JSON.parse),byRaw=new Map(rows.map(r=>[r.row_id,r]));
const key=r=>JSON.stringify([r.source_url,r.table_index]);
const anchors=Map.groupBy(transition.recovered,r=>key(r.raw));
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const sources=parseCopy(sql,'vehicle_fluid_requirements');assert.equal(sources.length,13296);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),'31f8407dde303ca792f858299a5c40282a4079d65b9e8a9a8e020941e8411c5c');
const plan=JSON.parse(planRaw),revisions=Map.groupBy(plan.newRevisions,r=>r.sourceRequirementId);
const findings=[];
for(const s of sources){
 const r=byRaw.get(s.sourceRowId);if(!r)continue;
 const matched=anchors.get(key(r));if(!matched)continue;
 for(const a of matched)assert.equal(a.rawHash,sha(byRaw.get(a.rowId)));
 const existing=revisions.get(s.id)??[];
 findings.push({sourceRequirementId:s.id,originalSource:s,sourceHash:sha(s),rawRowHash:sha(r),anchors:matched,anchorContextReviewRequired:matched.length!==1||matched[0].raw.system_name!=='МАСЛО в ДВИГАТЕЛЬ',existingRevisions:existing.map(rev=>({id:rev.id,vehicleVariantKey:rev.vehicleVariantKey,applicabilityJson:rev.applicabilityJson,state:rev.state,applyEligible:rev.applyEligible})),status:existing.length?'EXISTING_DRAFT_SCOPE_RECHECK_REQUIRED':'NEWLY_PARSED_SOURCE_SCOPE',publicationAllowed:false});
}
const impacted=findings.filter(f=>f.existingRevisions.length);
const byMake=Object.fromEntries([...Map.groupBy(findings,f=>f.originalSource.make)].map(([make,v])=>[make,{sourceRows:v.length,existingDraftSources:v.filter(f=>f.existingRevisions.length).length}]));
const report={kind:'RECOVERED_MARKET_ALL_SOURCE_IMPACT',transitionHash:sha(raw),sourceHash:sha(sql),planHash:sha(planRaw),checked:sources.length,recoveredAnchors:transition.recovered.length,affectedSources:findings.length,existingDraftSources:impacted.length,existingDraftRevisions:impacted.reduce((n,f)=>n+f.existingRevisions.length,0),byMake,findings,productionApplyAllowed:false,limitations:['Table-scoped raw assertions are evidence for rechecking, not automatic publication or approved OEM applicability.','Existing revisions are flagged for review, not declared unsafe solely because parser gained coverage. All branches retained without engine/market cross product expansion.']};
await writeFile(resolve(dir,'recovered-market-impact-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,findings:undefined},null,2));
