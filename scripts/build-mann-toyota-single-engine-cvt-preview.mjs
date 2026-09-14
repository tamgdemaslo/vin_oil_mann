import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {toyotaExplicitEngineBranches} from './lib/mann-toyota-explicit-engine-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-corolla-cvt-preview-2026-09-14');
const [sql,mannRaw,planRaw,auditRaw,rawText]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'remaining-cvt-capacity-recheck-v1.json'),'utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const plan=JSON.parse(planRaw),audit=JSON.parse(auditRaw);assert.equal(audit.sourceHash,sha(sql));assert.equal(audit.mannHash,sha(mannRaw));assert.equal(audit.planHash,sha(planRaw));
for(const [file,hash] of Object.entries(audit.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,'src/lib',file),'utf8')));
const overlay=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json')),sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const rawRows=rawText.trim().split('\n').map(JSON.parse),byId=new Map(rawRows.map(r=>[r.row_id,r]));
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {parseConditionalFluidCapacities:parseBranches}=await jiti.import('../src/lib/fluid-capacity-conditions.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {extractFluidSourceSystemContext:label}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const forms=new Set(mannMakeFormsForTest('TOYOTA')),rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const ids=[...new Set(audit.accepted.filter(a=>sources.get(a.sourceRequirementId).make==='toyota').map(a=>a.sourceRequirementId))];assert.equal(ids.length,2);
const policy='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1',revisions=[],pending=[],results=[];let checks=0,total=0,covered=0;
const index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1,month=n=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;
for(const id of ids){
 const source=sources.get(id),original=overlay.originalById.get(id),raw=byId.get(original.sourceRowId);assert.ok(raw);
 const anchors=rawRows.filter(r=>r.source_url===raw.source_url&&r.table_index===raw.table_index&&/МАСЛО\s+в\s+ДВИГАТЕЛЬ/iu.test(r.application));assert.equal(anchors.length,1);
 const engines=toyotaExplicitEngineBranches(anchors[0].model);assert.equal(engines?.length,1);const engine=engines[0];assert.equal(engine.requiredMarket,null);assert.equal(engine.powerHp,source.powerHp);
 const years=anchors[0].production_years.match(/^(\d{4})\s*-\s*(\d{4})$/);assert.ok(years);assert.equal(Number(years[1]),source.yearFrom);assert.equal(Number(years[2]),source.yearTo);
 const scoped={...source,engineCodeNormalized:engine.engineCode,engineCodesJson:[engine.engineCode]};
 const accepted=audit.accepted.filter(a=>a.sourceRequirementId===id),keys=[...new Set(accepted.map(a=>a.vehicleVariantKey))];assert.equal(keys.length,1);const key=keys[0],target=variants.get(key);assert.ok(target.every(r=>String(r.hp)===String(engine.powerHp)));
 const windows=target.map(r=>applicabilityWindow(scoped,r));assert.ok(windows.every(Boolean));assert.equal(new Set(windows.map(sha)).size,1);const window=windows[0];
 const metadata=label(source.systemNameRaw,source.componentModel);assert.deepEqual(metadata.issues,[]);assert.equal(metadata.hasAdditionalLabelConditions,false);assert.notEqual(source.rawRequirementJson?.sourceIdentity?.reviewRequired,true);
 const parsed=parseBranches(original.fillVolumeText,source.systemCode,original.engineCodesJson);assert.equal(parsed.status,'structured');assert.equal(parsed.branches.length,2);
 const association=originalAssociationFingerprint(key,original,parse(original.fillVolumeText,source.systemCode));assert.ok(!denied.has(association));
 const old=live.filter(r=>r.sourceRequirementId===id&&r.vehicleVariantKey===key);assert.ok(!old.some(r=>r.reviewConfirmed||r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'));
 assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===id&&r.vehicleVariantKey===key));
 const scope={sourceVehicleScope:{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})},matchedEngineScope:[engine.engineCode],engineCodes:original.engineCodesJson,window},branches=[];
 for(const b of parsed.branches){
  assert.equal(b.condition.kind,'transmission');assert.ok(!source.transmissionType||source.transmissionType===b.condition.value);
  const decision=match({...scoped,...window.narrowedYears,fillVolumeText:b.sourceSegment},rows),validation=decision.targets.find(t=>t.vehicleVariantKey===key&&t.independentlyValidated);assert.ok(validation,'Exact single engine branch must rerank successfully');
  branches.push({condition:b.condition,sourceSegment:b.sourceSegment,applicabilityJson:scope,validation,originalAssociationFingerprint:association});results.push({sourceRequirementId:id,condition:b.condition,decision});
  let start=null;for(let n=source.yearFrom*12;n<=(source.yearTo+1)*12;n++){
   const end=n===(source.yearTo+1)*12,visible=!end&&n>=index(window.intersection.from)&&n<=index(window.intersection.to);if(!end){total++;if(visible)covered++;}
   if(!end&&!visible&&start===null)start=n;
   if((end||visible)&&start!==null){pending.push({sourceRequirementId:id,sourceHash:sha(original),originalSource:original,sourceEngineBranch:engine,condition:b.condition,window:{from:month(start),to:month(n-1)},reason:'UNCOVERED_ENGINE_TRANSMISSION_MONTHS',publicationAllowed:false});start=null;}
  }
 }
 const technicalDataJson={fillVolumeText:original.fillVolumeText,capacityBranches:branches,specifications:original.specificationsJson,viscosityGrades:original.viscosityGradesJson};for(const field of ['specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])technicalDataJson[field]=original[field];
 const fingerprint=sha({key:`${id}:${key}`,policy,applicabilityJson:scope,technicalDataJson});
 const revision={id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,sourceRequirementId:id,vehicleVariantKey:key,systemCode:source.systemCode,componentModel:source.componentModel,applicabilityJson:scope,technicalDataJson,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.specifications':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.replacementInterval':'SECONDARY_SOURCE_PARSED_MEDIUM'},evidenceJson:[{publisher:'podbormasla.ru',url:source.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,independentValidation:{independentlyValidated:true,hardConflicts:[],reviewBlockers:[]},sourceEngineBranch:engine,sourceEngineEvidence:{rowId:anchors[0].row_id,rowHash:sha(anchors[0]),originalRow:anchors[0]},sourceAssociationFingerprint:association},state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:'CONFIRMED_MULTI_APPLICABILITY',matchScore:Math.min(...branches.map(b=>b.validation.score)),applyEligible:false,replacesRevisionIds:old.map(r=>r.id)};
 const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:policy,automaticProductSelection:false}}};
 for(let n=source.yearFrom*12-1;n<=(source.yearTo+1)*12;n++)for(const engineCode of [engine.engineCode,'WRONG',undefined])for(const type of [undefined,'manual','cvt','automatic','robot']){
  const items=profile([runtime],type,{...scope.sourceVehicleScope,engineCode,productionMonth:month(n)}).items,valid=engineCode===engine.engineCode&&n>=index(window.intersection.from)&&n<=index(window.intersection.to),b=parsed.branches.find(b=>b.condition.value===type),capacities=items.flatMap(i=>i.capacities);
  assert.equal(capacities.length,valid&&b?1:0);if(valid&&b)assert.equal(capacities[0].nominalLiters,b.capacity.nominalLiters);if(!valid)assert.equal(items.length,0);for(const i of items)assert.equal(i.automaticSelectionEligible,false);checks++;
 }
 revisions.push(revision);
}
const report={sourceHash:sha(sql),mannHash:sha(mannRaw),rawHash:sha(rawText),planHash:sha(planRaw),auditHash:sha(auditRaw),liveHash:sha(liveRaw),codeHashes:Object.fromEntries(await Promise.all(['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-engine-code-list.ts','src/lib/fluid-capacity-conditions.ts','src/lib/fluid-capacity-parser.ts','src/lib/mann-capacity-branches.ts','src/lib/mann-unified-technical-profile.ts','src/lib/mann-technical-applicability.ts','src/lib/fluid-source-system-context.ts','scripts/lib/mann-toyota-explicit-engine-branches.mjs'].map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary:{sources:ids.length,revisions:revisions.length,branchRechecks:results.length,checks,totalBranchMonths:total,coveredBranchMonths:covered,pendingBranchMonths:total-covered,pendingIntervals:pending.length},revisions,pending,results,productionApplyAllowed:false,limitation:'Secondary technical facts unverified. Synthetic runtime and source months partition; independent partition and joint merge still needed.'};
await writeFile(resolve(dir,'toyota-single-engine-cvt-preview-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
