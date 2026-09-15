import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const version=process.argv[2]??'v1';assert.ok(['v1','v2','v3','v4','v5','v6'].includes(version));const psa=['v4','v5','v6'].includes(version);
const preRaw=await readFile(resolve(dir,psa?'vin-priority-fluid-preflight-v4.json':'vin-priority-fluid-preflight-v1.json'),'utf8'),pre=JSON.parse(preRaw),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),pre.planHash);
const prior=psa?JSON.parse(await readFile(resolve(dir,'vin-priority-fluid-preflight-v3.json'),'utf8')):null;
const oldReady=new Set((prior?.findings??[]).filter(f=>!f.reasons.length).map(f=>`${f.sourceRequirementId}|${f.vehicleVariantKey}`));
const manifest=JSON.parse(await readFile(resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2/manifest.json'),'utf8'));
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8'),raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(sql),manifest.sourceHash);assert.equal(sha(mannRaw),manifest.mannHash);assert.equal(sha(raw),manifest.rawHash);
const identity=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,raw),fuel=await applyAuditedSourceFuel(root,power.requirements,raw);
const corrected=fuel.requirements.map(s=>({...s,engineCodeNormalized:fuel.fresh.get(s.id).engineCodeNormalized,engineCodesJson:fuel.fresh.get(s.id).engineCodesJson}));assert.equal(sha(corrected),pre.correctedSourcesHash);
const sources=new Map(corrected.map(s=>[s.id,s])),catalog=parseCopy(mannRaw,'mann_filter_applications');
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
const {normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts');
const findings=[];
for(const f of pre.findings.filter(f=>!f.reasons.length&&!oldReady.has(`${f.sourceRequirementId}|${f.vehicleVariantKey}`))){
  const source=sources.get(f.sourceRequirementId);assert.equal(sha(source),f.effectiveSourceHash);
  const scope=structuredClone(f.scope),from=Number(scope.window.intersection.from.slice(0,4)),to=Number(scope.window.intersection.to.slice(0,4));
  assert.ok(from>=source.yearFrom&&to<=source.yearTo);scope.window.narrowedYears={yearFrom:from,yearTo:to};
  scope.window.restricted=scope.window.restricted||scope.window.intersection.from!==scope.window.source.from||scope.window.intersection.to!==scope.window.source.to;
  const reasons=[];
  if(!(source.engineCodesJson??[]).map(norm).includes(scope.matchedEngineScope[0]))reasons.push('LITERAL_ENGINE_NOT_IN_EFFECTIVE_SOURCE');
  if(source.powerHp!=null&&!f.branch.powerHp.includes(source.powerHp))reasons.push('EFFECTIVE_SOURCE_POWER_CONFLICT');
  if(f.branch.powerHp.length!==1)reasons.push('BRANCH_HAS_MULTIPLE_POWER_ALTERNATIVES');
  if(reasons.length){findings.push({...f,scope,targetValidated:false,rematchReasons:reasons,decision:null});continue;}
  const narrowed={...source,yearFrom:from,yearTo:to,engineCodesJson:scope.matchedEngineScope,engineCodeNormalized:scope.matchedEngineScope[0]};
  // Use literal branch power only when absent; never discard a contradictory
  // imported power measurement. No body/model/fuel evidence is rewritten.
  if(narrowed.powerHp==null)narrowed.powerHp=f.branch.powerHp[0];
  const forms=new Set(mannMakeFormsForTest(scope.sourceVehicleScope.make)),makeRows=catalog.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
  assert.ok(makeRows.length);
  const decision=match(narrowed,makeRows),target=decision.targets.find(t=>t.vehicleVariantKey===f.vehicleVariantKey&&t.independentlyValidated);
  findings.push({...f,scope,narrowedSourceHash:sha(narrowed),targetValidated:!!target,rematchReasons:target?[]:decision.reviewReasons,decision,target:target??null});
}
assert.equal(findings.length,psa?1:18);
const files=['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-reviewed-model-scope.ts','data/mann-partner-tepee-model-evidence-v1.json','src/lib/mann-vehicle-resolver.ts','src/lib/vehicle-normalization.ts','src/lib/mann-confirmable-engine-codes.ts','src/lib/mann-row-generation-evidence.ts','src/lib/fluid-catalog.ts','src/lib/mann-catalog.ts'];
const summary={pairs:findings.length,validated:findings.filter(f=>f.targetValidated).length,statuses:Object.fromEntries([...Map.groupBy(findings,f=>f.decision?.status??'SOURCE_HOLD')].map(([s,rows])=>[s,rows.length]))};
await writeFile(resolve(dir,`vin-priority-scoped-rematch-${version}.json`),JSON.stringify({kind:psa?'NEW_PSA_LITERAL_SCOPED_FULL_MAKE_REMATCH':'ALL18_LITERAL_SCOPED_FULL_MAKE_REMATCH',planHash:pre.planHash,preflightHash:sha(preRaw),codeHashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),summary,findings,productionApplyAllowed:false,
 limitations:['Scoped source alternatives proved by literal engine table; all original model/body/fuel and nonmissing power retained.','Full-make independent matching; date month/market/drive restrictions remain mandatory at display.','Still requires fluid/predecessor joint display proof before draft merge, not OEM verification or publication.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
