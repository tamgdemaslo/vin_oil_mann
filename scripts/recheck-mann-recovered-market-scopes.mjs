import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'recovered-market-impact-v1.json'),'utf8'),impact=JSON.parse(raw);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannSql=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sql),impact.sourceHash);assert.equal(sha(mannSql),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const plan=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(plan),impact.planHash);
const overlay=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const sources=new Map(overlay.requirements.map(s=>[s.id,s]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
const rows=parseCopy(mannSql,'mann_filter_applications'),byMake=new Map();
const paths=['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-row-identity-evidence.ts','src/lib/mann-engine-code-list.ts','src/lib/mann-catalog.ts','src/lib/vehicle-normalization.ts','scripts/lib/mann-source-identity-overlay.mjs'];
const codeHashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,sha(await readFile(resolve(root,p),'utf8'))])));
const findings=[];
for(const f of impact.findings){
 const original=overlay.originalById.get(f.sourceRequirementId),s=sources.get(f.sourceRequirementId);assert.equal(sha(original),f.sourceHash);
 if(f.anchorContextReviewRequired){findings.push({sourceRequirementId:s.id,status:'RAW_TABLE_ATTRIBUTION_REQUIRED',publicationAllowed:false});continue;}
 const branches=f.anchors[0].branches;
 // Multiple engine codes or powers cannot be paired by a cartesian product.
 const rawCodes=[...new Set(branches.map(b=>b.engineCode))];
 if(rawCodes.length!==1||branches.some(b=>b.powerHp.length!==1)){findings.push({sourceRequirementId:s.id,status:'RAW_ENGINE_POWER_PAIRING_REQUIRED',branches,publicationAllowed:false});continue;}
 const originalCodes=[...new Set([s.engineCodeNormalized,...s.engineCodesJson].filter(Boolean))];
 if(originalCodes.length!==1||originalCodes[0]!==rawCodes[0]){findings.push({sourceRequirementId:s.id,status:'RAW_SOURCE_ENGINE_DISAGREEMENT',branches,publicationAllowed:false});continue;}
 if(!byMake.has(s.make)){const forms=new Set(mannMakeFormsForTest(s.make));byMake.set(s.make,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
 const probes=branches.map(branch=>{
  const effective={...s,engineCodeNormalized:branch.engineCode,engineCodesJson:[branch.engineCode],powerHp:branch.powerHp[0],yearFrom:Number(branch.window.from.slice(0,4)),yearTo:branch.window.to==null?null:Number(branch.window.to.slice(0,4))};
  const decision=match(effective,byMake.get(s.make));
  return {branch,effectiveSource:effective,decision,remainingGates:['EXACT_MONTH_WINDOW_INTERSECTION','TARGET_MARKET_CONFIRMATION','RAW_COMPONENT_AND_CAPACITY_SCOPE','OEM_TECHNICAL_EVIDENCE'],publicationAllowed:false};
 });
 findings.push({sourceRequirementId:s.id,sourceHash:f.sourceHash,status:'BRANCHES_RECHECKED',probes,publicationAllowed:false});
 if(findings.length%50===0)console.log(JSON.stringify({processed:findings.length,total:impact.findings.length}));
}
const probes=findings.flatMap(f=>f.probes??[]),statusCounts=Object.fromEntries([...Map.groupBy(probes,p=>p.decision.status)].map(([s,v])=>[s,v.length]));
for(const [p,h] of Object.entries(codeHashes))assert.equal(sha(await readFile(resolve(root,p),'utf8')),h);
assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),impact.planHash);
const report={kind:'RECOVERED_MARKET_SCOPED_MATCH_RECHECK',impactHash:sha(raw),planHash:impact.planHash,sourceHash:sha(sql),mannHash:sha(mannSql),codeHashes,checked:findings.length,sourceStatuses:Object.fromEntries([...Map.groupBy(findings,f=>f.status)].map(([s,v])=>[s,v.length])),branchProbes:probes.length,statusCounts,findings,productionApplyAllowed:false,limitations:['Year-envelope matcher probes are not exact-month applicability or market confirmation.','No global alias or source rewrite, no canonical draft insertion. Multi-engine/power pairings and nonstandard/multiple anchors remain explicitly held.']};
await writeFile(resolve(dir,'recovered-market-scoped-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,findings:undefined,codeHashes:undefined}));
