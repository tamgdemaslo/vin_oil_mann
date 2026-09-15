import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {parseLiteralEngineApplication as literal} from './lib/mann-literal-engine-application.mjs';
import {parseVolvoLiteralEngineApplication as volvo} from './lib/mann-volvo-literal-engine-application.mjs';
import {parsePowerDriveEngineApplication as powerDrive} from './lib/mann-power-drive-engine-application.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const planRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8'),plan=JSON.parse(planRaw);assert.equal(sha(planRaw),'12a5a5563418358782de3d4ca4e3507b1ccc8bb3e5ff8651439755d961f4392f');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),plan.inputHashes.source);const sources=parseCopy(sql,'vehicle_fluid_requirements'),byId=new Map(sources.map(s=>[s.id,s])),tables=Map.groupBy(sources,s=>s.sourceTableKey);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');const rows=new Map(raw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');const variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts');
const cache=new Map(),anchors=[];
function anchor(row,make){
 const key=make+':'+row.row_id;if(cache.has(key))return cache.get(key);
 const parsed=literal(row.application)??volvo(row.application,make)??powerDrive(row.application,make);
 const a={rowId:row.row_id,rowHash:sha(row),parsed};cache.set(key,a);anchors.push(a);return a;
}
const month=s=>typeof s==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(s)?Number(s.slice(0,4))*12+Number(s.slice(5))-1:null;
const findings=[];
for(const r of plan.newRevisions){
 const source=byId.get(r.sourceRequirementId);assert.ok(source);const scope=r.applicabilityJson;
 const tableAnchors=[...new Map(tables.get(source.sourceTableKey).filter(s=>s.systemCode==='ENGINE_OIL').map(s=>[s.sourceRowId,rows.get(s.sourceRowId)])).values()].map(row=>anchor(row,source.makeNormalized));
 const branches=tableAnchors.flatMap(a=>(a.parsed?.branches??[]).map(b=>({...b,anchorRowId:a.rowId,anchorHash:a.rowHash})));
 const powers=[...new Set(variants.get(r.vehicleVariantKey).map(x=>Number(x.hp)))],engines=(scope.matchedEngineScope??[]).map(norm),from=month(scope.window?.intersection?.from),to=month(scope.window?.intersection?.to);
 const reasons=[],engineFindings=[];
 if(!tableAnchors.length||tableAnchors.some(a=>!a.parsed))reasons.push('INCOMPLETE_LITERAL_ANCHOR_GRAMMAR');
 if(!engines.length||from===null||to===null||from>to)reasons.push('NO_COMPLETE_ENGINE_MONTH_SCOPE');
 if(powers.length!==1||!Number.isFinite(powers[0])||powers[0]<=0)reasons.push('NO_UNIQUE_MANN_POWER');
 if(!reasons.length)for(const engine of engines){
  const exact=branches.filter(b=>norm(b.engineCode)===engine&&b.powerHp.includes(powers[0])&&(!b.requiredMarket||b.requiredMarket===scope.requiredMarket));
  if(!exact.length){reasons.push('NO_EXACT_ENGINE_POWER_MARKET_BRANCH');engineFindings.push({engine,exactBranches:[],uncoveredMonths:null});continue;}
  let uncoveredMonths=0,driveUnconstrainedMonths=0;
  for(let m=from;m<=to;m++){
   const applicable=exact.filter(b=>month(b.effectiveDates.from)<=m&&(b.effectiveDates.to===null||month(b.effectiveDates.to)>=m));
   if(!applicable.length){uncoveredMonths++;continue;}
   const allowed=[...new Set(applicable.flatMap(b=>b.driveCondition?.split(',').map(s=>s.trim())??[]))];
   if(applicable.every(b=>b.driveCondition)&&allowed.length===1&&['2WD','4WD'].includes(allowed[0])&&scope.requiredVehicleDrive!==allowed[0])driveUnconstrainedMonths++;
  }
  if(uncoveredMonths)reasons.push('UNCOVERED_LITERAL_ENGINE_MONTHS');if(driveUnconstrainedMonths)reasons.push('MISSING_LITERAL_VEHICLE_DRIVE_GATE');
  engineFindings.push({engine,exactBranches:exact,uncoveredMonths,driveUnconstrainedMonths});
 }
 findings.push({revisionId:r.id,revisionHash:sha(r),sourceRequirementId:source.id,sourceHash:sha(source),vehicleVariantKey:r.vehicleVariantKey,make:source.makeNormalized,systemCode:r.systemCode,previewHeld:r.provenanceJson.catalogPreviewEligible===false||!!r.provenanceJson.sourcePowerReviewHold,anchorRowIds:tableAnchors.map(a=>a.rowId),mannPowerHp:powers,engineFindings,reasons:[...new Set(reasons)],productionApplyAllowed:false});
}
assert.equal(findings.length,2025);
const active=findings.filter(f=>!f.previewHeld),summary={revisions:2025,sourceRecords:new Set(findings.map(f=>f.sourceRequirementId)).size,uniqueAnchors:anchors.length,parsedAnchors:anchors.filter(a=>a.parsed).length,previewHeld:findings.length-active.length,withoutLiteralScopeFindings:active.filter(f=>!f.reasons.length).length,reasons:Object.fromEntries([...Map.groupBy(active.flatMap(f=>f.reasons),r=>r)].map(([k,a])=>[k,a.length]))};
await writeFile(resolve(dir,'all-draft-literal-scope-audit-v1.json'),JSON.stringify({kind:'ALL_DRAFT_LITERAL_SCOPE_AUDIT',planHash:sha(planRaw),sourceHash:sha(sql),rawHash:sha(raw),mannHash:sha(mannRaw),summary,anchors,findings,productionApplyAllowed:false,limitations:['Secondary-source literal scope audit, not complete technical/OEM verification.','Incomplete grammar is a coverage gap, not proof a record is wrong.','Known market must match literal branch; no country inferred.','Special component/fuel/identity overlays may supply independent evidence not interpreted by this common literal pass.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
