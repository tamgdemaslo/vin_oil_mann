import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {toyotaExplicitEngineBranches} from './lib/mann-toyota-explicit-engine-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-transmission-list-preview-2026-09-14');
const [sourceRaw,mannRaw,planRaw,auditRaw,rawText]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'toyota-new-pair-source-branches-v1.json'),'utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const plan=JSON.parse(planRaw),audit=JSON.parse(auditRaw);assert.equal(audit.sourceHash,sha(sourceRaw));assert.equal(audit.mannHash,sha(mannRaw));assert.equal(audit.rawHash,sha(rawText));assert.equal(plan.inputHashes.source,sha(sourceRaw));
assert.equal(audit.helperHash,sha(await readFile(resolve(root,'scripts/lib/mann-toyota-explicit-engine-branches.mjs'),'utf8')));
const rawRows=new Map(rawText.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json')),sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {extractFluidSourceSystemContext:label}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const forms=new Set(mannMakeFormsForTest('TOYOTA')),rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1',revisions=[],review=[],pending=[],decisions=[];
let checks=0,totalMonths=0,coveredMonths=0;
const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1,month=n=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;
const selected=audit.results.filter(r=>r.originalSource.model==='alphard');assert.equal(selected.length,3);
for(const entry of selected){
 const source=sources.get(entry.sourceRequirementId),original=overlay.originalById.get(source.id);assert.equal(sha(original),entry.sourceHash);
 const sourceRow=rawRows.get(original.sourceRowId);assert.ok(sourceRow);
 assert.equal(entry.evidence.length,1);const evidence=entry.evidence[0],anchor=rawRows.get(evidence.rowId);assert.equal(sha(anchor),evidence.rowHash);
 assert.equal(anchor.source_url,sourceRow.source_url);assert.equal(anchor.table_index,sourceRow.table_index);
 if(source.systemCode==='ENGINE_OIL')assert.equal(anchor.row_id,sourceRow.row_id);
 const branches=toyotaExplicitEngineBranches(anchor.model);assert.deepEqual(branches,evidence.branches);assert.equal(branches.length,2);
 const branch=branches.find(b=>b.requiredMarket==='RU');assert.ok(branch);assert.equal(branch.powerHp,300);assert.equal(branch.yearTo,2022);
 const scoped={...source,engineCodeNormalized:branch.engineCode,engineCodesJson:[branch.engineCode],powerHp:branch.powerHp,powerKw:null,yearFrom:branch.yearFrom,yearTo:branch.yearTo};
 const targetRows=variants.get(entry.vehicleVariantKey);assert.ok(targetRows?.length);assert.ok(targetRows.every(r=>String(r.hp)==='300'));
 const windows=targetRows.map(r=>applicabilityWindow(scoped,r));assert.ok(windows.every(Boolean));assert.equal(new Set(windows.map(sha)).size,1);const window=windows[0];
 const decision=match({...scoped,...window.narrowedYears},rows),target=decision.targets.find(t=>t.vehicleVariantKey===entry.vehicleVariantKey&&t.independentlyValidated);
 decisions.push({sourceRequirementId:source.id,sourceContext:scoped,decision});
 const reasons=[],metadata=label(source.systemNameRaw,source.componentModel),capacity=parse(original.fillVolumeText,source.systemCode);
 if(!target||!['CONFIRMED_SINGLE','CONFIRMED_MULTI_APPLICABILITY'].includes(decision.status))reasons.push('SCOPED_IDENTITY_REVIEW');
 if(metadata.issues.length||metadata.hasAdditionalLabelConditions)reasons.push('SOURCE_LABEL_REVIEW');
 if(capacity.needsReview||!capacity.capacities.length)reasons.push('CAPACITY_REVIEW');
 if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_REVIEW');
 const association=originalAssociationFingerprint(entry.vehicleVariantKey,original,capacity);if(denied.has(association))reasons.push('DENIED_ASSOCIATION');
 const old=live.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===entry.vehicleVariantKey);
 if(old.some(r=>r.reviewConfirmed||r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'))reasons.push('PROTECTED_PREDECESSOR');
 assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===entry.vehicleVariantKey));
 if(reasons.length){review.push({sourceRequirementId:source.id,sourceHash:sha(original),reasons});continue;}
 const applicability={sourceVehicleScope:{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})},matchedEngineScope:[branch.engineCode],requiredMarket:'RU',window};
 const technical={fillVolumeText:original.fillVolumeText,capacities:capacity.capacities,specifications:original.specificationsJson,viscosityGrades:original.viscosityGradesJson};
 for(const key of ['specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])technical[key]=original[key];
 const fingerprint=sha({policy,sourceRequirementId:source.id,vehicleVariantKey:entry.vehicleVariantKey,applicability,technicalData:technical});
 const revision={id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,sourceRequirementId:source.id,vehicleVariantKey:entry.vehicleVariantKey,systemCode:source.systemCode,componentModel:source.componentModel,applicabilityJson:applicability,technicalDataJson:technical,verifiedFieldsJson:[],
 fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:source.sourceUrl}],
 provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:association,independentValidation:target,sourceEngineScope:scoped,sourceEngineEvidence:evidence,sourceMarketBranch:branch,auditHash:sha(auditRaw)},matchClass:decision.status,matchScore:target.score,state:'STAGED',verificationStatus:'UNVERIFIED',applyEligible:false,replacesRevisionIds:old.map(r=>r.id)};
 const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:policy,automaticProductSelection:false}}};
 const w=window.intersection;assert.ok(w.from&&w.to);
 for(let n=2018*12-1;n<=2024*12;n++)for(const engineCode of [branch.engineCode,'WRONG',undefined])for(const confirmedMarket of ['RU','JP','DE',undefined]){
  const items=profile([runtime],undefined,{...applicability.sourceVehicleScope,productionMonth:month(n),engineCode,confirmedMarket}).items;
  assert.equal(items.length,engineCode===branch.engineCode&&confirmedMarket==='RU'&&n>=index(w.from)&&n<=index(w.to)?1:0);for(const item of items)assert.equal(item.automaticSelectionEligible,false);checks++;
 }
 for(const b of branches){
  let start=null;
  for(let n=b.yearFrom*12;n<=b.yearTo*12+12;n++){
   const end=n===b.yearTo*12+12,covered=!end&&b.requiredMarket==='RU'&&b.engineCode===branch.engineCode&&b.powerHp===branch.powerHp&&n>=index(w.from)&&n<=index(w.to);
   if(!end){totalMonths++;if(covered)coveredMonths++;}
   if(!end&&!covered&&start===null)start=n;
   if((end||covered)&&start!==null){pending.push({sourceRequirementId:source.id,sourceHash:sha(original),originalSource:original,sourceBranch:b,requiredMarket:b.requiredMarket,matchedEngineScope:[b.engineCode],window:{from:month(start),to:month(n-1)},reason:'UNCOVERED_SOURCE_MARKET_ENGINE_POWER_MONTHS',publicationAllowed:false});start=null;}
  }
 }
 revisions.push(revision);
}
const report={sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),rawHash:sha(rawText),planHash:sha(planRaw),auditHash:sha(auditRaw),liveHash:sha(liveRaw),codeHashes:Object.fromEntries(await Promise.all(['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-engine-code-list.ts','src/lib/mann-unified-technical-profile.ts','src/lib/mann-technical-applicability.ts','src/lib/fluid-capacity-parser.ts','src/lib/fluid-source-system-context.ts','scripts/lib/mann-toyota-explicit-engine-branches.mjs'].map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary:{considered:3,revisions:revisions.length,review:review.length,checks,totalBranchMonths:totalMonths,coveredBranchMonths:coveredMonths,pendingBranchMonths:totalMonths-coveredMonths,pendingIntervals:pending.length},revisions,review,pending,decisions,productionApplyAllowed:false,limitation:'Synthetic runtime/source-domain partition, secondary technical facts unverified. Original source text preserved; no OEM coolant analog compatibility or physical VIN market verification. Joint merge and independent partition checks still required.'};
await writeFile(resolve(dir,'alphard-ru-preview-supplement-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
