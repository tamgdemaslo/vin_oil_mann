import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-compressed-preview-2026-09-14');
const [auditRaw,sourceRaw,mannRaw,labelsRaw,planRaw]=await Promise.all([
 readFile(resolve(dir,'mercedes-bulk-source-engine-recheck-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),
 readFile(resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-system-context-v3.json'),'utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const audit=JSON.parse(auditRaw),plan=JSON.parse(planRaw),labels=JSON.parse(labelsRaw);
assert.equal(audit.planHash,sha(planRaw));assert.equal(audit.sourceHash,sha(sourceRaw));assert.equal(audit.mannHash,sha(mannRaw));assert.equal(labels.sourceHash,sha(sourceRaw));
for(const [field,file] of [['matcherHash','mann-fluid-matcher-v2.ts'],['resolverHash','mann-vehicle-resolver.ts'],['targetParserHash','mann-engine-code-list.ts']])assert.equal(audit[field],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),byLabel=new Map(labels.findings.map(r=>[r.requirementId,r]));
const catalog=parseCopy(mannRaw,'mann_filter_applications'),byVariant=Map.groupBy(catalog,r=>r.vehicleVariantKey);
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts');
const {splitMannEngineCodeList:split}=await jiti.import('../src/lib/mann-engine-code-list.ts');
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1',revisions=[],review=[],pending=[];let considered=0,checks=0;
const monthIndex=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1;
for(const result of audit.results)for(const branch of result.branches.filter(b=>!b.reasons.length))for(const target of branch.targets.filter(t=>!t.denied&&!t.existingRevisionIds.length)){
 considered++;
 const original=overlay.originalById.get(result.sourceRequirementId),source=sources.get(original.id);assert.equal(sha(original),result.sourceHash);
 const label=byLabel.get(original.id);assert.equal(label.sourceHash,sha(original));
 const rows=byVariant.get(target.vehicleVariantKey);assert.ok(rows?.length);
 const recovered={...source,...branch.recoveredEngineContext},reasons=[];
 const windows=rows.map(row=>applicabilityWindow(recovered,row));
 if(windows.some(w=>!w)||new Set(windows.map(w=>JSON.stringify(w?.intersection))).size!==1)reasons.push('TARGET_MONTH_WINDOWS_DIFFER');
 const window=windows[0];
 if(!window?.intersection.from||!window?.intersection.to)reasons.push('UNBOUNDED_OR_MISSING_MONTH_WINDOW');
 const targetCodes=new Set(rows.flatMap(r=>split(r.engineCode).map(s=>norm(s.trim()))));
 const engines=recovered.engineCodesJson.filter(c=>targetCodes.has(norm(c)));
 if(!engines.length)reasons.push('NO_EXACT_TARGET_ENGINE');
 if(rows.some(r=>String(r.hp??'').trim()!==String(recovered.powerHp)))reasons.push('TARGET_POWER_NOT_EXACT_SINGLE_VALUE');
 if(label.extracted.issues.length||label.extracted.hasAdditionalLabelConditions)reasons.push('SOURCE_LABEL_REVIEW');
 const old=live.filter(r=>r.sourceRequirementId===original.id&&r.vehicleVariantKey===target.vehicleVariantKey);
 if(old.some(r=>r.reviewConfirmed||r.verificationStatus==='PRIMARY_SOURCE_VERIFIED_FIELDS'))reasons.push('PROTECTED_PREDECESSOR');
 const capacity=parse(original.fillVolumeText,original.systemCode);if(capacity.needsReview||!capacity.capacities.length)reasons.push('CAPACITY_REVIEW');
 assert.equal(originalAssociationFingerprint(target.vehicleVariantKey,original,capacity),target.originalAssociationFingerprint);
 if(reasons.length){review.push({sourceRequirementId:original.id,vehicleVariantKey:target.vehicleVariantKey,reasons,branch});continue;}
 const applicability={sourceVehicleScope:{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})},matchedEngineScope:engines,window};
 const technical={fillVolumeText:original.fillVolumeText,capacities:capacity.capacities,specifications:original.specificationsJson,viscosityGrades:original.viscosityGradesJson};
 for(const key of ['specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])technical[key]=original[key];
 const fingerprint=sha({policy,sourceRequirementId:original.id,vehicleVariantKey:target.vehicleVariantKey,applicability,technicalData:technical});
 const revision={id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,sourceRequirementId:original.id,vehicleVariantKey:target.vehicleVariantKey,
 systemCode:original.systemCode,componentModel:original.componentModel,applicabilityJson:applicability,technicalDataJson:technical,verifiedFieldsJson:[],
 fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),
 evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:original.sourceUrl}],
 provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:target.originalAssociationFingerprint,
 independentValidation:target,sourceEngineScope:branch.recoveredEngineContext,sourceEngineEvidence:branch.evidence,bulkAuditHash:sha(auditRaw)},
 matchClass:branch.status,matchScore:target.score,state:'STAGED',verificationStatus:'UNVERIFIED',applyEligible:false,replacesRevisionIds:old.map(r=>r.id)};
 const runtime={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:policy,automaticProductSelection:false}}};
 const bounds=window.intersection,lo=monthIndex(bounds.from),hi=monthIndex(bounds.to);
 for(let m=lo-1;m<=hi+1;m++)for(const engineCode of [...engines,'WRONG',undefined]){
   const ctx={...applicability.sourceVehicleScope,engineCode,productionMonth:`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`};
   const items=profile([runtime],undefined,ctx).items,expected=engines.includes(engineCode)&&m>=lo&&m<=hi;
   assert.equal(items.length,expected?1:0);for(const item of items)assert.equal(item.automaticSelectionEligible,false);checks++;
 }
 revisions.push(revision);
 pending.push({sourceRequirementId:original.id,sourceHash:sha(original),originalSource:original,anchorRowId:branch.anchorRowId,sourceEngineContext:branch.recoveredEngineContext,
   acceptedEngineScope:engines,acceptedWindow:bounds,reason:'SOURCE_ENGINE_MONTH_PARTITION_NOT_YET_RECONCILED',publicationAllowed:false});
}
assert.equal(considered,45);assert.equal(new Set(revisions.map(r=>r.id)).size,revisions.length);
const report={planHash:sha(planRaw),auditHash:sha(auditRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),labelsHash:sha(labelsRaw),liveHash:sha(liveRaw),
 resolverHash:audit.resolverHash,matcherHash:audit.matcherHash,targetParserHash:audit.targetParserHash,
 applicabilityHash:sha(await readFile(resolve(root,'src/lib/mann-technical-applicability.ts'),'utf8')),profileHash:sha(await readFile(resolve(root,'src/lib/mann-unified-technical-profile.ts'),'utf8')),
 summary:{considered,revisions:revisions.length,review:review.length,checks},revisions,review,pending,productionApplyAllowed:false,
 limitation:'Individual bounded-month tests only; secondary source technical facts not OEM verified. Exact remaining source engine/month partition, joint profile and predecessor reconciliation required before merge.'};
await writeFile(resolve(dir,'mercedes-bulk-preview-supplement-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
