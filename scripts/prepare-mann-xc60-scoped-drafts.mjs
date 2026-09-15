import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
const version=process.argv[2]??'v1';assert.ok(['v1','v2'].includes(version));
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const preRaw=await readFile(resolve(dir,`xc60-source-branch-preflight-${version}.json`),'utf8'),pre=JSON.parse(preRaw),planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw);
assert.equal(sha(planRaw),pre.planHash);
for(const [p,h] of Object.entries(pre.codeHashes))assert.equal(sha(await readFile(resolve(root,p),'utf8')),h);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(sourceRaw),pre.sourceHash);assert.equal(sha(mannRaw),pre.mannHash);
const rawText=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(rawText),pre.rawHash);
const rawRows=rawText.trim().split('\n').map(JSON.parse),rawById=new Map(rawRows.map(r=>[r.row_id,r]));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34'),sources=new Map(overlay.requirements.map(r=>[r.id,r]));
let powerOverlay=null,delta=null,deltaHash=null;
if(version==='v2'){
 powerOverlay=await applyAuditedTablePower(root,overlay.requirements,rawText);assert.equal(powerOverlay.proofHash,pre.powerOverlayProofHash);assert.equal(powerOverlay.parserHash,pre.parserHash);
 for(const source of powerOverlay.requirements)sources.set(source.id,source);
 const deltaRaw=await readFile(resolve(dir,'xc60-power-transition-verification-v1.json'),'utf8');deltaHash=sha(deltaRaw);delta=JSON.parse(deltaRaw);
 assert.equal(delta.afterHash,sha(preRaw));assert.equal(delta.planHash,sha(planRaw));assert.equal(delta.added.length,3);
}
const denyRaw=await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8');assert.equal(sha(denyRaw),pre.denylistHash);const denied=new Set(JSON.parse(denyRaw).rejectedAssociationFingerprints);
const liveRaw=await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8');assert.equal(sha(liveRaw),pre.liveHash);const live=JSON.parse(liveRaw);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{parseSpecifications}=await j.import('../src/lib/fluid-catalog.ts'),{parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts'),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const policy='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1',revisions=[],pending=[],review=[],retainedExisting=[];let isolatedCases=0;
const month=s=>Number(s.slice(0,4))*12+Number(s.slice(5))-1,date=m=>`${Math.floor(m/12)}-${String(m%12+1).padStart(2,'0')}`;
const fixture=r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,transmissionTypeCountPolicy:r.provenanceJson.explicitTransmissionTypeCount?.policy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,equipmentComponentDrivePolicy:r.provenanceJson.explicitComponentDriveCondition?.policy,equipmentModelPolicy:r.provenanceJson.explicitEquipmentModel?.policy,transmissionModelListPolicy:r.provenanceJson.explicitTransmissionModelList?.policy,automaticProductSelection:false}}});
for(const finding of pre.findings){
 const source=sources.get(finding.sourceRequirementId),original=overlay.originalById.get(source.id);assert.equal(sha(original),finding.originalSourceHash);
 for(const pair of finding.pairs){
  if(pair.reasons.length){review.push({sourceRequirementId:source.id,targetId:pair.targetId,branch:pair.branch,reasons:pair.reasons,publicationAllowed:false});continue;}
  const row=rawById.get(original.sourceRowId),anchor=rawById.get(pair.branch.anchorRowId);assert.equal(sha(anchor),pair.branch.anchorHash);
  assert.equal(row.source_url,anchor.source_url);assert.equal(row.table_index,anchor.table_index);
  assert.ok(finding.sourceEngines.includes(pair.branch.engineCode));
  if(source.systemCode==='ENGINE_OIL')assert.equal(row.row_id,anchor.row_id);
  const scopedRaw=rawRows.filter(r=>r.source_url===row.source_url&&r.table_index===row.table_index);
  if(scopedRaw.some(r=>/Россия|Япония|Европа|США|ОАЭ|Китай|Корея|Азия/iu.test(`${r.application} ${r.model} ${r.production_years}`))){review.push({sourceRequirementId:source.id,targetId:pair.targetId,reasons:['EXPLICIT_MARKET_REVIEW'],publicationAllowed:false});continue;}
  const existing=plan.newRevisions.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===pair.targetId);
  if(existing.length){
   assert.equal(version,'v2');assert.equal(existing.length,1);const old=existing[0];
   assert.deepEqual(old.applicabilityJson.matchedEngineScope,[pair.branch.engineCode]);assert.deepEqual(old.applicabilityJson.window,pair.window);
   assert.equal(old.technicalDataJson.fillVolumeText,original.fillVolumeText);assert.equal(old.technicalDataJson.specificationText,original.specificationText);
   assert.ok(plan.xc60ScopedHistory.newRevisionIds.includes(old.id));retainedExisting.push(old.id);continue;
  }
  if(delta)assert.ok(delta.added.some(p=>p.sourceRequirementId===source.id&&p.targetId===pair.targetId&&sha(p.branch)===sha(pair.branch)));
  const old=live.filter(r=>r.sourceRequirementId===source.id&&r.vehicleVariantKey===pair.targetId);
  assert.equal(old.length,0,'Predecessors require explicit reconciliation before drafting');
  const capacity=parse(original.fillVolumeText,original.systemCode);assert.deepEqual(capacity,finding.parsedCapacity);assert.equal(capacity.needsReview,false);assert.ok(capacity.capacities.length);
  const fingerprint=originalAssociationFingerprint(pair.targetId,original,capacity);assert.equal(fingerprint,pair.originalAssociationFingerprint);assert.ok(!denied.has(fingerprint));
  const target=pair.decision.targets.find(t=>t.vehicleVariantKey===pair.targetId&&t.independentlyValidated);assert.ok(target);
  const applicability={sourceVehicleScope:{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})},matchedEngineScope:[pair.branch.engineCode],window:pair.window};
  const technical={fillVolumeText:original.fillVolumeText,capacities:capacity.capacities,specifications:parseSpecifications(original.specificationText,original.viscosityGradesJson??[]),viscosityGrades:original.viscosityGradesJson};
  for(const key of ['specificationText','recommendationText','replacementIntervalText','replacementKmMin','replacementKmMax','replacementMonths','controlIntervalText','analogText'])technical[key]=original[key];
  const semanticFingerprint=sha({policy,sourceRequirementId:source.id,vehicleVariantKey:pair.targetId,applicability,technicalData:technical});
  const revision={id:`mtar_${semanticFingerprint.slice(0,24)}`,semanticFingerprint,sourceRequirementId:source.id,vehicleVariantKey:pair.targetId,systemCode:source.systemCode,componentModel:source.componentModel,applicabilityJson:applicability,technicalDataJson:technical,verifiedFieldsJson:[],fieldConfidenceJson:Object.fromEntries(['capacity','specifications','viscosityGrades','recommendation','replacementInterval'].map(k=>[`technical.${k}`,'SECONDARY_SOURCE_PARSED_MEDIUM'])),evidenceJson:[{publisher:'podbormasla.ru',title:'Каталог технических жидкостей',url:original.sourceUrl}],provenanceJson:{catalogPreviewPolicy:policy,catalogPreviewEligible:true,sourceTechnicalReviewRequired:true,sourceAssociationFingerprint:fingerprint,independentValidation:target,sourceIdentityOverlayHash:overlay.metadata.sha256,sourcePowerModelDateBranch:{reportHash:sha(preRaw),...pair.branch,acceptedWindow:pair.window.intersection},sourceScopeReviewRequired:true,independentOemVerified:false},matchClass:pair.decision.status,matchScore:target.score,state:'STAGED',verificationStatus:'UNVERIFIED',applyEligible:false,replacesRevisionIds:[]};
  const runtime=fixture(revision),win=pair.window.intersection;
  if(powerOverlay){assert.deepEqual(finding.powerCorrection,powerOverlay.changes.get(source.id));revision.provenanceJson.sourcePowerOverlay={proofHash:powerOverlay.proofHash,deltaHash,correction:finding.powerCorrection};}
  for(let m=month(win.from)-1;m<=month(win.to)+1;m++)for(const engineCode of [pair.branch.engineCode,'WRONG',undefined]){
   const context={...applicability.sourceVehicleScope,engineCode,productionMonth:date(m)},items=profile([runtime],undefined,context).items;
   const allowed=engineCode===pair.branch.engineCode&&m>=month(win.from)&&m<=month(win.to);
   assert.equal(items.length,allowed?1:0);assert.ok(items.every(i=>!i.automaticSelectionEligible));isolatedCases++;
  }
  const positive={...applicability.sourceVehicleScope,engineCode:pair.branch.engineCode,productionMonth:win.from};
  for(const context of [{...positive,make:'TOYOTA'},{...positive,model:'XC90'},{...positive,generation:'II'},{...positive,productionMonth:undefined}]){assert.equal(profile([runtime],undefined,context).items.length,0);isolatedCases++;}
  assert.equal(profile([{...runtime,run:{...runtime.run,status:'PLANNED'}}],undefined,positive).items.length,0);isolatedCases++;
  revisions.push(revision);pending.push({sourceRequirementId:source.id,vehicleVariantKey:pair.targetId,originalSourceHash:sha(original),acceptedEngineScope:[pair.branch.engineCode],acceptedWindow:win,reason:'RECONCILE_REMAINING_SOURCE_DATES_ENGINES_AND_PREDECESSORS',publicationAllowed:false});
 }
}
assert.equal(revisions.length,version==='v1'?6:3);assert.equal(new Set(revisions.map(r=>r.id)).size,revisions.length);
if(version==='v2'){assert.equal(retainedExisting.length,6);assert.equal(review.length,37);}
const protectedIds=new Set(plan.existingActions.filter(a=>a.action==='PRESERVE_PROTECTED').map(a=>a.revisionId));
const before=[...plan.newRevisions.map(fixture),...live.filter(r=>protectedIds.has(r.id)).map(r=>({...r,createdAt:new Date(r.createdAt)}))],after=[...before,...revisions.map(fixture)],contexts=new Map(),seen=new Set();let jointCases=0;
const print=i=>sha({systemCode:i.systemCode,componentModel:i.componentModel,capacities:i.capacities,specifications:i.specifications,viscosityGrades:i.viscosityGrades,recommendation:i.recommendation,replacementInterval:i.replacementInterval});
for(const r of revisions){const a=r.applicabilityJson,w=a.window.intersection;for(let m=month(w.from)-1;m<=month(w.to)+1;m++)for(const engineCode of [...a.matchedEngineScope,'WRONG',undefined]){const context={...a.sourceVehicleScope,engineCode,productionMonth:date(m)};contexts.set(sha({variant:r.vehicleVariantKey,context}),{variant:r.vehicleVariantKey,context});}}
for(const {variant,context} of contexts.values())for(const type of [undefined,'automatic','manual','cvt','robot']){
 const oldRows=before.filter(r=>r.vehicleVariantKey===variant),newRows=after.filter(r=>r.vehicleVariantKey===variant),old=profile(oldRows,type,context),now=profile(newRows,type,context),actual=new Set(now.items.map(print));
 for(const item of old.items)assert.ok(actual.has(print(item)));
 const isolated=newRows.flatMap(r=>profile([r],type,context).items),primarySystems=new Set(isolated.filter(i=>i.sourceStatus==='primary_source').map(i=>i.systemCode));
 assert.deepEqual(actual,new Set(isolated.filter(i=>i.sourceStatus==='primary_source'||!primarySystems.has(i.systemCode)).map(print)));
 for(const [,items] of Map.groupBy(now.items,i=>`${i.systemCode}:${i.componentModel??''}`))for(let a=0;a<items.length;a++)for(let b=a+1;b<items.length;b++)assert.equal(sha({c:items[a].capacities,s:items[a].specifications}),sha({c:items[b].capacities,s:items[b].specifications}),'Conflicting fluid payloads');
 for(const item of now.items){seen.add(item.revisionId);assert.equal(item.automaticSelectionEligible,false);}jointCases++;
}
assert.ok(revisions.every(r=>seen.has(r.id)));assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),sha(planRaw));
const summary={revisions:revisions.length,variants:new Set(revisions.map(r=>r.vehicleVariantKey)).size,reviewPairs:review.length,pending:pending.length,retainedExisting:retainedExisting.length,isolatedCases,jointCases,newRevisionsSeen:revisions.filter(r=>seen.has(r.id)).length,newConflicts:0};
await writeFile(resolve(dir,`xc60-scoped-preview-drafts-${version}.json`),JSON.stringify({kind:'XC60_SCOPED_PREVIEW_DRAFTS_WITH_PROFILE_PROOF',planHash:sha(planRaw),preflightHash:sha(preRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),liveHash:sha(liveRaw),builderHash:sha(await readFile(new URL(import.meta.url),'utf8')),summary,revisions,pending,review,retainedExisting,deltaHash,productionApplyAllowed:false,limitations:['Synthetic completed staging runs; no deployed VIN, live database import or equipment Cartesian proof.','All 71 source findings, unparsed anchors and uncovered branches remain in linked preflight, including sources with no generated pairs.','Secondary fluid facts not independently OEM verified; drafts not merged into canonical.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
