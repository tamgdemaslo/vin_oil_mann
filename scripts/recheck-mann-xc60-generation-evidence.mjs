import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8'),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
assert.equal(sha(sourceRaw),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
assert.equal(sha(planRaw),'3a3a0c2a6877dc4917c510713ff23ef7ab9a8d8ddd12abe4838622229b712e42');
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const sources=overlay.requirements.filter(s=>s.sourceUrl==='https://podbormasla.ru/volvo/xc60/1gen/');assert.equal(sources.length,71);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest,evaluateMannCandidate}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
const forms=new Set(mannMakeFormsForTest('volvo'));
const rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
// Literal current manufacturer catalogue rows, not a default "bare model = I" rule.
// Online engine typography is normalized solely for equality with archive spelling.
const evidence={checkedDate:'2026-09-14',volvoUrl:'https://www.volvocars.com/us/media/models/xc60gen1/2006/',mannUrl:'https://www.mann-filter.com/uk-en/catalogue/search-results/product.html/hu8014z_mann-filter.html',generation:'I',volvoYears:[2008,2017],mannHeading:'XC60',separateSecondGenerationHeading:'XC60 II',applications:[
 {engineCode:'D4204T4',hp:150,kw:110,vehicleYears:'03/15-04/17'},
 {engineCode:'D4204T14',hp:190,kw:140,vehicleYears:'03/15-02/17'},
 {engineCode:'D4204T5',hp:181,kw:133,vehicleYears:'11/13-12/15'},
 {engineCode:'B4204T11',hp:245,kw:180,vehicleYears:'11/13-02/17'},
 {engineCode:'B4204T9',hp:306,kw:225,vehicleYears:'11/13-12/17'},
],limitations:['Generation link is an inference from Volvo heritage and separately named MANN catalogue models with matching application dates.','MANN filter applications do not verify fluid specifications, volume, service intervals or installed equipment.','Only five literal online engine/power/date combinations are evidence-backed in this proposal.']};
const norm=s=>String(s??'').replace(/\s+/g,'').toUpperCase();
const proposed=rows.filter(r=>r.model==='XC60'&&evidence.applications.some(e=>norm(r.engineCode)===e.engineCode&&Number(r.hp)===e.hp&&Number(r.kw)===e.kw&&r.vehicleYears===e.vehicleYears));
assert.ok(proposed.length);const ids=new Set(proposed.map(r=>r.id));
const afterRows=rows.map(r=>ids.has(r.id)?{...r,model:'XC60 I',modelNormalized:'XC60 I'}:r);
for(let i=0;i<rows.length;i++)assert.deepEqual({...afterRows[i],model:rows[i].model,modelNormalized:rows[i].modelNormalized},rows[i]);
const findings=[];let negativeChecks=0;
for(const source of sources){
 const oldDecision=match(source,rows),newDecision=match(source,afterRows);
 const valid=d=>d.targets.filter(t=>t.independentlyValidated).map(t=>t.vehicleVariantKey),oldIds=valid(oldDecision),newIds=valid(newDecision);
 findings.push({sourceRequirementId:source.id,originalSourceHash:sha(overlay.originalById.get(source.id)),effectiveSourceHash:sha(source),systemCode:source.systemCode,oldDecision,newDecision,addedValidatedTargets:newIds.filter(id=>!oldIds.includes(id)),removedValidatedTargets:oldIds.filter(id=>!newIds.includes(id)),publicationAllowed:false});
 if(newDecision.normalizedVehicle)for(const row of afterRows.filter(r=>ids.has(r.id))){
  const wrong=evaluateMannCandidate({...newDecision.normalizedVehicle,generation:'II'},row).candidate;
  assert.ok(wrong.mismatchedFields.includes('поколение'));negativeChecks++;
 }
}
const plan=JSON.parse(planRaw),bySource=new Map(plan.newRevisions.map(r=>[r.sourceRequirementId,true]));
const summary={sourceRows:findings.length,catalogRows:rows.length,proposedIdentityRows:proposed.length,proposedVariants:new Set(proposed.map(r=>r.vehicleVariantKey)).size,changedDecisions:findings.filter(f=>sha(f.oldDecision)!==sha(f.newDecision)).length,sourcesWithAddedValidatedTargets:findings.filter(f=>f.addedValidatedTargets.length).length,sourcesWithRemovedValidatedTargets:findings.filter(f=>f.removedValidatedTargets.length).length,sourcesAlreadyInPlan:findings.filter(f=>bySource.has(f.sourceRequirementId)).length,wrongGenerationNegativeChecks:negativeChecks,statusTransitions:Object.fromEntries([...Map.groupBy(findings,f=>`${f.oldDecision.status} -> ${f.newDecision.status}`)].map(([k,v])=>[k,v.length]))};
assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),sha(planRaw));
const codeFiles=['src/lib/mann-vehicle-resolver.ts','src/lib/mann-fluid-matcher-v2.ts','src/lib/fluid-catalog.ts','scripts/recheck-mann-xc60-generation-evidence.mjs'];
const codeHashes=Object.fromEntries(await Promise.all(codeFiles.map(async p=>[p,sha(await readFile(resolve(root,p),'utf8'))])));
await writeFile(resolve(dir,'xc60-generation-evidence-probe-v1.json'),JSON.stringify({kind:'XC60_EXACT_GENERATION_EVIDENCE_PROBE',planHash:sha(planRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),codeHashes,evidence,summary,proposedRows:proposed.map(r=>({original:r,originalHash:sha(r),proposal:{...r,model:'XC60 I',modelNormalized:'XC60 I'}})),findings,productionApplyAllowed:false,limitations:['Offline counterfactual model-label probe only. Runtime and canonical plan unchanged.','Mixed rows within a variant can remain ambiguous; no unspecified-engine rows were given inferred codes.','Matcher validation is not safe fluid publication: source engine/power/date branches, denylist and predecessors still require checks.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
