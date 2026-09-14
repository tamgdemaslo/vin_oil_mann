import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {toyotaExplicitEngineBranches} from './lib/mann-toyota-explicit-engine-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-alphard-ru-preview-2026-09-14');
const [sql,mannRaw,planRaw,auditRaw,rawText]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(root,'outputs/mann-mercedes-transmission-list-preview-2026-09-14/toyota-new-pair-source-branches-v1.json'),'utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const plan=JSON.parse(planRaw),audit=JSON.parse(auditRaw);assert.equal(audit.sourceHash,sha(sql));assert.equal(audit.mannHash,sha(mannRaw));assert.equal(audit.rawHash,sha(rawText));assert.equal(plan.inputHashes.source,sha(sql));
const overlay=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json')),sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const sourceId='1a5f7cff1887b1199015eb2bcab5f0313288a2591e00c5f1fd4e3602880c2cd6',original=overlay.originalById.get(sourceId),source=sources.get(sourceId);
const proposals=audit.results.filter(r=>r.sourceRequirementId===sourceId);assert.equal(proposals.length,2);assert.ok(proposals.every(r=>r.sourceHash===sha(original)));
const rawRows=new Map(rawText.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r])),evidence=proposals[0].evidence[0],anchor=rawRows.get(evidence.rowId),rawSource=rawRows.get(original.sourceRowId);
assert.equal(sha(anchor),evidence.rowHash);assert.equal(anchor.source_url,rawSource.source_url);assert.equal(anchor.table_index,rawSource.table_index);
const engines=toyotaExplicitEngineBranches(anchor.model);assert.deepEqual(engines,evidence.branches);assert.equal(engines.length,2);assert.ok(engines.every(b=>b.requiredMarket===null));
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {parseConditionalFluidCapacities:parseBranches}=await jiti.import('../src/lib/fluid-capacity-conditions.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {extractFluidSourceSystemContext:label}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const parsed=parseBranches(original.fillVolumeText,source.systemCode,source.engineCodesJson);assert.equal(parsed.status,'structured');assert.equal(parsed.branches.length,2);
const metadata=label(source.systemNameRaw,source.componentModel);assert.deepEqual(metadata.issues,[]);assert.equal(metadata.hasAdditionalLabelConditions,false);assert.notEqual(source.rawRequirementJson?.sourceIdentity?.reviewRequired,true);
const forms=new Set(mannMakeFormsForTest('TOYOTA')),rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const policy='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1',revisions=[],review=[],results=[];let checks=0;
const month=n=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`,index=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
for(const proposal of proposals){
 const targetRows=variants.get(proposal.vehicleVariantKey);assert.ok(targetRows?.length);assert.equal(proposal.matchingBranches.length,1);
 const engine=proposal.matchingBranches[0];assert.ok(engines.some(e=>e.engineCode===engine.engineCode&&e.powerHp===engine.powerHp));assert.ok(targetRows.every(r=>String(r.hp)===String(engine.powerHp)));
 const scoped={...source,engineCodeNormalized:engine.engineCode,engineCodesJson:[engine.engineCode],powerHp:engine.powerHp,powerKw:null};
 const windows=targetRows.map(r=>applicabilityWindow(scoped,r));assert.ok(windows.every(Boolean));assert.equal(new Set(windows.map(sha)).size,1);const window=windows[0];
 const applicabilityJson={sourceVehicleScope:{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})},matchedEngineScope:[engine.engineCode],window,engineCodes:original.engineCodesJson};
 const fingerprint=originalAssociationFingerprint(proposal.vehicleVariantKey,original,parse(original.fillVolumeText,source.systemCode));assert.ok(!denied.has(fingerprint));
 assert.ok(!plan.newRevisions.some(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===proposal.vehicleVariantKey));
 const predecessors=live.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===proposal.vehicleVariantKey);assert.ok(!predecessors.some(r=>r.reviewConfirmed||r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'));
 const branches=[];
 for(const branch of parsed.branches){
  assert.equal(branch.condition.kind,'transmission');assert.ok(!source.transmissionType||source.transmissionType===branch.condition.value);
  const decision=match({...scoped,...window.narrowedYears,fillVolumeText:branch.sourceSegment},rows),validation=decision.targets.find(t=>t.vehicleVariantKey===proposal.vehicleVariantKey&&t.independentlyValidated);
  results.push({vehicleVariantKey:proposal.vehicleVariantKey,engine,condition:branch.condition,decision});
  if(!validation){review.push({sourceRequirementId:source.id,vehicleVariantKey:proposal.vehicleVariantKey,engine,condition:branch.condition,reason:'BRANCH_TARGET_NOT_VALIDATED'});continue;}
  branches.push({condition:branch.condition,sourceSegment:branch.sourceSegment,applicabilityJson,validation,originalAssociationFingerprint:fingerprint});
 }
 if(branches.length!==parsed.branches.length)continue;
 const technicalDataJson={fillVolumeText:original.fillVolumeText,capacityBranches:branches,specifications:original.specificationsJson,viscosityGrades:original.viscosityGradesJson};
 for(const key of ['specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])technicalDataJson[key]=original[key];
 const key=`${source.id}:${proposal.vehicleVariantKey}`,hash=sha({key,policy,applicabilityJson,technicalDataJson});
 const revision={id:`mtar_${hash.slice(0,24)}`,semanticFingerprint:hash,sourceRequirementId:source.id,vehicleVariantKey:proposal.vehicleVariantKey,systemCode:source.systemCode,componentModel:source.componentModel,applicabilityJson,technicalDataJson,verifiedFieldsJson:[],fieldConfidenceJson:{'technical.capacity':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.specifications':'SECONDARY_SOURCE_PARSED_MEDIUM','technical.replacementInterval':'SECONDARY_SOURCE_PARSED_MEDIUM'},evidenceJson:[{publisher:'podbormasla.ru',url:source.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,independentValidation:{independentlyValidated:true,hardConflicts:[],reviewBlockers:[]},sourceEngineBranch:engine,sourceEngineEvidence:evidence,sourceAssociationFingerprint:fingerprint},state:'STAGED',verificationStatus:'UNVERIFIED',matchClass:'CONFIRMED_MULTI_APPLICABILITY',matchScore:Math.min(...branches.map(b=>b.validation.score)),applyEligible:false,replacesRevisionIds:predecessors.map(r=>r.id)};
 const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:policy,automaticProductSelection:false}}};
 const w=window.intersection;assert.ok(w.from&&w.to);
 for(let n=source.yearFrom*12-1;n<=(source.yearTo+1)*12;n++)for(const engineCode of [...engines.map(e=>e.engineCode),'WRONG',undefined])for(const type of [undefined,'cvt','manual','automatic','robot']){
  const items=profile([runtime],type,{...applicabilityJson.sourceVehicleScope,engineCode,productionMonth:month(n)}).items;
  const valid=engineCode===engine.engineCode&&n>=index(w.from)&&n<=index(w.to),liters=valid&&type==='cvt'?5.8:valid&&type==='manual'?5.6:null;
  const capacities=items.flatMap(i=>i.capacities);assert.equal(capacities.length,liters===null?0:1);if(liters!==null)assert.equal(capacities[0].nominalLiters,liters);if(!valid)assert.equal(items.length,0);for(const i of items)assert.equal(i.automaticSelectionEligible,false);checks++;
 }
 revisions.push(revision);
}
const report={sourceHash:sha(sql),mannHash:sha(mannRaw),rawHash:sha(rawText),planHash:sha(planRaw),auditHash:sha(auditRaw),liveHash:sha(liveRaw),codeHashes:Object.fromEntries(await Promise.all(['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-engine-code-list.ts','src/lib/fluid-capacity-conditions.ts','src/lib/fluid-capacity-parser.ts','src/lib/mann-capacity-branches.ts','src/lib/mann-unified-technical-profile.ts','src/lib/mann-technical-applicability.ts','scripts/lib/mann-toyota-explicit-engine-branches.mjs'].map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary:{targets:proposals.length,branchRechecks:results.length,revisions:revisions.length,review:review.length,checks},revisions,review,results,originalSource:original,engineBranches:engines,productionApplyAllowed:false,limitation:'Source branches and runtime verified, not OEM capacities or physical transmission confirmation. Independent source engine/transmission/month partition and joint merge required.'};
await writeFile(resolve(dir,'corolla-cvt-coolant-preview-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
