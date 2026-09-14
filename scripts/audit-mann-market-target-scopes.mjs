import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sourceMarketBranches} from './lib/mann-source-market-branches.mjs';
import {parseCopy,sha,applicabilityWindow} from './lib/mann-offline-scope.mjs';
assert.ok(process.argv.length<=4&&(!process.argv[3]||['v1','v2'].includes(process.argv[3])));
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,process.argv[2]??'outputs/mann-market-power-held-preview-2026-09-14');
const [planRaw,inputRaw,mannRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'source-market-context-audit-v1.json'),'utf8'),readFile('/tmp/mann_filter_applications.sql','utf8')]);
const plan=JSON.parse(planRaw),input=JSON.parse(inputRaw);assert.equal(input.planHash,sha(planRaw));
assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey),revisions=new Map(plan.newRevisions.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts'),{splitMannEngineCodeList}=await jiti.import('../src/lib/mann-engine-code-list.ts');
const {isVehicleDestinationMarket}=await jiti.import('../src/lib/vehicle-market.ts');
const lower=x=>x??'0000-01',upper=x=>x??'9999-12';
const intersect=(a,b)=>{const from=lower(a.from)>lower(b.from)?a.from:b.from,to=upper(a.to)<upper(b.to)?a.to:b.to;return lower(from)<=upper(to)?{from,to}:null;};
const contains=(outer,inner)=>lower(outer.from)<=lower(inner.from)&&upper(outer.to)>=upper(inner.to);
const findings=[];
for(const f of input.findings){
 const revision=revisions.get(f.revisionId);assert.equal(sha(revision),f.revisionHash);
 const rows=variants.get(revision.vehicleVariantKey);assert.ok(rows?.length);
 const branches=sourceMarketBranches(f.anchor.model,f.anchor.production_years);
 const checks=[];
 for(const [scopeIndex,scope] of f.scopes.entries()){
  const window=scope.window?.intersection;
  for(const engine of scope.matchedEngineScope??[]){
   const engineRows=rows.filter(r=>splitMannEngineCodeList(r.engineCode).some(c=>norm(c)===norm(engine)));
   if(!engineRows.length)checks.push({scopeIndex,engine,status:'TARGET_ENGINE_MISSING'});
   for(const row of engineRows){
    const powerHp=/^\d{2,3}$/.test(row.hp??'')?Number(row.hp):null;
    const engineBranches=branches?.filter(b=>norm(b.engineCode)===norm(engine))??[];
    const matches=engineBranches.filter(b=>b.powerHp.includes(powerHp));
    const eligible=matches.filter(b=>!scope.requiredMarket||b.market===scope.requiredMarket);
    const targetWindow=applicabilityWindow({yearFrom:1886,yearTo:2100},row)?.mann??null;
    const overlaps=window?eligible.map(b=>({...b,overlap:intersect(b.window,window)})).filter(b=>b.overlap):[];
    const markets=[...new Set(overlaps.map(b=>b.market))];
    const status=!branches?'UNPARSED_SOURCE':!powerHp?'TARGET_POWER_UNKNOWN':!matches.length?'EXACT_ENGINE_POWER_NOT_IN_SOURCE':!window||!targetWindow?'DATE_EVIDENCE_MISSING':!contains(targetWindow,window)?'SCOPE_EXCEEDS_TARGET_DATES':!overlaps.length?'NO_MARKET_DATE_OVERLAP':overlaps.some(b=>b.sourceQualifier==='Hybrid')?'HYBRID_IDENTITY_REQUIRES_RECHECK':markets.length>1?'MULTIPLE_MARKETS_REQUIRE_PARTITION':!overlaps.some(b=>contains(b.window,window))?'SOURCE_BRANCH_DATE_NARROWING_REQUIRED':!isVehicleDestinationMarket(markets[0])?'MARKET_RUNTIME_SUPPORT_REQUIRED':scope.requiredMarket===markets[0]?(markets[0]==='RU'?'EXISTING_RU_SCOPE_SUPPORTED':'EXISTING_MARKET_SCOPE_SUPPORTED'):(markets[0]==='RU'?'RU_GUARD_MISSING_EXACT_POWER_DATES_SUPPORTED':'NON_RU_GUARD_MISSING_EXACT_POWER_DATES_SUPPORTED');
    checks.push({scopeIndex,engine,targetRowId:row.id,targetRowHash:sha(row),targetPowerRaw:row.hp,powerHp,currentWindow:window,targetWindow,requiredMarket:scope.requiredMarket??null,sourceEngineBranches:engineBranches,matches,overlaps,markets,status});
   }
  }
  if(!scope.matchedEngineScope?.length)checks.push({scopeIndex,status:'ENGINE_SCOPE_MISSING'});
 }
 findings.push({revisionId:revision.id,revisionHash:sha(revision),sourceRequirementId:f.sourceRequirementId,vehicleVariantKey:revision.vehicleVariantKey,make:f.make,model:f.model,anchorHash:f.anchorHash,rawModel:f.anchor.model,branches,statuses:[...new Set(checks.map(c=>c.status))],checks,publicationAllowed:false});
}
const summary={revisions:findings.length,parsedRevisions:findings.filter(f=>f.branches).length,uniqueAnchors:new Set(findings.map(f=>f.anchorHash)).size,revisionStatusCounts:Object.fromEntries([...Map.groupBy(findings.flatMap(f=>f.statuses.map(status=>({status,id:f.revisionId}))),x=>x.status)].map(([k,v])=>[k,v.length])),singleStatusRevisionCounts:Object.fromEntries([...Map.groupBy(findings,f=>f.statuses.length===1?f.statuses[0]:'MIXED_TARGET_ROW_STATUSES')].map(([k,v])=>[k,v.length]))};
const supportingFiles=['scripts/lib/mann-source-market-branches.mjs','scripts/lib/mann-offline-scope.mjs','src/lib/mann-engine-code-list.ts','src/lib/vehicle-normalization.ts','src/lib/vehicle-market.ts'];
const codeHashes=Object.fromEntries(await Promise.all(supportingFiles.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))])));
await writeFile(resolve(dir,`source-market-target-scope-audit-${process.argv[3]??'v1'}.json`),JSON.stringify({planHash:sha(planRaw),inputHash:sha(inputRaw),mannHash:sha(mannRaw),codeHashes,summary,findings,productionApplyAllowed:false,limitation:'Read-only exact engine/power/market/date reconciliation of same-table source anchors against every matching target row. Not full-make identity reranking or OEM proof. No revision repaired or published; combined date coverage across multiple branches is conservatively left for partition review.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary,null,2));
