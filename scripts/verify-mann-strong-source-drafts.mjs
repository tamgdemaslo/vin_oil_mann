import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {splitSpecificationSections} from './lib/mann-specification-sections-v2.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14');
const [raw,preflightRaw,summaryRaw,sql]=await Promise.all(['strong-source-drafts-v1.json','strong-source-conditions-v1.json','summary.json'].map(f=>readFile(resolve(dir,f),'utf8')).concat(readFile('/tmp/vehicle_fluid_requirements.sql','utf8')));
const report=JSON.parse(raw),preflight=JSON.parse(preflightRaw),summary=JSON.parse(summaryRaw);assert.equal(report.preflightHash,sha(preflightRaw));assert.equal(preflight.sourceHash,sha(sql));
const planRaw=await readFile(summary.planPath,'utf8');assert.equal(report.planHash,sha(planRaw));const plan=JSON.parse(planRaw);
const liveRaw=await readFile(resolve(root,plan.inputFiles.live),'utf8');assert.equal(sha(liveRaw),report.liveHash);const live=JSON.parse(liveRaw);
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(s=>[s.id,s]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts'),{parseFluidCapacities:capacity}=await jiti.import('../src/lib/fluid-capacity-parser.ts'),{parseSpecifications}=await jiti.import('../src/lib/fluid-catalog.ts');
const denyRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8'),denied=new Set(JSON.parse(denyRaw).rejectedAssociationFingerprints);
const idx=m=>Number(m.slice(0,4))*12+Number(m.slice(5))-1,month=i=>`${Math.floor(i/12)}-${String(i%12+1).padStart(2,'0')}`;
const contains=(w,m)=>(w.from===null||m>=w.from)&&(w.to===null||m<=w.to);
let cases=0,positive=0,partitionChecks=0;const checks=[];
for(const d of report.revisionDrafts){
 const r=d.revision,s=sources.get(r.sourceRequirementId),scope=r.applicabilityJson,f=preflight.findings.find(f=>f.sourceRequirementId===s.id);
 assert.deepEqual(s,d.originalSource);assert.equal(sha(s),d.sourceHash);assert.deepEqual(f.reasons,[]);assert.deepEqual(scope.window,f.window);assert.deepEqual(scope.matchedEngineScope,f.engineCodes);assert.equal(r.vehicleVariantKey,f.targetId);
 const parsed=capacity(s.fillVolumeText,s.systemCode);assert.equal(parsed.needsReview,false);assert.deepEqual(r.technicalDataJson.capacities,parsed.capacities);
 const fp=originalAssociationFingerprint(r.vehicleVariantKey,s,parsed);assert.equal(fp,r.provenanceJson.sourceAssociationFingerprint);assert.ok(!denied.has(fp));
 const priors=live.filter(p=>p.sourceRequirementId===s.id&&p.vehicleVariantKey===r.vehicleVariantKey);
 assert.ok(priors.every(p=>!p.reviewConfirmed&&p.verificationStatus!=='PRIMARY_SOURCE_VERIFIED_FIELDS'));assert.deepEqual(r.replacesRevisionIds,priors.map(p=>p.id));
 assert.equal(r.applyEligible,false);assert.equal(r.verificationStatus,'UNVERIFIED');assert.deepEqual(r.verifiedFieldsJson,[]);
 const tech=r.technicalDataJson;for(const k of ['fillVolumeText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])assert.deepEqual(tech[k],s[k]);
 const sections=splitSpecificationSections(s.specificationText,s.analogText);
 if(sections.status==='EXPLICIT_ANALOG_SEPARATED'){
  const main=sections.main.text.trim(),grades=[...new Set([...main.matchAll(/\b\d{1,2}W(?:-?\d{2})?\b/gi)].map(m=>m[0].toUpperCase()))];
  assert.equal(tech.specificationText,main);assert.deepEqual(tech.viscosityGrades,grades);assert.deepEqual(tech.specifications,[{type:'SOURCE_REQUIREMENT_TEXT',value:main},...parseSpecifications(main,grades).filter(s=>s.type!=='RAW')]);
  assert.equal(tech.sourceSpecificationAttribution.originalSpecificationText,s.specificationText);assert.equal(tech.sourceSpecificationAttribution.unverifiedAnalogText,sections.analog.text.trim());assert.equal(tech.sourceSpecificationAttribution.metadataAndCautionText,sections.suffix.text.trim());
 }else{assert.deepEqual(tech.specifications,s.specificationsJson);assert.deepEqual(tech.viscosityGrades,s.viscosityGradesJson);assert.equal(tech.specificationText,s.specificationText);}
 const window=scope.window.intersection,source=scope.window.source;assert.ok(source.from&&source.to&&window.from&&window.to,'Closed windows required for exhaustive verification');
 const row={...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,automaticProductSelection:false}}};
 const model=f.component.kind==='model'?f.component.model:undefined,count=scope.transmissionGearCount;
 let visible=0;
 for(let i=idx(source.from)-1;i<=idx(source.to)+1;i++){
  const m=month(i),inside=contains(window,m),pending=d.pendingWindows.filter(w=>contains(w,m)).length;
  assert.equal(Number(inside)+pending,Number(contains(source,m)));partitionChecks++;
  for(const type of [undefined,'automatic','manual','cvt','robot'])for(const engineCode of [...scope.matchedEngineScope,undefined,'WRONG_ENGINE'])for(const transmissionModel of model?[model,undefined,'WRONG_MODEL']:[undefined])for(const transmissionGearCount of count?[count,undefined,99]:[undefined]){
   const context={...scope.sourceVehicleScope,engineCode,productionMonth:m,transmissionModel,transmissionGearCount};
   const expected=inside&&scope.matchedEngineScope.includes(engineCode)&&(!scope.transmissionType||type===scope.transmissionType)&&(!model||transmissionModel===model)&&(!count||transmissionGearCount===count);
   const items=profile([row],type,context).items;assert.equal(items.length,expected?1:0,`${s.id} ${JSON.stringify(context)} ${type}`);cases++;if(expected){positive++;visible++;}
  }
 }
 assert.ok(visible>0);checks.push({revisionId:r.id,sourceRequirementId:s.id,visibleCases:visible,pendingWindows:d.pendingWindows});
}
assert.equal(checks.length,7);assert.equal(new Set(checks.map(c=>c.sourceRequirementId)).size,7);
const files=['scripts/build-mann-strong-source-drafts.mjs','scripts/verify-mann-strong-source-drafts.mjs','src/lib/mann-unified-technical-profile.ts','src/lib/mann-technical-applicability.ts','src/lib/fluid-capacity-parser.ts','src/lib/fluid-catalog.ts'];
const result={planHash:sha(planRaw),draftHash:sha(raw),sourceHash:sha(sql),denylistHash:sha(denyRaw),checked:7,runtimeCases:cases,positiveCases:positive,partitionChecks,pendingIntervals:checks.reduce((n,c)=>n+c.pendingWindows.length,0),checks,codeHashes:Object.fromEntries(await Promise.all(files.map(async file=>[file,sha(await readFile(resolve(root,file),'utf8'))]))),productionApplyAllowed:false,limitation:'Exhaustive source-month/type/engine/model/count and source-preservation verification for7 drafts. Not OEM fact confirmation, raw unlabeled-market completeness, or joint profile/real VIN verification.'};
await writeFile(resolve(dir,'strong-source-draft-verification-v1.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...result,checks:undefined,codeHashes:undefined}));
