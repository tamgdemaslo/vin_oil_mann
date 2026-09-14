import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {conditionalVehicleIdentityReasons} from './lib/mann-conditional-vehicle-identity.mjs';
import {sourceMarketBranches} from './lib/mann-source-market-branches.mjs';
import {gearboxSourceQuality} from './lib/mann-gearbox-source-quality.mjs';
import {splitSpecificationSections,specificationCautionSignals} from './lib/mann-specification-sections-v2.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&['type-count','compound-headings'].includes(process.argv[2])));
const typeCountMode=process.argv[2]==='type-count',headingMode=process.argv[2]==='compound-headings',protectedMode=typeCountMode||headingMode;
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,headingMode?'outputs/mann-compound-headings-recheck-2026-09-14':'outputs/mann-whole-source-current-recheck-2026-09-14');
const [summaryRaw,decisionsRaw,sql,mannRaw]=await Promise.all([readFile(resolve(dir,'summary.json'),'utf8'),readFile(resolve(dir,'decisions.ndjson'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8')]);
const summary=JSON.parse(summaryRaw);assert.equal(sha(decisionsRaw),summary.decisionsHash);assert.equal(sha(sql),summary.sourceHash);assert.equal(sha(mannRaw),summary.mannHash);
const planPath=typeCountMode?resolve(root,'outputs/mann-gearbox-year-added-preview-2026-09-14/plan.json'):summary.planPath;
const planRaw=await readFile(planPath,'utf8');assert.equal(sha(planRaw),typeCountMode?'9d961c0e9c9dbb4cad138d4192605b96350efc97c102aa1291911c87423fd6a7':summary.planHash);
const plan=JSON.parse(planRaw),liveRaw=protectedMode?await readFile(resolve(root,plan.inputFiles.live),'utf8'):null,live=liveRaw?JSON.parse(liveRaw):[];
if(protectedMode)assert.equal(sha(liveRaw),plan.inputHashes.live);
for(const [file,hash]of Object.entries(summary.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const overlay=await loadIdentityOverlay(root,sql,summary.identityOverlay.path,summary.identityOverlay.sha256),sources=new Map(overlay.requirements.map(s=>[s.id,s]));
const rawText=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8'),rawRows=rawText.trim().split('\n').map(JSON.parse),byRaw=new Map(rawRows.map(r=>[r.row_id,r]));
const anchors=Map.groupBy(rawRows.filter(r=>r.system_name==='МАСЛО в ДВИГАТЕЛЬ'),r=>`${r.source_url}:${r.table_index}`);
const rows=parseCopy(mannRaw,'mann_filter_applications'),variants=Map.groupBy(rows,r=>r.vehicleVariantKey),byMake=new Map();
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {splitMannEngineCodeList:split}=await jiti.import('../src/lib/mann-engine-code-list.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {parseFluidCapacities:capacity}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts'),{extractFluidSourceSystemContext:label}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const quality=gearboxSourceQuality([...overlay.originalById.values()],component,label),denyRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8'),denied=new Set(JSON.parse(denyRaw).rejectedAssociationFingerprints);
let selected=decisionsRaw.trim().split('\n').map(JSON.parse).filter(r=>r.oldCoverageStatus==='UNRESOLVED_MATCH_OR_CONDITIONS'&&!r.identityReasons.length&&r.decision.topCandidates[0]?.matchedFields.includes('точный код двигателя'));
let inventoryRaw=null;
if(typeCountMode){
 inventoryRaw=await readFile(resolve(dir,'source-type-count-audit-v1.json'),'utf8');const inventory=JSON.parse(inventoryRaw);assert.equal(inventory.planHash,sha(planRaw));assert.equal(inventory.sourceHash,sha(sql));
 selected=inventory.entries.map(entry=>{
  const s=sources.get(entry.sourceRequirementId);assert.ok(s);assert.deepEqual(entry.originalSource,overlay.originalById.get(s.id));
  if(!byMake.has(s.make)){const forms=new Set(mannMakeFormsForTest(s.make));byMake.set(s.make,rows.filter(t=>forms.has(normalizeMannText(t.makeNormalized||t.make))));}
  return {requirementId:s.id,originalSourceHash:entry.sourceHash,decision:match(s,byMake.get(s.make)),labelReasons:entry.reasons};
 });
}
if(headingMode){
 inventoryRaw=await readFile(resolve(dir,'verified-impact-v1.json'),'utf8');const inventory=JSON.parse(inventoryRaw);
 assert.equal(inventory.afterSummaryHash,sha(summaryRaw));assert.equal(inventory.planHash,sha(planRaw));assert.equal(inventory.sourceHash,sha(sql));
 selected=inventory.findings.filter(f=>f.transition.startsWith('MANN_CATALOG_GAP ->')&&f.decision.topCandidates.length).map(f=>({requirementId:f.sourceRequirementId,originalSourceHash:sha(f.originalSource),decision:f.decision}));
 assert.equal(selected.length,inventory.recoveredCandidateSources);assert.ok(selected.length>0);
}else assert.equal(selected.length,typeCountMode?22:328);
const findings=[];
for(const previous of selected){
 const source=sources.get(previous.requirementId),original=overlay.originalById.get(source.id),targetId=previous.decision.topCandidates[0]?.variantIds[0],targets=variants.get(targetId);assert.equal(sha(original),previous.originalSourceHash);
 if(typeCountMode&&!targets?.length){findings.push({sourceRequirementId:source.id,originalSource:original,sourceHash:sha(original),freshDecision:previous.decision,reasons:[...(previous.labelReasons??[]),'NO_MANN_TARGET'],publicationAllowed:false});continue;}
 assert.ok(targets?.length);
 const normalized=normalize(source);assert.ok(normalized);
 const engineCodes=normalized.sourceExactEngineCodes.filter(code=>targets.every(t=>split(t.engineCode).map(norm).includes(code)));
 const sourceEngineResiduals=normalized.sourceExactEngineCodes.filter(code=>!engineCodes.includes(code));
 const windows=targets.map(t=>applicabilityWindow(source,t)),window=windows[0],reasons=[...(previous.labelReasons??[])];
 if(protectedMode){
  if(source.driveType)reasons.push('SOURCE_DRIVE_CONDITION_REQUIRES_SCOPE');
  if(live.some(r=>r.sourceRequirementId===source.id&&(r.reviewConfirmed||r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS')))reasons.push('PROTECTED_LIVE_REVISION');
  if(plan.newRevisions.some(r=>r.sourceRequirementId===source.id))reasons.push('EXISTING_SCOPED_CANDIDATE_REQUIRES_RECONCILIATION');
 }
 if(!engineCodes.length)reasons.push('NO_ALL_TARGET_ROWS_EXACT_ENGINE');
 if(!window||windows.some(w=>sha(w)!==sha(window)))reasons.push('TARGET_WINDOWS_MISSING_OR_DIFFERENT');
 const powerChecks=targets.map(t=>({targetRowId:t.id,sourcePowerHp:source.powerHp,targetPowerHp:t.hp,exact:source.powerHp!=null&&String(t.hp??'').trim()!==''&&Number(t.hp)===source.powerHp}));
 if(!powerChecks.every(p=>p.exact))reasons.push('POWER_MISSING_OR_NOT_EXACT');
 const raw=byRaw.get(source.sourceRowId),sameTable=raw?anchors.get(`${raw.source_url}:${raw.table_index}`)??[]:[];
 if(!raw)reasons.push('RAW_SOURCE_MISSING');
 const marketAnchors=sameTable.filter(a=>/Россия|Япония|Европа|США|ОАЭ|Ю\. Корея|Ю-В Азия/iu.test(a.model??''));
 const marketBranches=marketAnchors.map(a=>({rawAnchor:a,anchorHash:sha(a),branches:sourceMarketBranches(a.model,a.production_years)}));
 if(marketAnchors.length)reasons.push('EXPLICIT_MARKET_BRANCH_PARTITION_REQUIRED');
 if(sourceEngineResiduals.length)reasons.push('SOURCE_ENGINE_RESIDUALS_REQUIRE_PARTITION');
 if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_CONFLICT');
 const parsedCapacity=capacity(source.fillVolumeText,source.systemCode);
 if(parsedCapacity.needsReview)reasons.push('CAPACITY_CONDITIONS_REQUIRE_REVIEW');
 if(quality.heldBySource.has(source.id))reasons.push('GEARBOX_SOURCE_CONFLICT');
 const fingerprint=originalAssociationFingerprint(targetId,original,capacity(original.fillVolumeText,original.systemCode));
 if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
 const sections=splitSpecificationSections(source.specificationText,source.analogText),cautions=specificationCautionSignals(source.specificationText);
 if(!['NO_EXPLICIT_MARKER','EXPLICIT_ANALOG_SEPARATED'].includes(sections.status))reasons.push('SPECIFICATION_BOUNDARY_REVIEW');
 if(cautions.length)reasons.push('SPECIFICATION_CAUTION_REVIEW');
 let clippedDecision=null;
 if(window&&engineCodes.length){
  if(!byMake.has(source.make)){const forms=new Set(mannMakeFormsForTest(source.make));byMake.set(source.make,rows.filter(t=>forms.has(normalizeMannText(t.makeNormalized||t.make))));}
  const effective={...source,...window.narrowedYears,engineCodeNormalized:engineCodes[0],engineCodesJson:engineCodes};
  clippedDecision=match(effective,byMake.get(source.make));const top=clippedDecision.topCandidates[0];
  reasons.push(...conditionalVehicleIdentityReasons(effective,top));
  if(!top||top.variantIds.length!==1||top.variantIds[0]!==targetId||top.score<80)reasons.push('CLIPPED_TARGET_NOT_STRONG_UNIQUE_TOP');
  if(top){reasons.push(...top.hardConflicts);if(clippedDecision.topCandidates.slice(1).some(c=>!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=top.score-10))reasons.push('CLIPPED_NEARBY_EXACT_ENGINE_ALTERNATIVE');}
 }
 const blockers=clippedDecision?.topCandidates[0]?.reviewBlockers??previous.decision.topCandidates[0].reviewBlockers;
 const accepted=new Set(['MANN variant не подтверждает тип или модель коробки','MANN variant не подтверждает привод или модель агрегата','MANN variant не подтверждает наличие этой гидравлической системы']);
 for(const b of blockers)if(!accepted.has(b))reasons.push(`UNHANDLED_REVIEW_BLOCKER: ${b}`);
 findings.push({sourceRequirementId:source.id,originalSource:original,sourceHash:sha(original),effectiveSourceHash:sha(source),targetId,targetRowIds:targets.map(t=>t.id),engineCodes,sourceEngineResiduals,window,powerChecks,marketBranches,parsedCapacity,sourceSystemContext:label(source.systemNameRaw,source.componentModel),component:component(source.componentModel),specificationSections:sections,cautions,originalAssociationFingerprint:fingerprint,clippedDecision,reasons:[...new Set(reasons)],remainingConditionalBlockers:blockers,publicationAllowed:false});
 if(findings.length%50===0)console.log(JSON.stringify({processed:findings.length,total:selected.length}));
}
const result={sourceHash:sha(sql),mannHash:sha(mannRaw),planHash:sha(planRaw),summaryHash:sha(summaryRaw),rawHash:sha(rawText),denylistHash:sha(denyRaw),checked:findings.length,readyForConditionalDraftReview:findings.filter(f=>!f.reasons.length).length,reasonCounts:Object.fromEntries([...Map.groupBy(findings.flatMap(f=>f.reasons),s=>s)].map(([k,v])=>[k,v.length])),findings,productionApplyAllowed:false,limitation:'Batch preflight, not automatic draft/publication. Conditional equipment/model/count facts, raw engine-power mapping, source provenance, OEM truth and residual months still require policy-specific checks. Market regex is not exhaustive.'};
if(protectedMode){result.planPath=planPath;result.inventoryHash=sha(inventoryRaw);result.liveHash=sha(liveRaw);result.codeHashes=Object.fromEntries(await Promise.all([...Object.keys(summary.codeHashes),'scripts/recheck-mann-strong-source-conditions.mjs','src/lib/mann-transmission-component.ts','src/lib/fluid-source-system-context.ts'].map(async file=>[file,sha(await readFile(resolve(root,file),'utf8'))])));}
await writeFile(resolve(dir,headingMode?'compound-heading-preflight-v1.json':typeCountMode?'source-type-count-preflight-v1.json':'strong-source-conditions-v1.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...result,findings:undefined}));
