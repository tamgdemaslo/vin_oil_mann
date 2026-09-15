import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const scopeRaw=await readFile(resolve(dir,'unplanned-literal-branch-scopes-v2.json'),'utf8'),scopes=JSON.parse(scopeRaw),manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8'),raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(sql),manifest.sourceHash);assert.equal(sha(mannRaw),scopes.mannHash);assert.equal(sha(raw),manifest.rawHash);
assert.equal(sha(await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8')),manifest.planHash);
const identity=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,raw),fuel=await applyAuditedSourceFuel(root,power.requirements,raw);
const corrected=fuel.requirements.map(s=>({...s,engineCodeNormalized:fuel.fresh.get(s.id).engineCodeNormalized,engineCodesJson:fuel.fresh.get(s.id).engineCodesJson}));assert.equal(sha(corrected),manifest.correctedSourcesHash);
const bySource=new Map(corrected.map(s=>[s.id,s])),byRaw=new Map(raw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const catalog=parseCopy(mannRaw,'mann_filter_applications'),variants=Map.groupBy(catalog,r=>r.vehicleVariantKey);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle}=await j.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await j.import('../src/lib/mann-catalog.ts'),{mannTechnicalScopeMatches:scopeMatches}=await j.import('../src/lib/mann-technical-applicability.ts');
const findings=[],makeCache=new Map();let negativeMarketChecks=0;
for(const candidate of scopes.results.filter(r=>r.status==='BRANCH_SCOPED_REMATCH_REQUIRED')){
 const source=bySource.get(candidate.sourceRequirementId);assert.equal(sha(identity.originalById.get(source.id)),candidate.originalSourceHash);assert.equal(sha(byRaw.get(candidate.branch.anchorRowId)),candidate.branch.anchorHash);
 const powers=[...new Set(variants.get(candidate.vehicleVariantKey).map(r=>Number(r.hp)))];
 const reasons=[...candidate.remainingTechnicalOrPredecessorReasons];
 if(powers.length!==1||!candidate.branch.powerHp.includes(powers[0])){findings.push({...candidate,decision:null,reasons:[...reasons,'AMBIGUOUS_TARGET_BRANCH_POWER'],publicationAllowed:false});continue;}
 const w=candidate.proposedScope.window.intersection;
 const narrowed={...source,engineCodeNormalized:candidate.proposedScope.matchedEngineScope[0],engineCodesJson:candidate.proposedScope.matchedEngineScope,powerHp:powers[0],yearFrom:Number(w.from.slice(0,4)),yearTo:Number(w.to.slice(0,4))};
 assert.ok(narrowed.yearFrom>=source.yearFrom&&narrowed.yearTo<=source.yearTo);
 const make=normalizeFluidRequirementVehicle(narrowed).canonicalMake;
 if(!makeCache.has(make)){const forms=new Set(mannMakeFormsForTest(make));makeCache.set(make,catalog.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
 const decision=match(narrowed,makeCache.get(make)),target=decision.targets.find(t=>t.vehicleVariantKey===candidate.vehicleVariantKey&&t.independentlyValidated);
 if(!target)reasons.push('SCOPED_TARGET_NOT_CONFIRMED');
 if(candidate.proposedScope.requiredMarket){
  const context={engineCode:narrowed.engineCodeNormalized,productionMonth:w.from,confirmedMarket:candidate.proposedScope.requiredMarket};
  assert.ok(scopeMatches(candidate.proposedScope,context));
  for(const market of [undefined,'UNKNOWN',...['RU','JP','US','KR','EU','AE','SOUTHEAST_ASIA'].filter(m=>m!==context.confirmedMarket)]){assert.equal(scopeMatches(candidate.proposedScope,{...context,confirmedMarket:market}),false);negativeMarketChecks++;}
 }
 findings.push({...candidate,narrowedSourceHash:sha(narrowed),narrowedFields:{engineCodes:narrowed.engineCodesJson,powerHp:narrowed.powerHp,powerKw:narrowed.powerKw,yearFrom:narrowed.yearFrom,yearTo:narrowed.yearTo},decision,targetValidated:!!target,reasons:[...new Set(reasons)],publicationAllowed:false});
 if(findings.length%10===0)console.log(JSON.stringify({rematched:findings.length,total:39}));
}
assert.equal(findings.length,39);
const summary={branchCases:findings.length,targetValidated:findings.filter(f=>f.targetValidated).length,clearAfterRematch:findings.filter(f=>!f.reasons.length).length,negativeMarketChecks,statuses:Object.fromEntries([...Map.groupBy(findings,f=>f.decision?.status??'NOT_RUN')].map(([k,v])=>[k,v.length]))};
const codePaths=['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-technical-applicability.ts'];
const codeHashes=Object.fromEntries(await Promise.all(codePaths.map(async p=>[p,sha(await readFile(resolve(root,p),'utf8'))])));
await writeFile(resolve(dir,'unplanned-literal-branch-rematch-v1.json'),JSON.stringify({kind:'ALL39_LITERAL_BRANCH_REMATCH',scopeHash:sha(scopeRaw),manifestHash:sha(manifest),codeHashes,summary,findings,productionApplyAllowed:false,limitations:['Original source records unchanged; scope narrowing affects only matcher input.','Exact month and market restrictions remain in proposed runtime scope; year-only matching does not remove them.','Technical/source-row market/denied/protected/predecessor obligations are not cleared by a successful match.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
