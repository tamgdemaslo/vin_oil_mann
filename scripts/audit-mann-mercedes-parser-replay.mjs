import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
assert.ok(['--legacy','--current'].includes(process.argv[2]));assert.equal(process.argv.length,3);
const legacy=process.argv[2]==='--legacy';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-compressed-preview-2026-09-14');
const alias={'@/lib/mann-engine-code-list':resolve(root,legacy?'scripts/lib/mann-legacy-engine-code-list.mjs':'src/lib/mann-engine-code-list.ts'),'@':resolve(root,'src')};
const jiti=createJiti(import.meta.url,{alias});
const {normalizeDecodedVehicleForTest:normalize,evaluateMannCandidate:evaluate,mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const probe=normalize({makeRaw:'Mercedes-Benz',modelRaw:'C-Class',bodyCode:'W203',engineCode:'M112.953',sourceMethods:['tronk_vindecode'],confidence:'high',rawResultIds:[],vinStatus:'valid'});
const probeResult=evaluate(probe,{vehicleVariantKey:'probe',make:'MERCEDES-BENZ',makeNormalized:'MERCEDES-BENZ',model:'C-Class (W203)',vehicleText:'C320',engineCode:'M112.946/953'});
assert.equal(probeResult.candidate.matchedFields.includes('точный код двигателя'),!legacy,'Counterfactual parser must actually be wired into resolver');
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=overlay.requirements.filter(r=>r.make==='mercedes');assert.equal(sources.length,523);
const forms=new Set(mannMakeFormsForTest('MERCEDES'));
const rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
const results=[];
for(const source of sources){
 const decision=match(source,rows);
 results.push({sourceRequirementId:source.id,sourceHash:sha(source),systemCode:source.systemCode,status:decision.status,
   confirmedTargets:decision.targets.filter(t=>t.independentlyValidated).map(t=>t.vehicleVariantKey).sort(),
   reviewReasons:decision.reviewReasons,topCandidates:decision.topCandidates.slice(0,3)});
 if(results.length%100===0)console.log(JSON.stringify({mode:legacy?'legacy':'current',processed:results.length,total:sources.length}));
}
const report={mode:legacy?'legacy':'current',sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),
 matcherHash:sha(await readFile(resolve(root,'src/lib/mann-fluid-matcher-v2.ts'),'utf8')),
 resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),
 parserHash:sha(await readFile(alias['@/lib/mann-engine-code-list'],'utf8')),
 results,productionApplyAllowed:false,limitation:'All523 original Mercedes sources with identity overlay, full-make ranking; no source-engine recovery/date clipping/equipment branch overlays. Legacy tokenizer injected in separate process and verified by resolver probe. This isolates parser effect, not OEM correctness.'};
await writeFile(resolve(dir,`mercedes-parser-${report.mode}-replay-v1.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({mode:report.mode,processed:results.length,statuses:Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length]))}));
