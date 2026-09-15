// Batch rematch of legacy lists. This generates evidence, never publication flags.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-live-audit-1789469257907');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(sourceRaw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const archive=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
const identity=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,archive),fuel=await applyAuditedSourceFuel(root,power.requirements,archive);
const sources=fuel.requirements.map(s=>({...s,engineCodeNormalized:fuel.fresh.get(s.id).engineCodeNormalized,engineCodesJson:fuel.fresh.get(s.id).engineCodesJson}));
const manifest=JSON.parse(await readFile(resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2/manifest.json'),'utf8'));assert.equal(sha(sources),manifest.correctedSourcesHash);
const originals=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(s=>[s.id,s])),mann=parseCopy(mannRaw,'mann_filter_applications');
const rawLive=await readFile(resolve(dir,'revisions.json'),'utf8'),live=JSON.parse(rawLive);
const inventory=JSON.parse(await readFile(resolve(dir,'teana-recorded-gap-1789473966720.json'),'utf8'));assert.equal(inventory.revisionSnapshotHash,sha(rawLive));
const queue=inventory.legacyListInventory.filter(r=>r.literalModels);assert.equal(queue.length,24);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {normalizeVehicleMake}=await j.import('../src/lib/vehicle-normalization.ts');
const {parseFluidCapacities}=await j.import('../src/lib/fluid-capacity-parser.ts');
const findings=[];
for(const old of queue){
 const s=sources.find(s=>s.id===old.sourceRequirementId);assert.ok(s);const original=originals.get(s.id);
 const brand=mann.filter(r=>normalizeVehicleMake(r.make)===normalizeVehicleMake(s.make));assert.ok(brand.length);
 const decision=match(s,brand),candidate=decision.topCandidates.find(c=>c.variantIds.includes(old.variantKey));
 const blockers=candidate?.reviewBlockers??[],conflicts=candidate?.hardConflicts??[];
 const samePair=live.filter(r=>r.id!==old.revisionId&&r.sourceRequirementId===s.id&&r.vehicleVariantKey===old.variantKey&&['ACTIVE','STAGED','REVIEW'].includes(r.state));
 const classification=!candidate?'OLD_TARGET_NOT_IN_TOP_CANDIDATES':conflicts.length?'HARD_CONFLICT':blockers.length===1&&blockers[0]==='MANN variant не подтверждает тип или модель коробки'?'GEARBOX_ONLY_REVIEW':blockers.some(b=>b.includes('поколение')||b.includes('код кузова'))?'IDENTITY_EVIDENCE_MISSING':'ADDITIONAL_REVIEW';
 let dateScoped=null;
 if(classification==='ADDITIONAL_REVIEW'&&!samePair.length){
  const targetRows=mann.filter(r=>r.vehicleVariantKey===old.variantKey),windows=targetRows.map(r=>applicabilityWindow(s,r));
  if(windows.length&&windows.every(w=>w&&sha(w)===sha(windows[0]))){
   const window=windows[0],scopedSource={...s,...window.narrowedYears},scopedDecision=match(scopedSource,brand),scopedCandidate=scopedDecision.topCandidates.find(c=>c.variantIds.includes(old.variantKey));
   dateScoped={window,effectiveSource:s,scopedSourceHash:sha(scopedSource),candidate:scopedCandidate??null,capacityParse:parseFluidCapacities(original.fillVolumeText,original.systemCode),onlyGearboxBlocker:!!scopedCandidate&&scopedCandidate.hardConflicts.length===0&&scopedCandidate.reviewBlockers.length===1&&scopedCandidate.reviewBlockers[0]==='MANN variant не подтверждает тип или модель коробки'};
  }
 }
 findings.push({revisionId:old.revisionId,sourceId:s.id,vehicleVariantKey:old.variantKey,sourceHash:sha(original),effectiveSourceHash:sha(s),make:s.make,model:s.model,engine:s.engineCodeNormalized,system:s.systemCode,component:s.componentModel,literalModels:old.literalModels,classification,candidate,dateScoped,otherSamePairRevisions:samePair.map(r=>({id:r.id,state:r.state,scoped:!!r.applicabilityJson?.window})),decision});
}
const summary={records:findings.length,sources:new Set(findings.map(f=>f.sourceId)).size,classifications:Object.fromEntries([...new Set(findings.map(f=>f.classification))].map(c=>[c,findings.filter(f=>f.classification===c).length])),withOtherSamePair:findings.filter(f=>f.otherSamePairRevisions.length).length};
const output=resolve(dir,`legacy-transmission-list-rematch-${Date.now()}.json`);await writeFile(output,JSON.stringify({kind:'LEGACY_TRANSMISSION_LIST_FULL_BRAND_REMATCH',generatedAt:new Date().toISOString(),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),liveHash:sha(rawLive),correctedSourcesHash:sha(sources),summary,findings,limitations:['Read-only offline audit; no production changes.','Gearbox-only review is not publishable approval: source model list, gear count, engine/date scope, existing revision ownership, and route negatives still require proof.','Missing identity cannot be repaired by widening scope or inferring chassis from engine and dates.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,summary,dateScoped:findings.filter(f=>f.dateScoped).map(f=>({model:f.model,engine:f.engine,window:f.dateScoped.window.intersection,onlyGearboxBlocker:f.dateScoped.onlyGearboxBlocker,remainingBlockers:f.dateScoped.candidate?.reviewBlockers,capacityNeedsReview:f.dateScoped.capacityParse.needsReview,capacityCount:f.dateScoped.capacityParse.capacities.length,raw:f.dateScoped.effectiveSource.fillVolumeText}))},null,2));
