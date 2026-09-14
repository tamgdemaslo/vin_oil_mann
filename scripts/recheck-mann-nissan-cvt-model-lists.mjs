import assert from 'node:assert/strict';
import {conditionalVehicleIdentityReasons} from './lib/mann-conditional-vehicle-identity.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {gearboxSourceQuality} from './lib/mann-gearbox-source-quality.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-nissan-xtrail-manual-preview-2026-09-14');
const [sql,mannRaw,planRaw,inventoryRaw,archive]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'cvt-model-list-impact-v1.json'),'utf8'),readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const plan=JSON.parse(planRaw),inventory=JSON.parse(inventoryRaw);assert.equal(inventory.sourceHash,sha(sql));assert.equal(inventory.planHash,sha(planRaw));
for(const [f,h] of Object.entries(inventory.codeHashes))assert.equal(h,sha(await readFile(resolve(root,f),'utf8')));
const overlay=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json')),sources=new Map(overlay.requirements.map(r=>[r.id,r])),rawRows=archive.trim().split('\n').map(JSON.parse);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts'),{splitMannEngineCodeList:split}=await jiti.import('../src/lib/mann-engine-code-list.ts'),{normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {explicitMannCvtModels:models}=await jiti.import('../src/lib/mann-transmission-model-list.ts'),{parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts'),{extractFluidSourceSystemContext:label}=await jiti.import('../src/lib/fluid-source-system-context.ts'),{mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts');
const forms=new Set(mannMakeFormsForTest('NISSAN')),rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))),variants=Map.groupBy(rows,r=>r.vehicleVariantKey),quality=gearboxSourceQuality([...overlay.originalById.values()],component,label);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints),results=[];
for(const item of inventory.parsed){
 const source=sources.get(item.sourceRequirementId),original=overlay.originalById.get(source.id);assert.equal(sha(original),item.sourceHash);assert.equal(source.make,'nissan');assert.deepEqual(models(original.componentModel),item.models);
 const raw=rawRows.find(r=>r.row_id===original.sourceRowId);assert.ok(raw);const anchors=rawRows.filter(r=>r.source_url===raw.source_url&&r.table_index===raw.table_index&&/МАСЛО\s+в\s+ДВИГАТЕЛЬ/iu.test(r.application));
 const metadata=label(source.systemNameRaw,source.componentModel),capacity=parse(original.fillVolumeText,original.systemCode),initial=match(source,rows),attempts=[];
 for(const key of [...new Set(initial.topCandidates.slice(0,3).flatMap(c=>c.variantIds))]){
  const target=variants.get(key);assert.ok(target?.length);const reasons=[];
  const windows=target.map(r=>applicabilityWindow(source,r)),window=windows[0];
  if(!window||windows.some(w=>!w)||new Set(windows.map(sha)).size!==1){attempts.push({vehicleVariantKey:key,reasons:['MISSING_OR_INCONSISTENT_MONTH_SCOPE']});continue;}
  const decision=match({...source,...window.narrowedYears},rows),candidate=decision.topCandidates[0];
  if(!candidate||candidate.variantIds.length!==1||candidate.variantIds[0]!==key||candidate.score<80||!candidate.matchedFields.includes('точный код двигателя'))reasons.push('NO_UNIQUE_EXACT_IDENTITY');
  if(candidate){reasons.push(...conditionalVehicleIdentityReasons(source,candidate));reasons.push(...candidate.hardConflicts,...candidate.reviewBlockers.filter(b=>b!=='MANN variant не подтверждает тип или модель коробки'));if(candidate.reviewBlockers.length!==1||candidate.reviewBlockers[0]!=='MANN variant не подтверждает тип или модель коробки')reasons.push('NOT_SOLE_MISSING_GEARBOX_BLOCKER');if(decision.topCandidates.slice(1).some(c=>!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=candidate.score-10))reasons.push('NEARBY_EXACT_ENGINE_ALTERNATIVE');}
  const codes=new Set(target.flatMap(r=>split(r.engineCode).map(norm))),engines=[...new Set(source.engineCodesJson.filter(c=>codes.has(norm(c))))];if(!engines.length)reasons.push('NO_EXACT_ENGINE_SCOPE');
  if(!Number.isFinite(source.powerHp)||target.some(r=>String(r.hp??'').trim()!==String(source.powerHp)))reasons.push('SOURCE_TARGET_POWER_REVIEW');
  if(source.systemCode!=='CVT_TRANSMISSION'||source.transmissionType!=='cvt'||metadata.transmissionType!=='cvt'||metadata.transmissionGearCount!==null)reasons.push('SOURCE_TRANSMISSION_REVIEW');
  if(metadata.issues.length||metadata.hasAdditionalLabelConditions)reasons.push('SOURCE_LABEL_REVIEW');if(source.driveType)reasons.push('SOURCE_DRIVE_REVIEW');if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_REVIEW');
  if(capacity.needsReview||!capacity.capacities.length)reasons.push('CAPACITY_REVIEW');if(quality.heldBySource.has(source.id))reasons.push('GEARBOX_SOURCE_QUALITY_REVIEW');if(anchors.length!==1)reasons.push('RAW_ENGINE_ANCHOR_REVIEW');
  const fingerprint=originalAssociationFingerprint(key,original,capacity);if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
  attempts.push({vehicleVariantKey:key,window,matchedEngineScope:engines,reasons:[...new Set(reasons)],candidate,decision,originalAssociationFingerprint:fingerprint,existingRevisionIds:plan.newRevisions.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===key).map(r=>r.id),publicationAllowed:false});
 }
 results.push({sourceRequirementId:source.id,sourceHash:sha(original),originalSource:original,models:item.models,metadata,capacity,rawEngineAnchors:anchors,initial,attempts,publicationAllowed:false});
}
assert.equal(results.length,13);
const candidates=results.flatMap(r=>r.attempts.filter(a=>!a.reasons.length).map(a=>({sourceRequirementId:r.sourceRequirementId,models:r.models,...a})));
const files=['scripts/recheck-mann-nissan-cvt-model-lists.mjs','scripts/lib/mann-conditional-vehicle-identity.mjs','scripts/lib/mann-gearbox-source-quality.mjs','src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-engine-code-list.ts','src/lib/vehicle-normalization.ts','src/lib/fluid-capacity-parser.ts','src/lib/fluid-source-system-context.ts','src/lib/mann-transmission-component.ts','src/lib/mann-transmission-model-list.ts','src/lib/mann-unified-technical-profile.ts','src/lib/mann-technical-applicability.ts'];
const report={sourceHash:sha(sql),mannHash:sha(mannRaw),planHash:sha(planRaw),inventoryHash:sha(inventoryRaw),rawHash:sha(archive),codeHashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary:{sources:results.length,attempts:results.reduce((n,r)=>n+r.attempts.length,0),candidatePairs:candidates.length,candidateSources:new Set(candidates.map(c=>c.sourceRequirementId)).size},candidates,results,productionApplyAllowed:false,limitation:'Conditional candidates only. Source engine/power/year branches must be independently recovered from raw anchors; top-three retrieval, not exhaustive matching or confirmed installed gearboxes.'};
await writeFile(resolve(dir,'nissan-cvt-model-list-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
