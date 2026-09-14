import assert from 'node:assert/strict';
import {conditionalVehicleIdentityReasons} from './lib/mann-conditional-vehicle-identity.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {gearboxSourceQuality} from './lib/mann-gearbox-source-quality.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--lists'));
const lists=process.argv[2]==='--lists';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,lists?'outputs/mann-mercedes-transmission-preview-2026-09-14':'outputs/mann-mercedes-equipment-preview-2026-09-14');
const [auditRaw,sourceRaw,mannRaw,planRaw]=await Promise.all([
 readFile(resolve(root,'outputs/mann-mercedes-compressed-preview-2026-09-14/mercedes-bulk-source-engine-recheck-v1.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),
 readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const audit=JSON.parse(auditRaw),plan=JSON.parse(planRaw);assert.equal(audit.sourceHash,sha(sourceRaw));assert.equal(audit.mannHash,sha(mannRaw));
for(const [field,file] of [['matcherHash','mann-fluid-matcher-v2.ts'],['resolverHash','mann-vehicle-resolver.ts'],['targetParserHash','mann-engine-code-list.ts']])assert.equal(audit[field],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {extractFluidSourceSystemContext:extract}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const {mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts');
const {explicitMannTransmissionModels:parseList}=await jiti.import('../src/lib/mann-transmission-model-list.ts');
const quality=gearboxSourceQuality([...overlay.originalById.values()],component,extract);
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {splitMannEngineCodeList:split}=await jiti.import('../src/lib/mann-engine-code-list.ts');
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const forms=new Set(mannMakeFormsForTest('MERCEDES'));
const rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const results=[];
for(const entry of audit.results.filter(r=>['AUTOMATIC_TRANSMISSION','MANUAL_TRANSMISSION'].includes(r.systemCode)))for(const branch of entry.branches){
 const source=sources.get(entry.sourceRequirementId),original=overlay.originalById.get(source.id);assert.equal(sha(original),entry.sourceHash);
 const explicitModels=parseList(source.componentModel);if(lists&&!explicitModels)continue;
 const metadata=extract(source.systemNameRaw,source.componentModel),model=component(source.componentModel),reasons=[...branch.reasons];
 if(metadata.issues.length||metadata.hasAdditionalLabelConditions)reasons.push('SOURCE_LABEL_CONDITIONS');
 if(metadata.destinationSystemCode!==source.systemCode||metadata.transmissionType!==source.transmissionType)reasons.push('SOURCE_TRANSMISSION_TYPE_CONFLICT');
 if(model.kind==='conditions'&&!(lists&&explicitModels))reasons.push('GEARBOX_FAMILY_LIST_OR_SERIAL_CONDITION');
 if(quality.heldBySource.has(source.id))reasons.push('SOURCE_MODEL_GEAR_COUNT_CONFLICT');
 const top=branch.topCandidates[0],key=top?.variantIds.length===1?top.variantIds[0]:null;
 let candidate=null,window=null,engines=[],fingerprint=null;
 if(!key)reasons.push('NO_UNIQUE_INITIAL_VARIANT');
 if(key&&branch.status!=='ANCHOR_REVIEW'){
   const recovered={...source,...branch.recoveredEngineContext},targetRows=variants.get(key);assert.ok(targetRows?.length);
   const windows=targetRows.map(row=>applicabilityWindow(recovered,row));window=windows[0];
   if(!window||windows.some(w=>!w)||new Set(windows.map(sha)).size!==1)reasons.push('INCONSISTENT_MONTH_SCOPE');
   if(window){
     const decision=match({...recovered,...window.narrowedYears},rows);candidate=decision.topCandidates[0];
     if(!candidate||candidate.variantIds.length!==1||candidate.variantIds[0]!==key||candidate.score<80||!candidate.matchedFields.includes('точный код двигателя'))reasons.push('NO_UNIQUE_EXACT_IDENTITY');
     if(candidate){reasons.push(...conditionalVehicleIdentityReasons(source,candidate));
       reasons.push(...candidate.hardConflicts,...candidate.reviewBlockers.filter(b=>b!=='MANN variant не подтверждает тип или модель коробки'));
       if(!candidate.reviewBlockers.includes('MANN variant не подтверждает тип или модель коробки'))reasons.push('RECLASSIFY_UNCONDITIONAL_TARGET');
       if(decision.topCandidates.slice(1).some(c=>!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=candidate.score-10))reasons.push('NEARBY_EXACT_ENGINE_ALTERNATIVE');
     }
     const targetCodes=new Set(targetRows.flatMap(r=>split(r.engineCode).map(s=>norm(s.trim()))));engines=recovered.engineCodesJson.filter(c=>targetCodes.has(norm(c)));
     if(!engines.length)reasons.push('NO_EXACT_ENGINE_SCOPE');
   }
   const capacity=parse(original.fillVolumeText,original.systemCode);if(capacity.needsReview||!capacity.capacities.length)reasons.push('CAPACITY_REVIEW');
   fingerprint=originalAssociationFingerprint(key,original,capacity);if(denied.has(fingerprint))reasons.push('PREVIOUSLY_REJECTED_ASSOCIATION');
 }
 if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_REVIEW');
 results.push({sourceRequirementId:source.id,sourceHash:sha(original),systemCode:source.systemCode,vehicleVariantKey:key,
   status:reasons.length?'REVIEW':'TRANSMISSION_SCOPED_CANDIDATE',reasons:[...new Set(reasons)],metadata,component:model,...(lists?{explicitModels}:{}),
   originalAssociationFingerprint:fingerprint,window,matchedEngineScope:engines,sourceEngineContext:branch.recoveredEngineContext,sourceEvidence:branch.evidence,candidate,
   existingRevisionIds:plan.newRevisions.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===key).map(r=>r.id),publicationAllowed:false});
}
assert.equal(results.length,lists?8:57);
const candidates=results.filter(r=>r.status==='TRANSMISSION_SCOPED_CANDIDATE');
const report={planHash:sha(planRaw),auditHash:sha(auditRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),matcherHash:audit.matcherHash,resolverHash:audit.resolverHash,targetParserHash:audit.targetParserHash,
 supportingCodeHashes:Object.fromEntries(await Promise.all(['src/lib/mann-transmission-model-list.ts','scripts/lib/mann-conditional-vehicle-identity.mjs','scripts/lib/mann-gearbox-source-quality.mjs','scripts/lib/mann-explicit-gearbox-list.mjs'].map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),
 componentParserHash:sha(await readFile(resolve(root,'src/lib/mann-transmission-component.ts'),'utf8')),labelParserHash:sha(await readFile(resolve(root,'src/lib/fluid-source-system-context.ts'),'utf8')),
 summary:{reviewed:results.length,candidates:candidates.length,newPairs:candidates.filter(r=>!r.existingRevisionIds.length).length,existingPairs:candidates.filter(r=>r.existingRevisionIds.length).length,
 bySystem:Object.fromEntries([...Map.groupBy(candidates,r=>r.systemCode)].map(([k,v])=>[k,v.length]))},results,productionApplyAllowed:false,
 limitation:'Conditional gearbox identity candidates, not confirmed VIN gearboxes or fluid technical facts. Exact model and count runtime tests, source partition, predecessor and publication gates still required.'};
await writeFile(resolve(dir,lists?'mercedes-transmission-list-recheck-v1.json':'mercedes-bulk-transmission-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
