import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {applyIdentityCorrections} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const transitionRaw=await readFile(resolve(dir,'mercedes-import-parser-transition-v1.json'),'utf8');assert.equal(sha(transitionRaw),'84090fd6c9072abced2f53664a7b26f61bb15614d30152cf6be48366b4a47e07');const transition=JSON.parse(transitionRaw);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sourceRaw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),transition.rawHash);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),'33fcc0c9b7396f57fca01ae9e062eb5faecf1e7b37a56f15a6fa4d9ec0a68596');const plan=JSON.parse(planRaw);
const overlayRaw=await readFile(resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'utf8');assert.equal(sha(overlayRaw),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const overlay=applyIdentityCorrections(parseCopy(sourceRaw,'vehicle_fluid_requirements'),JSON.parse(overlayRaw),sha(sourceRaw));
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{prepareFluidCatalog}=await j.import('../src/lib/fluid-catalog.ts'),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
assert.equal(sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8')),transition.afterParserHash);
const prepared=prepareFluidCatalog({rowsNdjson:raw,mannFiltersCsv:''}),fresh=new Map(prepared.requirements.map(r=>[r.id,r]));
assert.equal(fresh.size,sources.size);
for(const s of sources.values()){const p=fresh.get(s.id);assert.ok(p);assert.equal(s.generation,p.generation);assert.deepEqual(s.bodyCodesJson,p.bodyCodesJson);assert.deepEqual(s.rawRequirementJson?.sourceIdentity,p.rawRequirementJson?.sourceIdentity);}
const forms=new Set(mannMakeFormsForTest('MERCEDES')),catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));assert.ok(catalog.length);
const findings=[];
for(const difference of transition.differences){
 const before=sources.get(difference.id),p=fresh.get(difference.id);assert.ok(before&&p);assert.equal(before.sourceRowId,difference.sourceRowId);assert.deepEqual(p.engineCodesJson,difference.after);
 const after={...before,engineCodesJson:p.engineCodesJson,engineCodeNormalized:p.engineCodeNormalized};
 const oldDecision=match(before,catalog),newDecision=match(after,catalog);
 const valid=d=>d.targets.filter(t=>t.independentlyValidated).map(t=>t.vehicleVariantKey);
 const oldValid=valid(oldDecision),newValid=valid(newDecision),existing=plan.newRevisions.filter(r=>r.sourceRequirementId===before.id);
 findings.push({sourceRequirementId:before.id,systemCode:before.systemCode,beforeEngineCodes:before.engineCodesJson,afterEngineCodes:after.engineCodesJson,oldDecision,newDecision,addedValidatedTargets:newValid.filter(id=>!oldValid.includes(id)),removedValidatedTargets:oldValid.filter(id=>!newValid.includes(id)),canonicalTargets:existing.map(r=>({revisionId:r.id,vehicleVariantKey:r.vehicleVariantKey,held:!!r.provenanceJson.sourcePowerReviewHold,engineScope:r.applicabilityJson.matchedEngineScope,newlyValidated:newValid.includes(r.vehicleVariantKey)})),publicationAllowed:false});
 if(findings.length%100===0)console.log(JSON.stringify({checked:findings.length,total:transition.differences.length}));
}
const summary={sources:findings.length,catalogRows:catalog.length,statusChanged:findings.filter(f=>f.oldDecision.status!==f.newDecision.status).length,withAddedValidatedTargets:findings.filter(f=>f.addedValidatedTargets.length).length,withRemovedValidatedTargets:findings.filter(f=>f.removedValidatedTargets.length).length,withCanonicalDrafts:findings.filter(f=>f.canonicalTargets.length).length,statuses:Object.fromEntries([...Map.groupBy(findings,f=>`${f.oldDecision.status} -> ${f.newDecision.status}`)].map(([k,v])=>[k,v.length]))};
const report={kind:'MERCEDES_IMPORT_ENGINE_PAIRED_MATCHER_REPLAY',planHash:sha(planRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),transitionHash:sha(transitionRaw),identityOverlayHash:sha(overlayRaw),parserHash:transition.afterParserHash,matcherHash:sha(await readFile(resolve(root,'src/lib/mann-fluid-matcher-v2.ts'),'utf8')),summary,findings,productionApplyAllowed:false,limitations:['Full Mercedes catalog paired matcher; only engine fields changed on original SQL sources with independently replayed generation/body overlay.','Source dates/power/capacity retained, no canonical per-branch repairs applied to whole-source replay.','Validated matcher target is not OEM fluid verification, denylist clearance, approval or import authorization.','Canonical targets not newly validated can reflect existing narrower source repairs; do not remove them automatically.']};
await writeFile(resolve(dir,'mercedes-import-matcher-replay-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
