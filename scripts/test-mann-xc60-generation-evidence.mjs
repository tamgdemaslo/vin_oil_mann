import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {mannRowGenerationEvidence:lookup}=await j.import('../src/lib/mann-row-generation-evidence.ts');
const {matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {evaluateMannCandidate,mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
const probeRaw=await readFile(resolve(dir,'xc60-generation-evidence-probe-v1.json'),'utf8'),probe=JSON.parse(probeRaw);
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8'),sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
assert.equal(sha(mannRaw),probe.mannHash);assert.equal(sha(sourceRaw),probe.sourceHash);
const all=parseCopy(mannRaw,'mann_filter_applications'),proposedIds=new Set(probe.proposedRows.map(p=>p.original.id));
for(const r of all)assert.equal(lookup(r),proposedIds.has(r.id)?'I':undefined);
let negativeMutations=0;
for(const {original} of probe.proposedRows){
 for(const [key,value] of Object.entries({make:'VOLVO (USA)',model:'XC60 II',modelYears:'17 ->',engineCode:null,kw:'999',hp:'999',vehicleYears:'06/17 ->'})){
  assert.equal(lookup({...original,[key]:value}),undefined);negativeMutations++;
 }
 assert.equal(lookup({...original,engineCode:original.engineCode.toLowerCase().split('').join(' ')}),'I');
}
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const sources=new Map(overlay.requirements.map(s=>[s.id,s])),forms=new Set(mannMakeFormsForTest('volvo')),rows=all.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
const findings=[];let wrongGenerationCases=0,tiedBoundaryAlternatives=0;
const candidate=c=>({...c,rank:undefined,model:c.model==='XC60 I'?'XC60':c.model});
for(const prior of probe.findings){
 const source=sources.get(prior.sourceRequirementId);assert.equal(sha(source),prior.effectiveSourceHash);
 const decision=match(source,rows);
 assert.equal(decision.status,prior.newDecision.status);assert.deepEqual(decision.targets,prior.newDecision.targets);
 // The probe changed display labels, whereas runtime preserves them. That can
 // reorder equally scored alternatives at the top-N boundary, not their facts.
 const oldByIds=new Map(prior.newDecision.topCandidates.map(c=>[sha(c.variantIds),c]));
 const newByIds=new Map(decision.topCandidates.map(c=>[sha(c.variantIds),c]));
 for(const c of decision.topCandidates){
  const old=oldByIds.get(sha(c.variantIds));
  if(old)assert.deepEqual(candidate(c),candidate(old));
  else{assert.equal(c.score,prior.newDecision.topCandidates.at(-1).score);tiedBoundaryAlternatives++;}
 }
 for(const c of prior.newDecision.topCandidates)if(!newByIds.has(sha(c.variantIds)))assert.equal(c.score,decision.topCandidates.at(-1).score);
 for(const row of rows.filter(r=>proposedIds.has(r.id))){
  const wrong=evaluateMannCandidate({...decision.normalizedVehicle,generation:'II'},row).candidate;
  assert.ok(wrong.mismatchedFields.includes('поколение'));wrongGenerationCases++;
 }
 findings.push({sourceRequirementId:source.id,status:decision.status,targets:decision.targets,publicationAllowed:false});
}
assert.equal(sha(await readFile(resolve(dir,'plan.json'),'utf8')),probe.planHash);
const summary={archiveRowsChecked:all.length,rowsReceivingGeneration:proposedIds.size,otherRowsWithoutNewEvidence:all.length-proposedIds.size,negativeMutations,pairedSourceDecisions:findings.length,wrongGenerationCases,tiedBoundaryAlternatives,canonicalPlanUnchanged:true};
await writeFile(resolve(dir,'xc60-generation-runtime-verification-v1.json'),JSON.stringify({kind:'XC60_GENERATION_RUNTIME_VERIFICATION',probeHash:sha(probeRaw),planHash:probe.planHash,sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),summary,findings,productionApplyAllowed:false,limitations:['All archive rows screened for rule applicability; full matcher replay limited to 71 XC60 sources.','No fluid draft inserted or production deployment performed. Source branch and technical gates remain.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
