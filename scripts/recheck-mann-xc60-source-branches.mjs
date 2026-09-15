import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {volvoEngineYearBranches} from './lib/mann-volvo-engine-year-branches.mjs';
import {splitSpecificationSections,specificationCautionSignals} from './lib/mann-specification-sections-v2.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {volvoComponentEngineList} from './lib/mann-volvo-component-engine-list.mjs';
const version=process.argv[2]??'v1';assert.ok(['v1','v2','v3'].includes(version));
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw),sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(planRaw),{v1:'3a3a0c2a6877dc4917c510713ff23ef7ab9a8d8ddd12abe4838622229b712e42',v2:'be393d53760bedb9f5165721e5948ee69e43b5e39249c10b5c4fbd656d1079fb',v3:'0f09e72ca05abe50f929a58c8fbcc0c127c3d9561ad8fbfc3933ceb701879234'}[version]);assert.equal(sha(sourceRaw),plan.inputHashes.source);assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const rawText=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(rawText),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const raw=rawText.trim().split('\n').map(JSON.parse).filter(r=>r.source_url==='https://podbormasla.ru/volvo/xc60/1gen/'),byRaw=new Map(raw.map(r=>[r.row_id,r]));
const anchors=raw.filter(r=>r.system_name?.startsWith('МАСЛО в ДВИГАТЕЛЬ')).map(r=>({row:r,hash:sha(r),branches:volvoEngineYearBranches(r.model)}));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const powerOverlay=version!=='v1'?await applyAuditedTablePower(root,overlay.requirements,rawText):null;
const sources=(powerOverlay?.requirements??overlay.requirements).filter(s=>byRaw.has(s.sourceRowId));assert.equal(sources.length,71);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await j.import('../src/lib/mann-catalog.ts'),{normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts'),{parseFluidCapacities:capacity}=await j.import('../src/lib/fluid-capacity-parser.ts'),{extractFluidSourceSystemContext:label}=await j.import('../src/lib/fluid-source-system-context.ts'),{mannRowGenerationEvidence:identity}=await j.import('../src/lib/mann-row-generation-evidence.ts');
const forms=new Set(mannMakeFormsForTest('volvo')),catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))),variants=Map.groupBy(catalog,r=>r.vehicleVariantKey);
const denyRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8'),denied=new Set(JSON.parse(denyRaw).rejectedAssociationFingerprints);
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),plan.inputHashes.live);const live=JSON.parse(liveRaw);
const findings=[];
for(const source of sources){
 const original=overlay.originalById.get(source.id),row=byRaw.get(source.sourceRowId),sourceEngines=[...new Set([source.engineCodeNormalized,...source.engineCodesJson??[]].filter(Boolean).map(norm))];
 const componentEngineList=version==='v3'?volvoComponentEngineList(row.application):null;
 const applicableAnchors=anchors.filter(a=>source.systemCode==='ENGINE_OIL'?a.row.row_id===row.row_id:a.row.table_index===row.table_index);
 const branches=applicableAnchors.flatMap(a=>(a.branches??[]).filter(b=>sourceEngines.includes(norm(b.engineCode))).map(b=>({...b,anchorHash:a.hash,anchorRowId:a.row.row_id})));
 const parsedCapacity=capacity(original.fillVolumeText,original.systemCode),system=label(source.systemNameRaw,source.componentModel),sections=splitSpecificationSections(original.specificationText,original.analogText),cautions=specificationCautionSignals(original.specificationText),pairs=[];
 for(const branch of branches){
  const effective={...source,engineCodesJson:[branch.engineCode],engineCodeNormalized:branch.engineCode,powerHp:branch.powerHp,yearFrom:Math.max(source.yearFrom??branch.yearFrom,branch.yearFrom),yearTo:Math.min(source.yearTo??branch.yearTo,branch.yearTo)};
  if(effective.yearFrom>effective.yearTo)continue;
  const targets=[...variants].filter(([,rows])=>rows.some(r=>identity(r)==='I'&&norm(r.engineCode)===norm(branch.engineCode)));
  for(const [targetId,rows] of targets){
   const reasons=[],windows=rows.map(r=>applicabilityWindow(effective,r)),window=windows[0];
   if(componentEngineList?.status==='REVIEW')reasons.push('COMPONENT_ENGINE_LIST_UNPARSED');
   if(componentEngineList?.status==='EXPLICIT'){
    const member=componentEngineList.branches.find(b=>b.engineCode===branch.engineCode);
    if(!member)reasons.push('ENGINE_EXCLUDED_BY_COMPONENT_SOURCE_LIST');
    else if(member.powerHp!==branch.powerHp)reasons.push('COMPONENT_ENGINE_POWER_CONFLICT');
   }
   if(branches.filter(b=>b.engineCode===branch.engineCode).length!==1)reasons.push('NONUNIQUE_SOURCE_ENGINE_BRANCH');
   if(!rows.every(r=>identity(r)==='I'&&norm(r.engineCode)===norm(branch.engineCode)))reasons.push('TARGET_IDENTITY_NOT_CONFIRMED_FOR_ALL_ROWS');
   if(!rows.every(r=>Number(r.hp)===branch.powerHp))reasons.push('SOURCE_TARGET_POWER_CONFLICT');
   if(source.powerHp!=null&&source.powerHp!==branch.powerHp)reasons.push('SOURCE_ANCHOR_POWER_CONFLICT');
   if(!window?.intersection.from||!window?.intersection.to||windows.some(w=>sha(w)!==sha(window)))reasons.push('TARGET_WINDOWS_MISSING_OR_DIFFERENT');
   const decision=window?match({...effective,...window.narrowedYears},catalog):null;
   if(!decision?.targets.some(t=>t.vehicleVariantKey===targetId&&t.independentlyValidated))reasons.push('CLIPPED_MATCH_NOT_INDEPENDENTLY_VALIDATED');
   if(!['ENGINE_OIL','ENGINE_COOLANT','BRAKE_FLUID','ADBLUE'].includes(source.systemCode))reasons.push('COMPONENT_SCOPE_REVIEW_REQUIRED');
   if(source.driveType||source.transmissionType||source.componentModel)reasons.push('SOURCE_ADDITIONAL_VEHICLE_CONDITION');
   if(system.issues.length||system.hasAdditionalLabelConditions)reasons.push('SOURCE_LABEL_CONDITIONS');
   if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_CONFLICT');
   if(parsedCapacity.needsReview||!parsedCapacity.capacities.length)reasons.push('SOURCE_CAPACITY_REVIEW');
   if(!String(original.specificationText??'').trim())reasons.push('MISSING_SPECIFICATION');
   if(!['NO_EXPLICIT_MARKER','EXPLICIT_ANALOG_SEPARATED'].includes(sections.status)||cautions.length)reasons.push('SPECIFICATION_REVIEW');
   const fingerprint=originalAssociationFingerprint(targetId,original,parsedCapacity);if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
   if(live.some(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===targetId&&(r.reviewConfirmed||r.applyEligible||r.state==='ACTIVE'||r.verificationStatus!=='UNVERIFIED')))reasons.push('PROTECTED_PREDECESSOR');
   pairs.push({targetId,targetRowIds:rows.map(r=>r.id),branch,window,decision,originalAssociationFingerprint:fingerprint,reasons:[...new Set(reasons)],publicationAllowed:false});
  }
 }
 findings.push({sourceRequirementId:source.id,systemCode:source.systemCode,originalSourceHash:sha(original),powerCorrection:powerOverlay?.changes.get(source.id)??null,...(componentEngineList?{componentEngineList}:{}),sourceEngines,unparsedAnchorIds:applicableAnchors.filter(a=>!a.branches).map(a=>a.row.row_id),enginesWithoutParsedBranch:sourceEngines.filter(e=>!branches.some(b=>norm(b.engineCode)===e)),branches,pairs,parsedCapacity,system,sections,cautions,publicationAllowed:false});
}
const pairs=findings.flatMap(f=>f.pairs),summary={sources:findings.length,anchors:anchors.length,parsedAnchors:anchors.filter(a=>a.branches).length,sourceBranches:findings.reduce((n,f)=>n+f.branches.length,0),pairs:pairs.length,preflightClearPairs:pairs.filter(p=>!p.reasons.length).length,sourcesWithClearPairs:findings.filter(f=>f.pairs.some(p=>!p.reasons.length)).length,sourcesWithoutEvidenceBackedTarget:findings.filter(f=>!f.pairs.length).length,reasonCounts:Object.fromEntries([...Map.groupBy(pairs.flatMap(p=>p.reasons),r=>r)].map(([k,v])=>[k,v.length]))};
const codeHashes=Object.fromEntries(await Promise.all(['scripts/lib/mann-volvo-engine-year-branches.mjs','src/lib/mann-row-generation-evidence.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-fluid-matcher-v2.ts','scripts/recheck-mann-xc60-source-branches.mjs'].map(async p=>[p,sha(await readFile(resolve(root,p),'utf8'))])));
assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),sha(planRaw));
if(powerOverlay){codeHashes['scripts/lib/mann-table-power-overlay.mjs']=sha(await readFile(resolve(root,'scripts/lib/mann-table-power-overlay.mjs'),'utf8'));summary.correctedPowerSources=findings.filter(f=>f.powerCorrection).length;summary.allSourcePowerCorrectionsVerified=powerOverlay.changes.size;}
if(version==='v3')codeHashes['scripts/lib/mann-volvo-component-engine-list.mjs']=sha(await readFile(resolve(root,'scripts/lib/mann-volvo-component-engine-list.mjs'),'utf8'));
await writeFile(resolve(dir,`xc60-source-branch-preflight-${version}.json`),JSON.stringify({kind:'XC60_SOURCE_BRANCH_PREFLIGHT',planHash:sha(planRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),rawHash:sha(rawText),denylistHash:sha(denyRaw),liveHash:sha(liveRaw),powerOverlayProofHash:powerOverlay?.proofHash,parserHash:powerOverlay?.parserHash,codeHashes,summary,anchors,findings,productionApplyAllowed:false,limitations:['No draft insertion, OEM fluid approval, full source completion or runtime profile proof.','Engine anchors require same table and pre-existing source engine membership; no engine/power cross product.','Unparsed equipment clauses, absent catalogue generation evidence and excluded source month/engine branches remain unresolved.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
