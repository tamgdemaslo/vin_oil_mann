import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),mode=process.argv[2];assert.ok(['baseline','verify'].includes(mode));
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8'),raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8'),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');assert.equal(sha(planRaw),'6b436120dd91f8b1ca909fe1fc51556cdb1906b946c2cccc895e9cc03a18e032');
const identity=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,raw),fuel=await applyAuditedSourceFuel(root,power.requirements,raw);
const sources=fuel.requirements.filter(r=>r.sourceUrl==='https://podbormasla.ru/volvo/v50/1gen/').map(r=>({...r,engineCodeNormalized:fuel.fresh.get(r.id).engineCodeNormalized,engineCodesJson:fuel.fresh.get(r.id).engineCodesJson}));assert.ok(sources.length);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannRowGenerationEvidence:gen}=await j.import('../src/lib/mann-row-generation-evidence.ts'),{evaluateMannCandidate}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const all=parseCopy(mannRaw,'mann_filter_applications'),catalog=all.filter(r=>r.make==='VOLVO CARS');assert.equal(catalog.length,1362);
const helperHash=sha(await readFile(resolve(root,'src/lib/mann-row-generation-evidence.ts'),'utf8'));
const findings=sources.map(s=>({sourceRequirementId:s.id,sourceHash:sha(s),systemCode:s.systemCode,decision:JSON.parse(JSON.stringify(match(s,catalog)))}));
const generations=all.map(r=>({id:r.id,generation:gen(r)??null}));
if(mode==='baseline'){
 assert.equal(helperHash,'3ee5da1294cfc8ef9407cf5b7522b8da90aa3a50bb8218d52ad5d43d8b6ec885');
 await writeFile(resolve(dir,'v50-generation-baseline-v1.json'),JSON.stringify({planHash:sha(planRaw),mannHash:sha(mannRaw),rawHash:sha(raw),helperHash,generations,findings},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({sources:sources.length,catalog:all.length}));
}else{
 const baselineRaw=await readFile(resolve(dir,'v50-generation-baseline-v1.json'),'utf8'),baseline=JSON.parse(baselineRaw);assert.equal(baseline.planHash,sha(planRaw));assert.equal(baseline.mannHash,sha(mannRaw));assert.equal(baseline.rawHash,sha(raw));
 const changed=[];let negatives=0;
 for(let i=0;i<all.length;i++){
  const before=baseline.generations[i],after=generations[i],r=all[i];assert.equal(before.id,r.id);
  if(before.generation===after.generation)continue;
  assert.equal(r.make,'VOLVO CARS');assert.equal(r.model,'V50');assert.equal(r.modelYears,'04-12');assert.equal(before.generation,null);assert.equal(after.generation,'I');changed.push(r);
  for(const bad of [{...r,make:'FORD'},{...r,model:'V50 II'},{...r,model:'S40'},{...r,modelYears:'12 ->'},{...r,modelYears:null},{...r,vehicleYears:'01/13-12/14'},{...r,vehicleYears:'12/12-01/04'},{...r,vehicleYears:'01/02-12/12'},{...r,vehicleYears:'unknown'}]){assert.equal(gen(bad),undefined);negatives++;}
 }
 assert.equal(changed.length,59);
 const results=findings.map(f=>{
  const old=baseline.findings.find(x=>x.sourceRequirementId===f.sourceRequirementId);assert.ok(old);assert.equal(old.sourceHash,f.sourceHash);
  const valid=d=>d.targets.filter(t=>t.independentlyValidated).map(t=>t.vehicleVariantKey),before=valid(old.decision),after=valid(f.decision);
  if(f.decision.normalizedVehicle)for(const r of changed){const evaluation=evaluateMannCandidate({...f.decision.normalizedVehicle,generation:'II'},r);assert.ok(evaluation.rejected || evaluation.candidate?.mismatchedFields.includes('поколение'));negatives++;}
  return {...f,oldDecision:old.decision,added:after.filter(k=>!before.includes(k)),removed:before.filter(k=>!after.includes(k)),publicationAllowed:false};
 });
 const summary={sourceRequirements:findings.length,allCatalogRows:all.length,changedGenerationRows:59,variants:new Set(changed.map(r=>r.vehicleVariantKey)).size,negativeChecks:negatives,addedValidatedTargets:results.reduce((n,r)=>n+r.added.length,0),removedValidatedTargets:results.reduce((n,r)=>n+r.removed.length,0),statuses:Object.fromEntries([...Map.groupBy(results,f=>`${f.oldDecision.status} -> ${f.decision.status}`)].map(([k,v])=>[k,v.length]))};
 await writeFile(resolve(dir,'v50-generation-runtime-v1.json'),JSON.stringify({kind:'V50_BOUNDED_GENERATION_EVIDENCE_REPLAY',baselineHash:sha(baselineRaw),helperHash,planHash:sha(planRaw),evidence:{volvoUrl:'https://www.volvocars.com/intl/media/press-releases/9DDB78D308D773EB/',mannUrl:'https://www.mann-filter.com/au-en/catalog/search-results/product.suffix.html/c16134/2_mann-filter.html',interpretation:'V50 04-12 is mapped to local generation I for the Volvo V50 2003-2012 model line; this is bounded catalogue identity inference, not an engine or fluid correction.'},summary,changedRows:changed,findings:results,productionApplyAllowed:false,limitations:['No dates, engine codes, market, gearbox or technical-fluid fields changed.','Generation proof does not resolve suspicious source power/fuel or MANN engine spelling.','No canonical draft additions or production publication in this step.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
}
