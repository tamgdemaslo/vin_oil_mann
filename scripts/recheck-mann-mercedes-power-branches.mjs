import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {mercedesPowerBranches,mercedesPowerModelMatches} from './lib/mann-mercedes-power-branches.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const triageRaw=await readFile(resolve(dir,'mercedes-gained-target-triage-v1.json'),'utf8'),triage=JSON.parse(triageRaw),draftRaw=await readFile(resolve(dir,'mercedes-gained-preview-drafts-v1.json'),'utf8'),draft=JSON.parse(draftRaw);assert.equal(draft.triageHash,sha(triageRaw));
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),triage.planHash);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),triage.sourceHash);
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34'),sources=new Map(overlay.requirements.map(s=>[s.id,s]));
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),triage.mannHash);const rows=parseCopy(mannRaw,'mann_filter_applications'),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
const forms=new Set(mannMakeFormsForTest('MERCEDES')),catalog=rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))),findings=[];
for(const f of triage.findings.filter(f=>!f.existingRevisionIds.length)){
 const prior=draft.review.find(r=>r.sourceRequirementId===f.sourceRequirementId&&r.vehicleVariantKey===f.vehicleVariantKey);assert.ok(prior);
 const source=sources.get(f.sourceRequirementId),targets=variants.get(f.vehicleVariantKey),branches=[],reasons=[];
 if(f.matchingAnchors.length!==1)reasons.push('NONUNIQUE_MATCHING_ENGINE_ANCHOR');
 else{
  const anchor=f.matchingAnchors[0],parsed=mercedesPowerBranches(anchor.row.power,anchor.row.production_years);
  if(!parsed)reasons.push('POWER_PHRASE_NOT_FULLY_PARSED');
  else if(new Set(anchor.exactCodes).size!==1)reasons.push('MULTIPLE_ENGINES_WITHOUT_EXPLICIT_POWER_CORRELATION');
  else for(const branch of parsed){
   const modelPowerMatch=targets.every(t=>String(t.hp??'').trim()!==''&&Number(t.hp)===branch.powerHp&&mercedesPowerModelMatches(branch.model,t.effectiveVehicleText||t.vehicleText));
   if(!modelPowerMatch){branches.push({branch,status:'NOT_THIS_TARGET_POWER_OR_MODEL'});continue;}
   const effective={...source,engineCodesJson:anchor.exactCodes,engineCodeNormalized:anchor.exactCodes[0],powerHp:branch.powerHp,powerKw:null,yearFrom:Math.max(source.yearFrom,Number(branch.window.from.slice(0,4))),yearTo:Math.min(source.yearTo,Number(branch.window.to.slice(0,4)))};
   const windows=targets.map(t=>applicabilityWindow(effective,t)),window=windows[0];
   if(!window||windows.some(w=>sha(w)!==sha(window))){branches.push({branch,status:'MISSING_OR_DIFFERING_DATE_INTERSECTION'});continue;}
   const decision=match(effective,catalog),target=decision.targets.find(t=>t.vehicleVariantKey===f.vehicleVariantKey&&t.independentlyValidated);
   branches.push({branch,window,effectiveSourceHash:sha(effective),status:target?'EXPLICIT_BRANCH_MATCH_CONFIRMED':'BRANCH_MATCH_REQUIRES_REVIEW',decision,sourceEngineCode:anchor.exactCodes[0]});
  }
 }
 const supported=branches.some(b=>b.status==='EXPLICIT_BRANCH_MATCH_CONFIRMED');
 const remainingReasons=supported?prior.reasons.filter(r=>!['TARGET_POWER_NOT_EXACT','ENGINE_ANCHOR_POWER_REVIEW'].includes(r)):prior.reasons;
 findings.push({sourceRequirementId:source.id,vehicleVariantKey:f.vehicleVariantKey,systemCode:source.systemCode,sourceHash:sha(overlay.originalById.get(source.id)),anchors:f.matchingAnchors,branches,reasons,remainingReasons,status:supported?(remainingReasons.length?'BRANCH_SUPPORTED_OTHER_GATES_PENDING':'BRANCH_SUPPORTED_FOR_DRAFT_VERIFICATION'):'NO_SUPPORTED_BRANCH',publicationAllowed:false});
}
const summary={pairs:findings.length,statuses:Object.fromEntries([...Map.groupBy(findings,f=>f.status)].map(([k,v])=>[k,v.length])),reasonCounts:Object.fromEntries([...Map.groupBy(findings.flatMap(f=>f.reasons),x=>x)].map(([k,v])=>[k,v.length]))};
await writeFile(resolve(dir,'mercedes-power-branch-recheck-v1.json'),JSON.stringify({kind:'MERCEDES_LITERAL_POWER_MODEL_DATE_BRANCH_RECHECK',planHash:sha(planRaw),triageHash:sha(triageRaw),priorDraftHash:sha(draftRaw),helperHash:sha(await readFile(resolve(root,'scripts/lib/mann-mercedes-power-branches.mjs'),'utf8')),summary,findings,productionApplyAllowed:false,limitations:['Only fully parsed literal power/model/year branches; no inferred correlation between multiple engine codes and powers.','Exact target horsepower required; 249 vs 258 remains unsupported. Model qualifier preserved and checked explicitly.','Power branch support is not completed fluid-scope partition, OEM approval or production readiness. No canonical mutation.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
