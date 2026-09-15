import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const version=process.argv[2]??'v1';assert.ok(['v1','v2'].includes(version));
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),version==='v2'?'3a3a0c2a6877dc4917c510713ff23ef7ab9a8d8ddd12abe4838622229b712e42':'33fcc0c9b7396f57fca01ae9e062eb5faecf1e7b37a56f15a6fa4d9ec0a68596');const plan=JSON.parse(raw);
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');const mann=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{splitMannEngineCodeList:split}=await j.import('../src/lib/mann-engine-code-list.ts'),{normalizeEngineCode:normalize}=await j.import('../src/lib/vehicle-normalization.ts');
const findings=[];let scopes=0;const noEngine=[];
for(const r of plan.newRevisions){
 const targets=mann.get(r.vehicleVariantKey);assert.ok(targets?.length);
 const engines=[...new Set(targets.flatMap(t=>split(t.engineCode).map(normalize)).filter(Boolean))];
 const allScopes=[{location:'applicabilityJson',scope:r.applicabilityJson},...(r.technicalDataJson.capacityBranches??[]).map((b,i)=>({location:`capacityBranches[${i}]`,scope:b.applicabilityJson}))];
 for(const {scope,location} of allScopes){
  if(!scope?.matchedEngineScope?.length){noEngine.push({revisionId:r.id,location,held:!!r.provenanceJson.sourcePowerReviewHold,systemCode:r.systemCode});continue;}
  scopes++;const outside=scope.matchedEngineScope.filter(e=>!engines.includes(normalize(e)));
  if(outside.length)findings.push({revisionId:r.id,sourceRequirementId:r.sourceRequirementId,vehicleVariantKey:r.vehicleVariantKey,systemCode:r.systemCode,location,matchedEngineScope:scope.matchedEngineScope,mannEngines:engines,mannRawEngines:[...new Set(targets.map(t=>t.engineCode))],outside,policy:r.provenanceJson.catalogPreviewPolicy,status:'REVIEW_SCOPE_VERSUS_EXACT_MANN_VARIANT_NOT_AUTOMATIC_REJECTION'});
 }
}
const summary={revisions:plan.newRevisions.length,engineScopesChecked:scopes,noEngineScopes:noEngine.length,outsideScopes:findings.length,affectedRevisions:new Set(findings.map(f=>f.revisionId)).size};
const report={kind:'CURRENT_PLAN_ENGINE_INTERSECTION_DIAGNOSTIC',planHash:sha(raw),mannHash:sha(mannRaw),summary,findings,noEngine,productionApplyAllowed:false,limitations:['Exact existing runtime normalization/list splitting only; catalogue family aliases or inherited prefixes need evidence, not automatic deletion.','Scope-level diagnostic, no source facts verified or records changed.','No-engine scopes are explicitly reported; absence can be intentional.']};
await writeFile(resolve(dir,`plan-engine-intersections-${version}.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
