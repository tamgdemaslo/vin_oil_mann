import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';
import {parseLiteralEngineApplication} from './lib/mann-literal-engine-application.mjs';
import {parseVolvoLiteralEngineApplication} from './lib/mann-volvo-literal-engine-application.mjs';
import {parsePowerDriveEngineApplication} from './lib/mann-power-drive-engine-application.mjs';
import {parsePsaLiteralEngineApplication} from './lib/mann-psa-literal-engine-application.mjs';
import {splitSpecificationSections,specificationCautionSignals} from './lib/mann-specification-sections-v2.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const version=process.argv[2]??'v1';assert.ok(['v1','v2','v3','v4'].includes(version));const current=version!=='v1',psa=version==='v4';
const read=async path=>{const raw=await readFile(path,'utf8');return {raw,data:JSON.parse(raw)};};
const [plan,links,manifest]=await Promise.all([read(resolve(dir,'plan.json')),read(resolve(dir,'recorded-vin-source-gaps-v1.json')),read(resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2/manifest.json'))]);
assert.equal(sha(plan.raw),current?'00c29d1d9f1f77436216938a8ab6484f3756830515a0f68b37f32ac193dd2bba':links.data.planHash);
if(current)assert.equal(links.data.planHash,'12a5a5563418358782de3d4ca4e3507b1ccc8bb3e5ff8651439755d961f4392f');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8'),raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(sql),manifest.data.sourceHash);assert.equal(sha(mannRaw),manifest.data.mannHash);assert.equal(sha(raw),manifest.data.rawHash);
const identity=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,raw),fuel=await applyAuditedSourceFuel(root,power.requirements,raw);
const corrected=fuel.requirements.map(s=>({...s,engineCodeNormalized:fuel.fresh.get(s.id).engineCodeNormalized,engineCodesJson:fuel.fresh.get(s.id).engineCodesJson}));
assert.equal(sha(corrected),manifest.data.correctedSourcesHash);
const sources=new Map(corrected.map(s=>[s.id,s])),variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const rawRows=raw.trim().split('\n').map(JSON.parse),byRaw=new Map(rawRows.map(r=>[r.row_id,r])),tables=Map.groupBy(rawRows,r=>`${r.source_url}|${r.table_index}`);
const live=await read(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json')),reviews=await read(resolve(root,'outputs/mann-live-audit-1789415211923/reviewDecisions.json'));
const protectedIds=new Set(reviews.data.filter(r=>r.decision==='CONFIRM').map(r=>r.revisionId));
const deny=await read(resolve(root,'data/mann-technical-association-denylist-v1.json')),denied=new Set(deny.data.rejectedAssociationFingerprints);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts');
const {mannConfirmableEngineCodes:codes}=await j.import('../src/lib/mann-confirmable-engine-codes.ts');
const {parseFluidCapacities:capacity}=await j.import('../src/lib/fluid-capacity-parser.ts');
const {isMannNonVehicleVariantText:nonVehicle}=await j.import('../src/lib/mann-catalog.ts');
const {extractRawProductionCondition:dateCondition}=await j.import('../src/lib/fluid-raw-production-condition.ts');
const parse=(a,make)=>parseLiteralEngineApplication(a)??(psa?parsePsaLiteralEngineApplication(a,make):null)??(make==='VOLVO'?parseVolvoLiteralEngineApplication(a):make==='TOYOTA'?parsePowerDriveEngineApplication(a):null);
const labels={ENGINE_COOLANT:['АНТИФРИЗ','ОХЛАЖДАЮЩАЯ ЖИДКОСТЬ','АНТИФРИЗ В СИСТЕМУ ОХЛАЖДЕНИЯ'],BRAKE_FLUID:['ТОРМОЗНАЯ ЖИДКОСТЬ','МАСЛО в ТОРМОЗНУЮ СИСТЕМУ'],FUEL_TANK:['ТОПЛИВНЫЙ БАК','ОБЪЁМ БЕНЗОБАКА']};
const findings=[],alreadyDrafted=[],excludedNonVehicle=[];
for(const link of links.data.prioritizedSourceTargets.filter(p=>!p.hardConflicts.length)){
  const s=sources.get(link.sourceRequirementId),original=identity.originalById.get(s.id),row=byRaw.get(s.sourceRowId),rows=variants.get(link.vehicleVariantKey);
  assert.ok(row&&rows?.length);
  if(current&&plan.data.newRevisions.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===link.vehicleVariantKey)){alreadyDrafted.push({sourceRequirementId:s.id,vehicleVariantKey:link.vehicleVariantKey});continue;}
  assert.ok(!plan.data.newRevisions.some(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===link.vehicleVariantKey));
  if(psa&&rows.every(r=>nonVehicle(r.effectiveVehicleText??r.vehicleText))){excludedNonVehicle.push({sourceRequirementId:s.id,vehicleVariantKey:link.vehicleVariantKey});continue;}
  const reasons=[],anchors=(tables.get(`${row.source_url}|${row.table_index}`)??[]).filter(r=>r.system_name?.startsWith('МАСЛО в ДВИГАТЕЛЬ')&&(s.systemCode!=='ENGINE_OIL'||r.row_id===row.row_id));
  const applications=anchors.map(a=>({rowId:a.row_id,rowHash:sha(a),parsed:parse(a.application,link.sourceVehicle?.canonicalMake)}));
  if(!applications.length||applications.some(a=>!a.parsed))reasons.push('INCOMPLETE_ENGINE_ANCHOR_GRAMMAR');
  const engineLists=rows.map(r=>codes(r.engineCode)),engineCodes=engineLists[0],powers=[...new Set(rows.map(r=>Number(r.hp)))];
  if(version==='v3'||psa){
    if(rows.every(r=>!r.engineCode?.trim()))reasons.push('MANN_ENGINE_CODE_ABSENT');
    else if(engineLists.some(c=>!c.length))reasons.push('MANN_ENGINE_LABEL_UNSUPPORTED_OR_PARTLY_ABSENT');
    else if(engineLists.some(c=>sha(c)!==sha(engineCodes)))reasons.push('INCONSISTENT_MANN_ENGINE_CODES');
  }else if(!engineCodes.length||engineLists.some(c=>sha(c)!==sha(engineCodes)))reasons.push('INCONSISTENT_MANN_ENGINE_CODES');
  if(powers.length!==1||!Number.isFinite(powers[0])||powers[0]<=0)reasons.push('NO_UNIQUE_MANN_POWER');
  const windows=rows.map(r=>applicabilityWindow(s,r)),window=windows[0];
  if(!window?.intersection.from||!window?.intersection.to||windows.some(w=>sha(w)!==sha(window)))reasons.push('NO_CONSISTENT_FINITE_DATE_INTERSECTION');
  const branches=applications.flatMap(a=>(a.parsed?.branches??[]).map(b=>({...b,anchorRowId:a.rowId})));
  const matching=branches.filter(b=>engineCodes.includes(norm(b.engineCode))&&powers.length===1&&b.powerHp.includes(powers[0])&&window?.intersection.from&&window?.intersection.to
    && (!b.effectiveDates.to||b.effectiveDates.to>=window.intersection.from)&&b.effectiveDates.from<=window.intersection.to);
  if(matching.length!==1)reasons.push('NO_UNIQUE_LITERAL_ENGINE_POWER_DATE_BRANCH');
  const branch=matching.length===1?matching[0]:null;
  if(branch?.driveCondition&&!['2WD','FWD','RWD','4WD','AWD','2WD, 4WD'].includes(branch.driveCondition))reasons.push('UNSUPPORTED_VEHICLE_DRIVE_CONDITION');
  if(s.systemCode==='ENGINE_OIL'){if(branch?.anchorRowId!==row.row_id)reasons.push('OWN_ENGINE_APPLICATION_NOT_PROVEN');}
  else if(!labels[s.systemCode]?.includes(row.application?.trim())||row.model?.trim())reasons.push('OWN_FLUID_OR_COMPONENT_APPLICATION_REQUIRES_REVIEW');
  if(dateCondition(row.production_years??''))reasons.push('RAW_PRODUCTION_CONDITION');
  const parsedCapacity=capacity(original.fillVolumeText,original.systemCode),asNeeded=s.systemCode==='BRAKE_FLUID'&&row.fill_volume?.trim()==='по необходимости'&&!parsedCapacity.capacities.length;
  if(!asNeeded&&(parsedCapacity.needsReview||!parsedCapacity.capacities.length))reasons.push('CAPACITY_OR_SERVICE_CONDITION');
  const sections=splitSpecificationSections(original.specificationText,original.analogText);
  if(!['NO_EXPLICIT_MARKER','EXPLICIT_ANALOG_SEPARATED'].includes(sections.status)||specificationCautionSignals(original.specificationText).length)reasons.push('SPECIFICATION_ROLE_OR_PROHIBITION');
  if(!original.specificationText?.trim()&&s.systemCode!=='FUEL_TANK')reasons.push('MISSING_SPECIFICATION');
  if(/DPF|GPF|сажев|ниже\s*[-−]?\d|выше\s*[-−]?\d|с\s+кодом|без\s+кода/iu.test(original.specificationText??''))reasons.push('CONDITIONAL_SPECIFICATION');
  if(/Россия|Япония|Европа|США|ОАЭ|Китай|Корея|Азия/iu.test([row.fill_volume,row.specification,row.recommendation].join('\n')))reasons.push('OWN_FLUID_MARKET_CONDITION');
  const fingerprint=originalAssociationFingerprint(link.vehicleVariantKey,original,parsedCapacity),predecessors=live.data.filter(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===link.vehicleVariantKey);
  if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
  if(predecessors.some(r=>protectedIds.has(r.id)||r.reviewConfirmed||r.applyEligible||r.verificationStatus!=='UNVERIFIED'))reasons.push('PROTECTED_PREDECESSOR');
  const scope=branch&&window?{sourceVehicleScope:{make:link.sourceVehicle.canonicalMake,model:link.sourceVehicle.baseModel,...(link.sourceVehicle.generation?{generation:link.sourceVehicle.generation}:{})},matchedEngineScope:[norm(branch.engineCode)],
    window:{...window,intersection:{from:[window.intersection.from,branch.effectiveDates.from].sort().at(-1),to:[window.intersection.to,branch.effectiveDates.to].filter(Boolean).sort()[0]}},
    ...(branch.requiredMarket?{requiredMarket:branch.requiredMarket}:{}),
    ...(branch.requiredTransmission?{requiredTransmission:branch.requiredTransmission}:{}),
    ...(['2WD','FWD','RWD'].includes(branch.driveCondition)?{requiredVehicleDrive:'2WD'}:['4WD','AWD'].includes(branch.driveCondition)?{requiredVehicleDrive:'4WD'}:{})}:null;
  findings.push({sourceRequirementId:s.id,vehicleVariantKey:link.vehicleVariantKey,systemCode:s.systemCode,sampleRefs:link.sampleRefs,originalSourceHash:sha(original),effectiveSourceHash:sha(s),rawRowHash:sha(row),
    historicalValidated:link.independentlyValidated,historicalReviewBlockers:link.reviewBlockers,scope,branch,applications,parsedCapacity,sections,originalAssociationFingerprint:fingerprint,
    ...(version==='v3'||psa?{mannIdentity:{engineLabels:[...new Set(rows.map(r=>r.engineCode))],engineCodes,powerLabels:[...new Set(rows.map(r=>r.hp))]}}:{}),
    predecessors:predecessors.map(r=>({id:r.id,hash:sha(r)})),reasons:[...new Set(reasons)],status:reasons.length?'HOLD':'SCOPED_REMATCH_AND_RECONCILIATION_REQUIRED',productionApplyAllowed:false});
}
assert.equal(findings.length+alreadyDrafted.length+excludedNonVehicle.length,900);assert.equal(alreadyDrafted.length,current?5:0);
const summary={pairs:findings.length,excludedNonVehicle:excludedNonVehicle.length,sources:new Set(findings.map(f=>f.sourceRequirementId)).size,readyForScopedRematch:findings.filter(f=>!f.reasons.length).length,
  readyWithPredecessors:findings.filter(f=>!f.reasons.length&&f.predecessors.length).length,
  reasons:Object.fromEntries([...Map.groupBy(findings.flatMap(f=>f.reasons),r=>r)].map(([r,items])=>[r,items.length]))};
await writeFile(resolve(dir,`vin-priority-fluid-preflight-${version}.json`),JSON.stringify({kind:'ALL900_NONCONFLICT_VIN_PRIORITY_LINK_PREFLIGHT',planHash:sha(plan.raw),linksHash:sha(links.raw),manifestHash:sha(manifest.data),liveHash:sha(live.raw),reviewsHash:sha(reviews.raw),denylistHash:sha(deny.raw),correctedSourcesHash:sha(corrected),parserHash:sha(await readFile(resolve(root,'scripts/lib/mann-literal-engine-application.mjs'),'utf8')),psaParserHash:psa?sha(await readFile(resolve(root,'scripts/lib/mann-psa-literal-engine-application.mjs'),'utf8')):null,summary,findings,alreadyDrafted,excludedNonVehicle,
  limitations:['Historical conflict-free links are not current target validation. Every ready pair still needs independent full-make scoped rematch.','Known grammar only; unsupported component/spec conditions retained, not declared bad or manual work.','Predecessor reconciliation and joint runtime proof required before merge; no publication or OEM verification.'],productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
