import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {subtractMonths} from './lib/mann-month-intervals.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14');
const read=async name=>readFile(resolve(dir,name),'utf8');
const preRaw=await read('source-type-count-preflight-v1.json'),pre=JSON.parse(preRaw),proof=JSON.parse(await read('source-type-count-preflight-verification-v1.json'));
assert.equal(proof.reportHash,sha(preRaw));assert.equal(proof.checked,22);assert.equal(proof.nextDraftReviewSources,2);
for(const hashes of [pre.codeHashes,proof.codeHashes])for(const [file,hash]of Object.entries(hashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const parentRaw=await readFile(pre.planPath,'utf8'),parent=JSON.parse(parentRaw);assert.equal(sha(parentRaw),pre.planHash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mann=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sql),pre.sourceHash);assert.equal(sha(mann),pre.mannHash);
const summary=JSON.parse(await read('summary.json')),overlay=await loadIdentityOverlay(root,sql,summary.identityOverlay.path,summary.identityOverlay.sha256),sources=new Map(overlay.requirements.map(s=>[s.id,s]));
const targets=Map.groupBy(parseCopy(mann,'mann_filter_applications'),r=>r.vehicleVariantKey),liveRaw=await readFile(resolve(root,parent.inputFiles.live),'utf8'),live=JSON.parse(liveRaw);assert.equal(sha(liveRaw),pre.liveHash);
const denyRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8');assert.equal(sha(denyRaw),pre.denylistHash);const denied=new Set(JSON.parse(denyRaw).rejectedAssociationFingerprints);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{mannExplicitTransmissionTypeCount:parse}=await j.import('../src/lib/mann-transmission-component.ts'),{extractFluidSourceSystemContext:contextOf}=await j.import('../src/lib/fluid-source-system-context.ts'),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts'),{parseFluidCapacities:capacity}=await j.import('../src/lib/fluid-capacity-parser.ts'),{splitMannEngineCodeList:engines}=await j.import('../src/lib/mann-engine-code-list.ts'),{normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts');
const policy='USER_CONFIRMED_TRANSMISSION_V1',countPolicy='EXPLICIT_SOURCE_TYPE_COUNT_V1',drafts=[];
const {parseSpecifications}=await j.import('../src/lib/fluid-catalog.ts');
let cases=0,positive=0,partitionChecks=0;
const idx=m=>Number(m.slice(0,4))*12+Number(m.slice(5))-1,month=i=>`${Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`;
for(const f of pre.findings.filter(f=>!f.reasons.length)){
 const s=sources.get(f.sourceRequirementId),original=overlay.originalById.get(s.id),typeCount=parse(s.componentModel),source=contextOf(s.systemNameRaw,s.componentModel);assert.ok(typeCount);assert.deepEqual(original,f.originalSource);assert.equal(sha(original),f.sourceHash);
 assert.equal(s.driveType,null);assert.equal(s.transmissionType,typeCount.type);assert.deepEqual(source,f.sourceSystemContext);assert.equal(source.transmissionGearCount,typeCount.gearCount);assert.equal(source.transmissionType,typeCount.type);assert.equal(source.destinationSystemCode,s.systemCode);assert.deepEqual(source.issues,[]);assert.equal(source.hasAdditionalLabelConditions,false);
 const target=targets.get(f.targetId);assert.ok(target?.length);for(const t of target){assert.equal(Number(t.hp),s.powerHp);assert.ok(f.engineCodes.every(c=>engines(t.engineCode).map(norm).includes(c)));assert.deepEqual(applicabilityWindow(s,t),f.window);}
 const parsed=capacity(s.fillVolumeText,s.systemCode);assert.deepEqual(parsed,f.parsedCapacity);assert.equal(parsed.needsReview,false);assert.ok(['NO_EXPLICIT_MARKER','EXPLICIT_ANALOG_SEPARATED'].includes(f.specificationSections.status));assert.deepEqual(f.cautions,[]);
 const fingerprint=originalAssociationFingerprint(f.targetId,original,capacity(original.fillVolumeText,original.systemCode));assert.equal(fingerprint,f.originalAssociationFingerprint);assert.ok(!denied.has(fingerprint));
 const prior=live.filter(r=>r.sourceRequirementId===s.id&&r.vehicleVariantKey===f.targetId);assert.ok(prior.every(r=>!r.reviewConfirmed&&r.verificationStatus!=='PRIMARY_SOURCE_VERIFIED_FIELDS'));assert.ok(!parent.newRevisions.some(r=>r.sourceRequirementId===s.id));
 const applicabilityJson={sourceVehicleScope:{make:s.make,model:s.model,...(s.generation?{generation:s.generation}:{})},matchedEngineScope:f.engineCodes,window:f.window,componentModel:s.componentModel,transmissionType:typeCount.type,transmissionGearCount:typeCount.gearCount};
 const technicalDataJson={fillVolumeText:s.fillVolumeText,capacities:parsed.capacities,specificationText:s.specificationText,specifications:s.specificationsJson,viscosityGrades:s.viscosityGradesJson,...Object.fromEntries(['recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'].map(k=>[k,s[k]]))};
 if(f.specificationSections.status==='EXPLICIT_ANALOG_SEPARATED'){
  const sections=f.specificationSections,main=sections.main.text.trim();assert.ok(main);const grades=[...new Set([...main.matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map(m=>m[0].toUpperCase()))];
  technicalDataJson.specificationText=main;technicalDataJson.specifications=[{type:'SOURCE_REQUIREMENT_TEXT',value:main},...parseSpecifications(main,grades).filter(s=>s.type!=='RAW')];technicalDataJson.viscosityGrades=grades;
  technicalDataJson.sourceSpecificationAttribution={policy:'EXPLICIT_SOURCE_ROLES_V1',originalSpecificationText:s.specificationText,mainSourceText:main,unverifiedAnalogText:sections.analog.text.trim(),metadataAndCautionText:sections.suffix.text.trim(),originalSourceHash:f.sourceHash,sourceRequirementId:s.id,oemVerified:false,automaticAnalogSelectionAllowed:false};
 }
 const top=f.clippedDecision.topCandidates[0];assert.deepEqual(top.variantIds,[f.targetId]);assert.ok(top.score>=80);assert.deepEqual(top.hardConflicts,[]);
 const fp=sha({policy,sourceRequirementId:s.id,vehicleVariantKey:f.targetId,applicabilityJson,technicalDataJson});
 const revision={id:`mtar_${fp.slice(0,24)}`,semanticFingerprint:fp,sourceRequirementId:s.id,vehicleVariantKey:f.targetId,systemCode:s.systemCode,componentModel:s.componentModel,applicabilityJson,technicalDataJson,state:'REVIEW',verificationStatus:'UNVERIFIED',matchClass:'CONDITIONAL_TRANSMISSION',matchScore:top.score,applyEligible:false,verifiedFieldsJson:[],replacesRevisionIds:prior.map(r=>r.id),fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:s.sourceUrl}],provenanceJson:{conditionalTransmissionPolicy:policy,conditionalTransmissionEligible:true,sourceTechnicalReviewRequired:true,sourceTransmissionContext:source,sourceAssociationFingerprint:fingerprint,sourceRecheckHash:sha(preRaw),identityCorrectionHash:overlay.metadata.sha256,explicitTransmissionTypeCount:{policy:countPolicy,sourceComponentModel:s.componentModel,typeCount},independentValidation:{vehicleIdentityIndependentlyValidated:true,hardConflicts:[],reviewBlockers:top.reviewBlockers,score:top.score,matchedFields:top.matchedFields}}};
 const row={...revision,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{conditionalTransmissionPolicy:policy,transmissionTypeCountPolicy:countPolicy,automaticProductSelection:false}}};
 const pendingWindows=subtractMonths(f.window.source,[f.window.intersection]);assert.ok(f.window.source.from&&f.window.source.to);
 for(let i=idx(f.window.source.from)-1;i<=idx(f.window.source.to)+1;i++){
  const m=month(i),inside=m>=f.window.intersection.from&&m<=f.window.intersection.to;assert.equal(Number(inside)+pendingWindows.filter(w=>m>=w.from&&m<=w.to).length,Number(m>=f.window.source.from&&m<=f.window.source.to));partitionChecks++;
  for(const type of [undefined,'automatic','manual','cvt','robot'])for(const count of [undefined,typeCount.gearCount,99])for(const engineCode of [...f.engineCodes,undefined,'WRONG']){
   const expected=inside&&type===typeCount.type&&count===typeCount.gearCount&&f.engineCodes.includes(engineCode),items=profile([row],type,{...applicabilityJson.sourceVehicleScope,productionMonth:m,engineCode,transmissionGearCount:count}).items;cases++;assert.equal(items.length,expected?1:0);
   if(expected){positive++;assert.equal(items[0].componentModel,s.componentModel);assert.ok(!items[0].userConfirmedTransmissionModel);assert.equal(items[0].automaticSelectionEligible,false);}
  }
 }
 drafts.push({revision,originalSource:original,sourceHash:sha(original),pendingWindows,publicationAllowed:false});
}
assert.equal(drafts.length,2);
const files=['scripts/build-mann-type-count-drafts.mjs','src/lib/mann-unified-technical-profile.ts','src/lib/mann-transmission-component.ts','src/lib/fluid-source-system-context.ts','src/lib/mann-technical-applicability.ts'];
const report={parentPath:pre.planPath,planHash:pre.planHash,sourceHash:pre.sourceHash,mannHash:pre.mannHash,liveHash:pre.liveHash,denylistHash:pre.denylistHash,preflightHash:sha(preRaw),codeHashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary:{drafts:2,runtimeCases:cases,positiveCases:positive,partitionChecks,pendingIntervals:drafts.reduce((n,d)=>n+d.pendingWindows.length,0)},drafts,reviewEntries:pre.findings.filter(f=>f.reasons.length),productionApplyAllowed:false};
await writeFile(resolve(dir,'transmission-type-count-drafts-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
