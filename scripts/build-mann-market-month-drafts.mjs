import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {gearboxSourceQuality} from './lib/mann-gearbox-source-quality.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-non-ru-market-guarded-preview-2026-09-14');
const [planRaw,recheckRaw,partitionRaw,proofRaw,sql]=await Promise.all(['plan.json','source-market-month-identity-recheck-v1.json','source-market-month-partition-v1.json','source-market-month-partition-verification-v1.json'].map(f=>readFile(resolve(dir,f),'utf8')).concat(readFile('/tmp/vehicle_fluid_requirements.sql','utf8')));
const plan=JSON.parse(planRaw),recheck=JSON.parse(recheckRaw),partition=JSON.parse(partitionRaw),proof=JSON.parse(proofRaw);assert.equal(recheck.planHash,sha(planRaw));assert.equal(recheck.partitionHash,sha(partitionRaw));assert.equal(proof.partitionHash,sha(partitionRaw));assert.equal(proof.sourceHash,sha(sql));assert.equal(recheck.sourceHash,sha(sql));
for(const[file,hash]of Object.entries(recheck.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts'),{mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts'),{parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts'),{extractFluidSourceSystemContext:label}=await jiti.import('../src/lib/fluid-source-system-context.ts'),{VEHICLE_DESTINATION_MARKETS}=await jiti.import('../src/lib/vehicle-market.ts');
const sources=new Map(parseCopy(sql,'vehicle_fluid_requirements').map(r=>[r.id,r])),rows=new Map(plan.newRevisions.map(r=>[r.id,r])),quality=gearboxSourceQuality([...sources.values()],component,label),denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const runtime=r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}});
const payload=items=>items.map(i=>({systemCode:i.systemCode,componentModel:i.componentModel,capacities:i.capacities,specifications:i.specifications,viscosityGrades:i.viscosityGrades,recommendation:i.recommendation,replacementInterval:i.replacementInterval}));
const idx=m=>Number(m.slice(0,4))*12+Number(m.slice(5))-1,month=n=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;
const inside=(w,m)=>(!w.from||m>=w.from)&&(!w.to||m<=w.to);
const narrow=(scope,p)=>({...scope,...('yearFrom'in scope?{yearFrom:Number(p.sourceBranchWindow.from.slice(0,4)),yearTo:p.sourceBranchWindow.to?Number(p.sourceBranchWindow.to.slice(0,4)):null}:{}),matchedEngineScope:[p.engineCode],requiredMarket:p.requiredMarket,window:{...scope.window,source:p.sourceBranchWindow,intersection:p.window,narrowedYears:{yearFrom:p.window.from?Number(p.window.from.slice(0,4)):null,yearTo:p.window.to?Number(p.window.to.slice(0,4)):null},restricted:sha(p.window)!==sha(p.sourceBranchWindow)}});
const drafts=[],rejected=[];let cases=0;
for(const f of recheck.findings){
 const old=rows.get(f.revisionId);assert.equal(sha(old),f.revisionHash);const source=sources.get(f.sourceRequirementId);assert.equal(sha(source),f.sourceHash);
 if(f.branches.some(b=>b.identityReasons.length)){rejected.push({revisionId:old.id,reasons:[...new Set(f.branches.flatMap(b=>b.identityReasons))]});continue;}
 assert.equal(old.applyEligible,false);assert.equal(old.verificationStatus,'UNVERIFIED');assert.ok(!quality.heldBySource.has(source.id));assert.ok(!denied.has(originalAssociationFingerprint(old.vehicleVariantKey,source,parse(source.fillVolumeText,source.systemCode))));
 const policy=old.provenanceJson.catalogPreviewPolicy??old.provenanceJson.conditionalTransmissionPolicy??old.provenanceJson.conditionalEquipmentPolicy;
 for(const b of f.branches){
  const permitted=policy==='USER_CONFIRMED_TRANSMISSION_V1'?['MANN variant не подтверждает тип или модель коробки']:policy==='USER_CONFIRMED_EQUIPMENT_V1'?['MANN variant не подтверждает привод или модель агрегата','MANN variant не подтверждает наличие этой гидравлической системы']:[];
  assert.ok(b.candidate.reviewBlockers.every(reason=>permitted.includes(reason)),`${old.id}: ${b.candidate.reviewBlockers}`);
 }
 const groups=Map.groupBy(f.branches,b=>{const p=b.proposal;return sha({engine:p.engineCode,power:p.powerHp,market:p.requiredMarket,window:p.window,sourceWindow:p.sourceBranchWindow});});
 for(const group of groups.values()){
  const p=group[0].proposal,applicabilityJson=narrow(old.applicabilityJson,p),technicalDataJson=structuredClone(old.technicalDataJson);
  if(technicalDataJson.capacityBranches){const indices=new Set(group.map(b=>b.proposal.scopeIndex));assert.equal(indices.size,technicalDataJson.capacityBranches.length,'Partial capacity branch regrouping requires separate handling');technicalDataJson.capacityBranches=technicalDataJson.capacityBranches.map((b,i)=>({...b,applicabilityJson:narrow(b.applicabilityJson,group.find(x=>x.proposal.scopeIndex===i).proposal)}));}
  const fingerprint=policy==='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1'?sha({key:`${old.sourceRequirementId}:${old.vehicleVariantKey}`,policy,applicabilityJson,technicalDataJson}):policy==='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1'?sha({policy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,applicability:applicabilityJson,technicalData:technicalDataJson}):sha({policy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,applicabilityJson,technicalDataJson});
  const revision={...old,id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,applicabilityJson,technicalDataJson,provenanceJson:{...old.provenanceJson,sourceMarketMonthRepair:{originalRevisionId:old.id,originalRevisionHash:sha(old),recheckHash:sha(recheckRaw),partitionHash:sha(partitionRaw),proposalHashes:group.map(b=>b.proposalHash),requiredMarket:p.requiredMarket,sourcePowerHp:p.powerHp,sourceTechnicalReviewRequired:true}}};
  const base=runtime(old),fresh=runtime(revision),model=component(old.componentModel);assert.ok(!old.provenanceJson.explicitTransmissionModelList);
  const {systemCode,...equipment}=applicabilityJson.requiredEquipment??{},context={...applicabilityJson.sourceVehicleScope,engineCode:p.engineCode,transmissionModel:model.kind==='model'?model.model:undefined,transmissionGearCount:applicabilityJson.transmissionGearCount,confirmedEquipment:systemCode?[equipment]:undefined};
  const oldWindow=old.applicabilityJson.window.intersection,from=idx(oldWindow.from??p.window.from)-1,to=idx(oldWindow.to??'2026-09')+1;let positive=0,checks=0;
  for(let n=from;n<=to;n++)for(const type of [undefined,'automatic','manual','cvt','robot']){
   const productionMonth=month(n),baseline=profile([base],type,{...context,productionMonth}).items;
   for(const confirmedMarket of [...VEHICLE_DESTINATION_MARKETS,undefined,'DE']){
    const actual=profile([fresh],type,{...context,productionMonth,confirmedMarket}).items;
    const expected=confirmedMarket===p.requiredMarket&&inside(p.window,productionMonth)?baseline:[];
    assert.deepEqual(payload(actual),payload(expected),`${old.id}/${productionMonth}/${confirmedMarket}/${type}`);assert.ok(actual.every(i=>i.automaticSelectionEligible===false));positive+=actual.length;checks++;
   }
  }
  assert.ok(positive,`No positive case ${old.id}`);cases+=checks;drafts.push({originalRevisionId:old.id,originalRevisionHash:sha(old),proposalHashes:group.map(b=>b.proposalHash),revision,checks,positive,publicationAllowed:false});
 }
}
assert.equal(new Set(drafts.map(d=>d.originalRevisionId)).size,81);assert.equal(new Set(drafts.map(d=>d.revision.id)).size,drafts.length);
const files=['scripts/build-mann-market-month-drafts.mjs','scripts/lib/mann-gearbox-source-quality.mjs','src/lib/mann-unified-technical-profile.ts','src/lib/mann-technical-applicability.ts','src/lib/mann-capacity-branches.ts','src/lib/fluid-capacity-parser.ts','src/lib/fluid-source-system-context.ts','src/lib/mann-transmission-component.ts'];
const codeHashes={...recheck.codeHashes,...Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))])))};
const summary={sourceRevisions:81,drafts:drafts.length,rejectedRevisions:rejected.length,cases};
await writeFile(resolve(dir,'source-market-month-drafts-v1.json'),JSON.stringify({planHash:sha(planRaw),recheckHash:sha(recheckRaw),partitionHash:sha(partitionRaw),sourceHash:sha(sql),codeHashes,summary,drafts,rejected,productionApplyAllowed:false,limitation:'Drafts only. Differential real profile checks every month of prior bounded scopes plus neighbors; open-ended scopes tested through 2026-10. Conditions selected in baseline; missing/wrong equipment and engine still require independent negative checks. No merge or OEM approval; source partition must be rebuilt using surviving drafts.'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
