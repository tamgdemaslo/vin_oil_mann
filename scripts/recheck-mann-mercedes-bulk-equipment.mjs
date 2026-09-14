import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-bulk-preview-2026-09-14');
const [auditRaw,sourceRaw,mannRaw,planRaw]=await Promise.all([
 readFile(resolve(root,'outputs/mann-mercedes-compressed-preview-2026-09-14/mercedes-bulk-source-engine-recheck-v1.json'),'utf8'),
 readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8')]);
const audit=JSON.parse(auditRaw),plan=JSON.parse(planRaw);assert.equal(audit.sourceHash,sha(sourceRaw));assert.equal(audit.mannHash,sha(mannRaw));
for(const [field,file] of [['matcherHash','mann-fluid-matcher-v2.ts'],['resolverHash','mann-vehicle-resolver.ts'],['targetParserHash','mann-engine-code-list.ts']])assert.equal(audit[field],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {extractFluidAggregateSourceContext:extract}=await jiti.import('../src/lib/fluid-aggregate-source-context.ts');
const {readMannEquipmentScope:readEquipment}=await jiti.import('../src/lib/mann-equipment-scope.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {splitMannEngineCodeList:split}=await jiti.import('../src/lib/mann-engine-code-list.ts');
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const forms=new Set(mannMakeFormsForTest('MERCEDES'));
const rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const results=[];
for(const entry of audit.results)for(const branch of entry.branches.filter(b=>b.status==='REVIEW_REQUIRED')){
 const source=sources.get(entry.sourceRequirementId),original=overlay.originalById.get(source.id);assert.equal(sha(original),entry.sourceHash);
 const metadata=extract(source.systemNameRaw,source.componentModel);
 const condition=readEquipment({systemCode:metadata.systemCode,circuit:metadata.circuit,...(metadata.requiredDrive?{drive:metadata.requiredDrive}:{}),...(metadata.attachedTransmissionType?{attachedTransmissionType:metadata.attachedTransmissionType}:{})});
 const reasons=[...branch.reasons];let candidate=null,window=null,engines=[],fingerprint=null;
 if(!condition||metadata.issues.length||metadata.systemCode!==source.systemCode||metadata.fluidRequired!==true)reasons.push('UNSUPPORTED_OR_CONDITIONAL_SOURCE_EQUIPMENT');
 const top=branch.topCandidates[0],key=top?.variantIds.length===1?top.variantIds[0]:null;
 if(!key)reasons.push('NO_UNIQUE_INITIAL_VARIANT');
 if(condition&&!metadata.issues.length&&key){
   const recovered={...source,...branch.recoveredEngineContext},targetRows=variants.get(key);assert.ok(targetRows?.length);
   const windows=targetRows.map(row=>applicabilityWindow(recovered,row));window=windows[0];
   if(!window||windows.some(w=>!w)||new Set(windows.map(sha)).size!==1)reasons.push('INCONSISTENT_MONTH_SCOPE');
   if(window){
     const decision=match({...recovered,...window.narrowedYears},rows);candidate=decision.topCandidates[0];
     if(!candidate||candidate.variantIds.length!==1||candidate.variantIds[0]!==key||candidate.score<80||!candidate.matchedFields.includes('точный код двигателя'))reasons.push('NO_UNIQUE_EXACT_IDENTITY');
     if(candidate){
       reasons.push(...candidate.hardConflicts);
       const allowed=source.systemCode==='POWER_STEERING'?'MANN variant не подтверждает наличие этой гидравлической системы':'MANN variant не подтверждает привод или модель агрегата';
       reasons.push(...candidate.reviewBlockers.filter(b=>b!==allowed));
       if(decision.topCandidates.slice(1).some(c=>!c.hardConflicts.length&&c.matchedFields.includes('точный код двигателя')&&c.score>=candidate.score-10))reasons.push('NEARBY_EXACT_ENGINE_ALTERNATIVE');
     }
     const targetCodes=new Set(targetRows.flatMap(r=>split(r.engineCode).map(s=>norm(s.trim()))));engines=recovered.engineCodesJson.filter(c=>targetCodes.has(norm(c)));
     if(!engines.length)reasons.push('NO_EXACT_ENGINE_SCOPE');
   }
   const capacity=parse(original.fillVolumeText,original.systemCode);if(capacity.needsReview||!capacity.capacities.length)reasons.push('CAPACITY_REVIEW');
   fingerprint=originalAssociationFingerprint(key,original,capacity);if(denied.has(fingerprint))reasons.push('PREVIOUSLY_REJECTED_ASSOCIATION');
 }
 if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_REVIEW');
 const existing=key?plan.newRevisions.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===key).map(r=>r.id):[];
 results.push({sourceRequirementId:source.id,sourceHash:sha(original),systemCode:source.systemCode,vehicleVariantKey:key,
   status:reasons.length?'REVIEW':'EQUIPMENT_SCOPED_CANDIDATE',reasons:[...new Set(reasons)],metadata,requiredEquipment:condition,
   originalAssociationFingerprint:fingerprint,window,matchedEngineScope:engines,sourceEngineContext:branch.recoveredEngineContext,sourceEvidence:branch.evidence,candidate,existingRevisionIds:existing,publicationAllowed:false});
}
assert.equal(results.length,200);
const approved=results.filter(r=>r.status==='EQUIPMENT_SCOPED_CANDIDATE');
const report={planHash:sha(planRaw),auditHash:sha(auditRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),matcherHash:audit.matcherHash,resolverHash:audit.resolverHash,targetParserHash:audit.targetParserHash,
 aggregateParserHash:sha(await readFile(resolve(root,'src/lib/fluid-aggregate-source-context.ts'),'utf8')),equipmentScopeHash:sha(await readFile(resolve(root,'src/lib/mann-equipment-scope.ts'),'utf8')),
 summary:{reviewed:200,candidates:approved.length,newPairs:approved.filter(r=>!r.existingRevisionIds.length).length,existingPairs:approved.filter(r=>r.existingRevisionIds.length).length,
 bySystem:Object.fromEntries([...Map.groupBy(approved,r=>r.systemCode)].map(([k,v])=>[k,v.length]))},results,productionApplyAllowed:false,
 limitation:'Conditional equipment identity candidates only. VIN equipment is NOT confirmed. Source conditional capacities, exact source partitions, runtime and predecessor gates still required; suspension circuit unsupported.'};
await writeFile(resolve(dir,'mercedes-bulk-equipment-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
