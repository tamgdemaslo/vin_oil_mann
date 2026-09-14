#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
assert.ok([2,4].includes(process.argv.length) && !process.argv.slice(2).some(a=>a.startsWith('--')),'Offline only: [output-directory corrections-file]');
const root=resolve(import.meta.dirname,'..'),directory=resolve(root,'outputs/mann-live-audit-1789334190861');
const output=resolve(root,process.argv[2]??'outputs/mann-live-audit-1789334190861');
const raw=await readFile(resolve(directory,'revisions.json'),'utf8');
const revisions=JSON.parse(raw).filter(r=>r.matchClass==='CONDITIONAL_TRANSMISSION');
const [sourceRaw,mannRaw]=await Promise.all([readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8')]);
const overlay=await loadIdentityOverlay(root,sourceRaw,process.argv[3]?resolve(root,process.argv[3]):null);
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const rows=parseCopy(mannRaw,'mann_filter_applications'),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann,normalizeFluidRequirementVehicle}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {parseFluidCapacities}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {mannTransmissionComponent}=await jiti.import('../src/lib/mann-transmission-component.ts');
const cache=new Map(),results=[],counts={};
const typeBySystem={AUTOMATIC_TRANSMISSION:'automatic',MANUAL_TRANSMISSION:'manual',CVT_TRANSMISSION:'cvt',ROBOT_TRANSMISSION:'robot'};
for(const old of revisions){
  const r=sources.get(old.sourceRequirementId),targetRows=variants.get(old.vehicleVariantKey)??[];
  assert.ok(r);const normalized=normalizeFluidRequirementVehicle(r);
  const windows=targetRows.map(row=>applicabilityWindow(r,row));
  const window=windows[0];const reasons=[];
  if(!window||windows.some(w=>!w)||new Set(windows.map(sha)).size!==1)reasons.push('MONTH_SCOPE_UNKNOWN_OR_INCONSISTENT');
  const capacity=parseFluidCapacities(r.fillVolumeText,r.systemCode);
  if(capacity.needsReview)reasons.push('CAPACITY_REQUIRES_REVIEW');
  if(!r.specificationText?.trim()&&!r.specificationsJson?.length)reasons.push('MISSING_SPECIFICATION');
  if(typeBySystem[r.systemCode]!==r.transmissionType)reasons.push('TRANSMISSION_SYSTEM_CONFLICT');
  if(r.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_CONFLICT');
  let candidate=null;
  if(window&&normalized){
    const make=normalized.canonicalMake;
    if(!cache.has(make)){const forms=new Set(mannMakeFormsForTest(make));cache.set(make,rows.filter(row=>forms.has(normalizeMannText(row.makeNormalized||row.make))));}
    const match=matchFluidRequirementToMann({...r,...window.narrowedYears},cache.get(make));
    candidate=match.topCandidates.find(c=>c.variantIds.includes(old.vehicleVariantKey));
    if(!candidate||candidate.rank!==1||candidate.variantIds.length!==1||candidate.score<80||!candidate.matchedFields.includes('точный код двигателя'))reasons.push('VEHICLE_IDENTITY_NOT_UNIQUE_AND_EXACT');
    if(candidate?.hardConflicts.length)reasons.push(...candidate.hardConflicts);
    if(candidate?.reviewBlockers.some(b=>b!=='MANN variant не подтверждает тип или модель коробки'))reasons.push(...candidate.reviewBlockers.filter(b=>b!=='MANN variant не подтверждает тип или модель коробки'));
    if(!candidate?.reviewBlockers.includes('MANN variant не подтверждает тип или модель коробки'))reasons.push('CONDITIONAL_POLICY_NEEDS_RECLASSIFICATION');
  }else reasons.push('MISSING_NORMALIZED_VEHICLE');
  const component=String(r.componentModel??'').trim();
  // Only blank/placeholders or the type itself are satisfied by a type choice.
  // Gear counts, named models, model lists and embedded conditions remain distinct.
  const parsedComponent=mannTransmissionComponent(component);
  const typeOnly=parsedComponent.kind==='type';
  const singleModel=parsedComponent.kind==='model';
  const disposition=reasons.length?'APPLICABILITY_REVIEW':typeOnly?'TYPE_CONFIRMATION_PREVIEW':singleModel?'COMPONENT_CONFIRMATION_PREVIEW':'SOURCE_CONDITION_REVIEW';
  counts[disposition]=(counts[disposition]??0)+1;
  results.push({revisionId:old.id,sourceRequirementId:r.id,vehicleVariantKey:old.vehicleVariantKey,systemCode:r.systemCode,
    disposition,reasons:[...new Set(reasons)],requiredTransmissionType:r.transmissionType,requiredComponentRaw:r.componentModel,
    applicability:{...old.applicabilityJson,sourceVehicleScope:{make:r.make,model:r.model,...(r.generation?{generation:r.generation}:{})},matchedEngineScope:normalized?.sourceExactEngineCodes??[],window:window??null},
    sourceIdentityCorrection:overlay.changes.get(r.id)??null,
    originalTechnical:{fillVolumeText:r.fillVolumeText,specificationText:r.specificationText,replacementIntervalText:r.replacementIntervalText},
    capacity,validation:candidate,sourceUrl:r.sourceUrl,publicationAllowed:false,requiresSourceTechnicalReview:true});
  if(results.length%50===0)console.log(JSON.stringify({processed:results.length,total:revisions.length}));
}
assert.equal(new Set(results.map(r=>r.revisionId)).size,revisions.length);
const report={kind:'CONDITIONAL_TRANSMISSION_SCOPE_RECHECK',identityCorrections:overlay.metadata,sourceHashes:{revisions:sha(raw),fluids:sha(sourceRaw),mann:sha(mannRaw)},
  counts,total:results.length,productionApplyAllowed:false,
  limitation:'No type or component is confirmed by this report. Proposed display scopes require explicit vehicle details and technical source review.',results};
await writeFile(resolve(output,'conditional-transmission-recheck.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,results:undefined},null,2));
