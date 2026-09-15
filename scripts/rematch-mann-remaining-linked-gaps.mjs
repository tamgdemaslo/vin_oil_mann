import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const load=async p=>{const raw=await readFile(p,'utf8');return {raw,data:JSON.parse(raw)};};
const classification=await load(resolve(dir,'candidate-level-source-gap-classification-v1.json')),plan=await load(resolve(dir,'plan.json'));
assert.equal(sha(plan.raw),'813977a2654f21eac4510323cd8491eb8be59a5bf8b25c38e15aaea9fad4c444');
const manifest=await load(resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2/manifest.json'));
assert.equal(sha(manifest.data),'3536b390392b83b29977aeff91f024c7d63bd32ac69a40b3cdd1c38c08c87e77');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8'),raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(sql),manifest.data.sourceHash);assert.equal(sha(mannRaw),manifest.data.mannHash);assert.equal(sha(raw),manifest.data.rawHash);
const identity=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,raw),fuel=await applyAuditedSourceFuel(root,power.requirements,raw);
const corrected=fuel.requirements.map(s=>({...s,engineCodeNormalized:fuel.fresh.get(s.id).engineCodeNormalized,engineCodesJson:fuel.fresh.get(s.id).engineCodesJson}));assert.equal(sha(corrected),manifest.data.correctedSourcesHash);
const sources=new Map(corrected.map(s=>[s.id,s])),catalog=parseCopy(mannRaw,'mann_filter_applications');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest:makeForms}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText:norm}=await j.import('../src/lib/mann-catalog.ts');
const {parseFluidCapacities:parse}=await j.import('../src/lib/fluid-capacity-parser.ts');
const keys=new Set(classification.data.findings.filter(f=>f.category==='SOURCE_LINK_REQUIRES_SCOPE_REVIEW').map(f=>f.vehicleVariantKey));assert.equal(keys.size,34);
const pairs=classification.data.prioritizedSourceTargets.filter(l=>keys.has(l.vehicleVariantKey)&&!plan.data.newRevisions.some(r=>r.sourceRequirementId===l.sourceRequirementId&&r.vehicleVariantKey===l.vehicleVariantKey));
const cache=new Map(),findings=[];
for(const link of pairs){
 const source=sources.get(link.sourceRequirementId),rows=catalog.filter(r=>r.vehicleVariantKey===link.vehicleVariantKey);assert.ok(source&&rows.length);
 const windows=rows.map(r=>applicabilityWindow(source,r));
 const uniform=windows.every(w=>w?.intersection?.from&&w.intersection.to)&&new Set(windows.map(sha)).size===1;
 if(!uniform){findings.push({...link,disposition:'WINDOW_UNRESOLVED',windows});continue;}
 const window=windows[0],narrowed={...source,yearFrom:Number(window.intersection.from.slice(0,4)),yearTo:Number(window.intersection.to.slice(0,4))};
 // Only intersect dates. Never substitute engine, power, model, market or fuel to obtain a match.
 const forms=new Set(makeForms(link.sourceVehicle.canonicalMake)),makerows=catalog.filter(r=>forms.has(norm(r.makeNormalized||r.make)));
 assert.ok(makerows.some(r=>r.vehicleVariantKey===link.vehicleVariantKey));
 const cacheKey=sha([narrowed,link.sourceVehicle.canonicalMake]);
 if(!cache.has(cacheKey))cache.set(cacheKey,match(narrowed,makerows));
 const decision=cache.get(cacheKey),target=decision.targets.find(t=>t.vehicleVariantKey===link.vehicleVariantKey&&t.independentlyValidated),candidate=decision.topCandidates.find(c=>c.variantIds.includes(link.vehicleVariantKey));
 const capacity=parse(source.fillVolumeText,source.systemCode);
 findings.push({sourceRequirementId:source.id,vehicleVariantKey:link.vehicleVariantKey,systemCode:source.systemCode,sourceUrl:source.sourceUrl,effectiveSourceHash:sha(source),sourceEngineCodes:source.engineCodesJson,sourcePowerHp:source.powerHp,window,decisionFingerprint:decision.decisionFingerprint,status:decision.status,disposition:target?'CURRENT_IDENTITY_VALIDATED':'STILL_REQUIRES_EVIDENCE',target:target??null,candidate:candidate??null,reviewReasons:decision.reviewReasons,capacityNeedsReview:capacity.needsReview});
}
const counts=Object.fromEntries([...Map.groupBy(findings,f=>f.disposition)].map(([k,v])=>[k,v.length]));
const summary={variants:keys.size,pairs:findings.length,distinctMatcherCalls:cache.size,counts,validatedVariants:new Set(findings.filter(f=>f.target).map(f=>f.vehicleVariantKey)).size};
const runtimeFiles=['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-catalog.ts','src/lib/mann-vehicle-resolver.ts','src/lib/fluid-capacity-parser.ts'];
await writeFile(resolve(dir,'remaining-linked-gaps-rematch-v1.json'),JSON.stringify({kind:'CURRENT_REMAINING_LINKED_CANDIDATE_GAP_REMATCH',planHash:sha(plan.raw),classificationHash:sha(classification.raw),correctedSourcesHash:sha(corrected),runtimeHashes:Object.fromEntries(await Promise.all(runtimeFiles.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary,findings,productionApplyAllowed:false,limitations:['Historical queue is a source index only; current full-make matching performed.','Date intersections are candidate-specific and must remain explicit in any later draft.','Identity validation is not technical approval; raw fluid conditions, market and service-volume scope still require examination.','No original source identity field changed beyond audited overlays and date intersection.','No draft created and no actual VIN coverage claimed.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({summary,validated:findings.filter(f=>f.target).map(f=>({source:f.sourceRequirementId,key:f.vehicleVariantKey,system:f.systemCode,capacityNeedsReview:f.capacityNeedsReview}))}));
