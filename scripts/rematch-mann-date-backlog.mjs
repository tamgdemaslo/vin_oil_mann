import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy,applicabilityWindow,originalAssociationFingerprint,YEAR_BLOCKER} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';
import {parseLiteralEngineApplication} from './lib/mann-literal-engine-application.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const backlogRaw=await readFile(resolve(dir,'action-groups-current-plan-v2.json'),'utf8'),backlog=JSON.parse(backlogRaw);
const manifest=JSON.parse(await readFile(resolve(dir,'manifest.json'),'utf8'));
assert.equal(sha(await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8')),backlog.planHash);
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8'),raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(sha(sql),manifest.sourceHash);assert.equal(sha(mannRaw),manifest.mannHash);assert.equal(sha(raw),manifest.rawHash);
const identity=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,raw),fuel=await applyAuditedSourceFuel(root,power.requirements,raw);
const corrected=fuel.requirements.map(s=>({...s,engineCodeNormalized:fuel.fresh.get(s.id).engineCodeNormalized,engineCodesJson:fuel.fresh.get(s.id).engineCodesJson}));assert.equal(sha(corrected),manifest.correctedSourcesHash);
const sources=new Map(corrected.map(s=>[s.id,s])),variants=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
const rawRows=raw.trim().split('\n').map(JSON.parse),byRaw=new Map(rawRows.map(r=>[r.row_id,r])),tables=Map.groupBy(rawRows,r=>`${r.source_url}|${r.table_index}`);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const live=JSON.parse(await readFile(resolve(root,'outputs/mann-live-audit-1789415211923/revisions.json'),'utf8'));
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{normalizeEngineCode:norm}=await j.import('../src/lib/vehicle-normalization.ts'),{parseFluidCapacities:capacity}=await j.import('../src/lib/fluid-capacity-parser.ts');

const preRaw=await readFile(resolve(dir,'date-backlog-preflight-v1.json'),'utf8'),pre=JSON.parse(preRaw);assert.equal(pre.planHash,backlog.planHash);assert.equal(pre.correctedSourcesHash,sha(corrected));
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
const catalog=parseCopy(mannRaw,'mann_filter_applications');
const expected=pre.findings.flatMap(f=>f.pairs.filter(p=>p.status==='DATE_SCOPED_REMATCH_REQUIRED').map(p=>({f,p})));assert.equal(expected.length,351);
const runtimeFiles=['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-row-generation-evidence.ts','src/lib/fluid-catalog.ts','src/lib/mann-catalog.ts'];
const codeHashes=Object.fromEntries(await Promise.all(runtimeFiles.map(async path=>[path,sha(await readFile(resolve(root,path),'utf8'))])));
const inputHash=sha({preflightHash:sha(preRaw),planHash:backlog.planHash,codeHashes}),findings=[];
for(const [make,group] of Map.groupBy(expected,e=>e.f.make)){
 const path=resolve(dir,'date-rematch-'+sha(make).slice(0,16)+'-v1.json');
 try{
  const saved=JSON.parse(await readFile(path,'utf8'));assert.equal(saved.inputHash,inputHash);assert.equal(saved.findings.length,group.length);findings.push(...saved.findings);continue;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const forms=new Set(mannMakeFormsForTest(make)),makeRows=catalog.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))),done=[];
 for(const {f,p} of group){
  const source=sources.get(f.sourceRequirementId);assert.equal(sha(source),f.sourceHash);
  const narrowed={...source,...p.window.narrowedYears};assert.ok(narrowed.yearFrom>=source.yearFrom&&narrowed.yearTo<=source.yearTo);
  assert.equal(normalizeFluidRequirementVehicle(narrowed).canonicalMake,make);
  const decision=match(narrowed,makeRows),target=decision.targets.find(t=>t.vehicleVariantKey===p.vehicleVariantKey&&t.independentlyValidated);
  done.push({sourceRequirementId:source.id,sourceHash:f.sourceHash,originalSourceHash:f.originalSourceHash,vehicleVariantKey:p.vehicleVariantKey,originalAssociationFingerprint:p.originalAssociationFingerprint,narrowedSourceHash:sha(narrowed),window:p.window,decision,targetValidated:!!target,technicalReviewRequired:true,publicationAllowed:false});
  if(done.length%20===0)console.log(JSON.stringify({make,done:done.length,total:group.length,previous:findings.length}));
 }
 await writeFile(path,JSON.stringify({inputHash,make,findings:done,productionApplyAllowed:false},null,2)+'\n',{flag:'wx'});findings.push(...done);
 console.log(JSON.stringify({make,completed:findings.length,total:351}));
}
assert.equal(findings.length,351);
const summary={pairs:findings.length,independentlyValidated:findings.filter(f=>f.targetValidated).length,statuses:Object.fromEntries([...Map.groupBy(findings,f=>f.decision.status)].map(([status,rows])=>[status,rows.length]))};
await writeFile(resolve(dir,'date-backlog-rematch-summary-v1.json'),JSON.stringify({inputHash,preflightHash:sha(preRaw),planHash:backlog.planHash,codeHashes,summary,productionApplyAllowed:false,limitations:['Year-narrowed matcher replay only; original source engine arrays/power/fuel retained.','Exact month, own fluid conditions, predecessor and source-specification review remain; no draft publication.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
