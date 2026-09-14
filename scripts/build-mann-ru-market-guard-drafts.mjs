import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
assert.ok(process.argv.length<=4&&(!process.argv[3]||process.argv[3]==='non-ru'));const nonRu=process.argv[3]==='non-ru';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,process.argv[2]??'outputs/mann-market-power-held-preview-2026-09-14');
const [raw,identityRaw,marketRaw]=await Promise.all(['plan.json',nonRu?'non-ru-market-identity-recheck-v1.json':'ru-market-identity-recheck-v1.json',nonRu?'source-market-target-scope-audit-v2.json':'source-market-target-scope-audit-v1.json'].map(f=>readFile(resolve(dir,f),'utf8')));
const plan=JSON.parse(raw),identity=JSON.parse(identityRaw),market=JSON.parse(marketRaw);assert.equal(identity.planHash,sha(raw));assert.equal(identity.marketAuditHash,sha(marketRaw));assert.equal(market.planHash,sha(raw));
for(const [file,hash] of Object.entries({...identity.codeHashes,...market.codeHashes}))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
assert.equal(identity.sourceHash,sha(await readFile('/tmp/vehicle_fluid_requirements.sql','utf8')));assert.equal(identity.mannHash,sha(await readFile('/tmp/mann_filter_applications.sql','utf8')));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{buildMannUnifiedTechnicalProfile:profile}=await jiti.import('../src/lib/mann-unified-technical-profile.ts'),{mannTransmissionComponent:component}=await jiti.import('../src/lib/mann-transmission-component.ts');
const {VEHICLE_DESTINATION_MARKETS}=await jiti.import('../src/lib/vehicle-market.ts');
const byId=new Map(plan.newRevisions.map(r=>[r.id,r])),drafts=[];let checks=0,visible=0;
const runtime=r=>({...r,createdAt:new Date('2026-09-14'),reviewConfirmed:false,run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,automaticProductSelection:false}}});
const payload=items=>items.map(i=>({systemCode:i.systemCode,componentModel:i.componentModel,capacities:i.capacities,specifications:i.specifications,viscosityGrades:i.viscosityGrades,recommendation:i.recommendation,replacementInterval:i.replacementInterval}));
const shift=(m,delta)=>{const n=Number(m.slice(0,4))*12+Number(m.slice(5))-1+delta;return`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;};
for(const finding of identity.findings.filter(f=>!f.reasons.length)){
 const old=byId.get(finding.revisionId);assert.equal(sha(old),finding.revisionHash);assert.equal(old.applyEligible,false);assert.equal(old.verificationStatus,'UNVERIFIED');
 const evidence=market.findings.find(f=>f.revisionId===old.id);assert.deepEqual(evidence.statuses,[nonRu?'NON_RU_GUARD_MISSING_EXACT_POWER_DATES_SUPPORTED':'RU_GUARD_MISSING_EXACT_POWER_DATES_SUPPORTED']);
 const markets=[...new Set(evidence.checks.flatMap(c=>c.markets))];assert.equal(markets.length,1);const requiredMarket=markets[0];assert.ok(VEHICLE_DESTINATION_MARKETS.includes(requiredMarket));assert.ok(nonRu?requiredMarket!=='RU':requiredMarket==='RU');
 const applicabilityJson={...old.applicabilityJson,requiredMarket},technicalDataJson=structuredClone(old.technicalDataJson);
 if(technicalDataJson.capacityBranches)technicalDataJson.capacityBranches=technicalDataJson.capacityBranches.map(b=>({...b,applicabilityJson:{...b.applicabilityJson,requiredMarket}}));
 const stripped=structuredClone(technicalDataJson);for(const b of stripped.capacityBranches??[])delete b.applicabilityJson.requiredMarket;assert.deepEqual(stripped,old.technicalDataJson);
 const policy=old.provenanceJson.catalogPreviewPolicy??old.provenanceJson.conditionalTransmissionPolicy??old.provenanceJson.conditionalEquipmentPolicy;
 let fingerprint;
 if(policy==='MANN_CONDITIONAL_CAPACITY_PREVIEW_V1')fingerprint=sha({key:`${old.sourceRequirementId}:${old.vehicleVariantKey}`,policy,applicabilityJson,technicalDataJson});
 else if(policy==='MANN_ENGINE_DATE_SCOPED_PREVIEW_V1')fingerprint=sha({policy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,applicability:applicabilityJson,technicalData:technicalDataJson});
 else {assert.ok(['USER_CONFIRMED_TRANSMISSION_V1','USER_CONFIRMED_EQUIPMENT_V1'].includes(policy));fingerprint=sha({policy,sourceRequirementId:old.sourceRequirementId,vehicleVariantKey:old.vehicleVariantKey,applicabilityJson,technicalDataJson});}
 const revision={...old,id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,applicabilityJson,technicalDataJson,provenanceJson:{...old.provenanceJson,sourceMarketGuardRepair:{originalRevisionId:old.id,originalRevisionHash:sha(old),identityAuditHash:sha(identityRaw),marketAuditHash:sha(marketRaw),sourceAnchorHash:evidence.anchorHash,requiredMarket,sourceTechnicalReviewRequired:true}}};
 const scopes=old.technicalDataJson.capacityBranches?.map(b=>b.applicabilityJson)??[old.applicabilityJson];let recordVisible=0,recordChecks=0;
 for(const scope of scopes){
  const window=scope.window.intersection,dates=[...new Set([window.from,window.to].filter(Boolean).flatMap(m=>[shift(m,-1),m,shift(m,1)]))];assert.ok(dates.length);
  const model=component(old.componentModel),transmissionModel=model.kind==='model'?model.model:undefined;
  assert.ok(!old.provenanceJson.explicitTransmissionModelList,'Model-list drafts need separate enumeration');
  const {systemCode,...equipment}=scope.requiredEquipment??{};
  for(const productionMonth of dates)for(const engineCode of [...scope.matchedEngineScope,'WRONG_ENGINE',undefined])for(const transmissionType of [undefined,'automatic','manual','cvt','robot'])for(const selected of [false,true]){
   const context={...old.applicabilityJson.sourceVehicleScope,productionMonth,engineCode,...(selected?{transmissionModel,transmissionGearCount:scope.transmissionGearCount,confirmedEquipment:systemCode?[equipment]:undefined}:{})};
   const baseline=profile([runtime(old)],transmissionType,context).items;
   for(const confirmedMarket of [...VEHICLE_DESTINATION_MARKETS,undefined,'DE']){
    const actual=profile([runtime(revision)],transmissionType,{...context,confirmedMarket}).items;
    if(confirmedMarket===requiredMarket){assert.deepEqual(payload(actual),payload(baseline),old.id);recordVisible+=actual.length;assert.ok(actual.every(i=>i.automaticSelectionEligible===false));}
    else assert.equal(actual.length,0,old.id);
    recordChecks++;
   }
  }
 }
 assert.ok(recordVisible>0,`No positive runtime case ${old.id}`);checks+=recordChecks;visible+=recordVisible;
 drafts.push({originalRevisionId:old.id,originalRevisionHash:sha(old),revision,checks:recordChecks,visible:recordVisible,publicationAllowed:false});
}
assert.equal(drafts.length,nonRu?74:245);assert.equal(new Set(drafts.map(d=>d.revision.id)).size,drafts.length);
const codeFiles=['scripts/build-mann-ru-market-guard-drafts.mjs','src/lib/mann-unified-technical-profile.ts','src/lib/mann-technical-applicability.ts','src/lib/mann-capacity-branches.ts','src/lib/mann-transmission-component.ts'];
const codeHashes={...identity.codeHashes,...market.codeHashes,...Object.fromEntries(await Promise.all(codeFiles.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))])))};
const summary={drafts:drafts.length,checks,visible};
await writeFile(resolve(dir,nonRu?'non-ru-market-guard-drafts-v1.json':'ru-market-guard-drafts-v1.json'),JSON.stringify({planHash:sha(raw),identityAuditHash:sha(identityRaw),marketAuditHash:sha(marketRaw),codeHashes,summary,drafts,productionApplyAllowed:false,limitation:'Market restriction-only drafts. Differential runtime endpoint/neighbor checks preserve payload for the exact required market and suppress every other/unknown market. Not full monthly/source partition, OEM approval, or canonical merge. Uncovered source branches remain pending.'},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
