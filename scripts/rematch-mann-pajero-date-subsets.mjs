import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow,originalAssociationFingerprint,YEAR_BLOCKER} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';
import {parseLiteralEngineApplication} from './lib/mann-literal-engine-application.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const backlogRaw=await readFile(resolve(dir,'action-groups-current-plan-v2.json'),'utf8'),backlog=JSON.parse(backlogRaw);
const manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
assert.equal(sha(await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8')),backlog.planHash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8'),raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(sql),manifest.sourceHash);assert.equal(sha(mannRaw),manifest.mannHash);assert.equal(sha(raw),manifest.rawHash);
const identity=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,raw),fuel=await applyAuditedSourceFuel(root,power.requirements,raw);
const corrected=fuel.requirements.map(s=>({...s,engineCodeNormalized:fuel.fresh.get(s.id).engineCodeNormalized,engineCodesJson:fuel.fresh.get(s.id).engineCodesJson}));assert.equal(sha(corrected),manifest.correctedSourcesHash);
const sources=new Map(corrected.map(s=>[s.id,s])),variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const rawRows=raw.trim().split('\n').map(JSON.parse),byRaw=new Map(rawRows.map(r=>[r.row_id,r])),tables=Map.groupBy(rawRows,r=>`${r.source_url}|${r.table_index}`);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const live=JSON.parse(await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8'));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts'),{parseFluidCapacities:capacity}=await j.import('../src/lib/fluid-capacity-parser.ts');


const preRaw=await readFile(resolve(dir,'confirmed-date-fluid-preflight-v1.json'),'utf8'),pre=JSON.parse(preRaw);
assert.equal(pre.planHash,backlog.planHash);
const inventory=JSON.parse(await readFile(resolve(dir,'date-backlog-preflight-v1.json'),'utf8'));
const {matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
const catalog=parseCopy(mannRaw,'mann_filter_applications'),findings=[];
for(const f of pre.findings){
 const a=inventory.findings.find(a=>a.sourceRequirementId===f.sourceRequirementId);
 if(a.engineApplications.some(a=>!a.parsed))continue;
 const rows=variants.get(f.vehicleVariantKey),codes=[...new Set(rows.map(r=>norm(r.engineCode)))],powers=[...new Set(rows.map(r=>Number(r.hp)))];
 const branches=a.engineApplications.flatMap(e=>e.parsed.branches.map(b=>({...b,anchorRowId:e.rowId,anchorHash:e.rowHash}))).filter(b=>codes.length===1&&norm(b.engineCode)===codes[0]&&powers.length===1&&b.powerHp.includes(powers[0]));
 const w=f.scope.window.intersection;
 if(!branches.length||branches.some(b=>b.effectiveDates.from<=w.from&&(!b.effectiveDates.to||b.effectiveDates.to>=w.to)))continue;
 for(const branch of branches){
  const from=[w.from,branch.effectiveDates.from].sort().at(-1),to=[w.to,branch.effectiveDates.to].filter(Boolean).sort()[0];
  if(from>to)continue;
  const source=sources.get(f.sourceRequirementId);assert.equal(sha(identity.originalById.get(source.id)),f.sourceHash);
  const narrowed={...source,yearFrom:Number(from.slice(0,4)),yearTo:Number(to.slice(0,4)),engineCodeNormalized:codes[0],engineCodesJson:codes,powerHp:powers[0]};
  const forms=new Set(mannMakeFormsForTest(a.make)),makeRows=catalog.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
  const decision=match(narrowed,makeRows),target=decision.targets.find(t=>t.vehicleVariantKey===f.vehicleVariantKey&&t.independentlyValidated);
  const scope={...f.scope,window:{intersection:{from,to}},...(branch.requiredMarket?{requiredMarket:branch.requiredMarket}:{})};
  const technicalReasons=f.reasons.filter(r=>r!=='EXACT_UNIQUE_ENGINE_POWER_DATE_BRANCH_NOT_PROVEN');
  const rawCapacity=identity.originalById.get(source.id).fillVolumeText;
  assert.equal(rawCapacity,'9.0 л. сервисный объём для моделей без заднего кондиционера 10.5 л. сервисный объём для моделей с задним кондиционером');
  findings.push({sourceRequirementId:source.id,vehicleVariantKey:f.vehicleVariantKey,sourceHash:f.sourceHash,originalAssociationFingerprint:f.originalAssociationFingerprint,narrowedSourceHash:sha(narrowed),branch,scope,decision,targetValidated:!!target,remainingTechnicalReasons:technicalReasons,capacityEvidence:{original:rawCapacity,withoutRearAirConditioningLiters:9,withRearAirConditioningLiters:10.5,requiresExplicitEquipmentConfirmation:true},productionApplyAllowed:false});
 }
}
assert.equal(findings.length,5);
const stats={sourceRecords:new Set(findings.map(f=>f.sourceRequirementId)).size,branches:findings.length,independentlyValidated:findings.filter(f=>f.targetValidated).length,requiresRearAirConditioningContext:findings.length};
await writeFile(resolve(dir,'pajero-engine-market-date-rematch-v1.json'),JSON.stringify({kind:'PAJERO_LITERAL_ENGINE_MARKET_DATE_SUBSETS',planHash:backlog.planHash,preflightHash:sha(preRaw),summary:stats,findings,productionApplyAllowed:false,limitations:['Five narrower scopes are not drafts or publication approval.','Source says rear air conditioning; do not reinterpret as a different equipment condition or infer from engine/VIN alone.','Capacity branches still require explicit equipment-aware runtime/UI handling.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(stats));
