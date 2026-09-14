import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-corolla-cvt-preview-2026-09-14');
const [sql,mannRaw,planRaw,inventoryRaw]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(root,'outputs/mann-alphard-ru-preview-2026-09-14/cvt-capacity-parser-impact-v1.json'),'utf8')]);
const plan=JSON.parse(planRaw),inventory=JSON.parse(inventoryRaw);assert.equal(inventory.sourceHash,sha(sql));assert.equal(plan.inputHashes.source,sha(sql));assert.equal(inventory.parserHash,sha(await readFile(resolve(root,'src/lib/fluid-capacity-conditions.ts'),'utf8')));
const overlay=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json')),sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {splitMannEngineCodeList:split}=await jiti.import('../src/lib/mann-engine-code-list.ts');
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {parseConditionalFluidCapacities:parseBranches}=await jiti.import('../src/lib/fluid-capacity-conditions.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {extractFluidSourceSystemContext:label}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const catalog=parseCopy(mannRaw,'mann_filter_applications'),variants=Map.groupBy(catalog,r=>r.vehicleVariantKey),cache=new Map();
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const results=[];
for(const item of inventory.changes.filter(r=>r.sourceRequirementId!=='1a5f7cff1887b1199015eb2bcab5f0313288a2591e00c5f1fd4e3602880c2cd6')){
 const source=sources.get(item.sourceRequirementId),original=overlay.originalById.get(source.id);assert.equal(sha(original),item.sourceHash);
 if(!cache.has(source.make)){const forms=new Set(mannMakeFormsForTest(source.make));cache.set(source.make,catalog.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
 const rows=cache.get(source.make),parsed=parseBranches(source.fillVolumeText,source.systemCode,source.engineCodesJson);assert.equal(parsed.status,'structured');
 const metadata=label(source.systemNameRaw,source.componentModel),branches=[];
 for(const branch of parsed.branches){
  const initial=match({...source,fillVolumeText:branch.sourceSegment},rows),attempts=[];
  const keys=[...new Set(initial.topCandidates.slice(0,3).flatMap(c=>c.variantIds))];
  for(const key of keys){
   const target=variants.get(key);assert.ok(target?.length);const reasons=[];
   const windows=target.map(r=>applicabilityWindow(source,r)),window=windows[0];
   if(!window||windows.some(w=>!w)||new Set(windows.map(sha)).size!==1){attempts.push({vehicleVariantKey:key,reasons:['MISSING_OR_INCONSISTENT_MONTH_SCOPE'],publicationAllowed:false});continue;}
   const targetCodes=new Set(target.flatMap(r=>split(r.engineCode).map(norm))),engines=[...new Set([source.engineCodeNormalized,...source.engineCodesJson].filter(Boolean).filter(c=>targetCodes.has(norm(c))))];
   if(!engines.length)reasons.push('NO_EXACT_ENGINE_SCOPE');
   const decision=match({...source,...window.narrowedYears,fillVolumeText:branch.sourceSegment},rows),validation=decision.targets.find(t=>t.vehicleVariantKey===key&&t.independentlyValidated);
   if(!validation)reasons.push('TARGET_NOT_INDEPENDENTLY_VALIDATED');
   if(!Number.isFinite(source.powerHp)||target.some(r=>String(r.hp??'').trim()!==String(source.powerHp)))reasons.push('SOURCE_TARGET_POWER_REVIEW');
   if(metadata.issues.length||metadata.hasAdditionalLabelConditions)reasons.push('SOURCE_LABEL_REVIEW');
   if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_REVIEW');
   if(source.transmissionType&&source.transmissionType!==branch.condition.value)reasons.push('SOURCE_TRANSMISSION_CONFLICT');
   const fingerprint=originalAssociationFingerprint(key,original,parse(original.fillVolumeText,source.systemCode));if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
   attempts.push({vehicleVariantKey:key,window,matchedEngineScope:engines,reasons,validation,decision,originalAssociationFingerprint:fingerprint,existingRevisionIds:plan.newRevisions.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===key).map(r=>r.id),publicationAllowed:false});
  }
  branches.push({condition:branch.condition,sourceSegment:branch.sourceSegment,capacity:branch.capacity,initial,attempts});
 }
 results.push({sourceRequirementId:source.id,sourceHash:sha(original),make:source.make,model:source.model,systemCode:source.systemCode,metadata,branches,publicationAllowed:false});
}
assert.equal(results.length,8);
const accepted=results.flatMap(r=>r.branches.flatMap(b=>b.attempts.filter(a=>!a.reasons.length).map(a=>({sourceRequirementId:r.sourceRequirementId,systemCode:r.systemCode,condition:b.condition,...a}))));
const report={sourceHash:sha(sql),mannHash:sha(mannRaw),planHash:sha(planRaw),inventoryHash:sha(inventoryRaw),codeHashes:Object.fromEntries(await Promise.all(['mann-fluid-matcher-v2.ts','mann-vehicle-resolver.ts','mann-engine-code-list.ts','fluid-capacity-conditions.ts','fluid-capacity-parser.ts','fluid-source-system-context.ts'].map(async f=>[f,sha(await readFile(resolve(root,'src/lib',f),'utf8'))]))),summary:{sources:results.length,sourceBranches:results.reduce((n,r)=>n+r.branches.length,0),acceptedBranchTargets:accepted.length,newBranchTargets:accepted.filter(a=>!a.existingRevisionIds.length).length,acceptedSourceTargetPairs:new Set(accepted.map(a=>`${a.sourceRequirementId}:${a.vehicleVariantKey}`)).size},accepted,results,productionApplyAllowed:false,limitation:'Top-three retrieval targets rechecked against full make with month narrowing. Not exhaustive catalogue search; source raw engine-power alternatives, protected predecessors, runtime and source partition still require verification.'};
await writeFile(resolve(dir,'remaining-cvt-capacity-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
