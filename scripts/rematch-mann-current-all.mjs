import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
import {applyAuditedSourceFuel} from './lib/mann-source-fuel-overlay.mjs';

// Read-only, resumable full-catalog replay. Matching is not publication approval.
const root=resolve(import.meta.dirname,'..');
const out=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
const planRaw=await readFile(resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14/plan.json'),'utf8');
assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const identity=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,identity.requirements,raw);
const fuel=await applyAuditedSourceFuel(root,power.requirements,raw);
const sources=fuel.requirements.map(s=>({...s,engineCodeNormalized:fuel.fresh.get(s.id).engineCodeNormalized,engineCodesJson:fuel.fresh.get(s.id).engineCodesJson}));
const catalog=parseCopy(mannRaw,'mann_filter_applications');
assert.equal(sources.length,13296);assert.equal(catalog.length,37600);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle}=await j.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
const runtimePaths=['src/lib/mann-fluid-matcher-v2.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-row-generation-evidence.ts','src/lib/fluid-catalog.ts','src/lib/mann-catalog.ts'];
const runtimeHashes=Object.fromEntries(await Promise.all(runtimePaths.map(async p=>[p,sha(await readFile(resolve(root,p),'utf8'))])));
const manifest={sourceHash:sha(sql),mannHash:sha(mannRaw),rawHash:sha(raw),planHash:sha(planRaw),correctedSourcesHash:sha(sources),runtimeHashes,scriptHash:sha(await readFile(import.meta.filename,'utf8')),productionApplyAllowed:false};
await mkdir(out,{recursive:true});
async function immutable(path,value){
 const text=JSON.stringify(value,null,2)+'\n';
 try{await writeFile(path,text,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(await readFile(path,'utf8'),text,`Existing artifact differs: ${path}`);}
}
await immutable(resolve(out,'manifest.json'),manifest);
const manifestHash=sha(manifest),plan=JSON.parse(planRaw);
const canonical=Map.groupBy(plan.newRevisions,r=>r.sourceRequirementId);
const oldRaw=await readFile(resolve(root,'outputs/mann-identity-scoped-2026-09-14/decisions.ndjson'),'utf8');
const old=new Map(oldRaw.trim().split('\n').map(l=>{const d=JSON.parse(l);return[d.requirementId,d];}));
assert.equal(old.size,sources.length);
const counts={},reasons={},transitions={},systems={},findings=[];
let processed=0;
const groups=Map.groupBy(sources,s=>normalizeFluidRequirementVehicle(s)?.canonicalMake??'UNKNOWN');
for(const [make,rows] of groups){
 const path=resolve(out,`make-${sha(make).slice(0,16)}.json`);
 let batch;
 try{batch=JSON.parse(await readFile(path,'utf8'));assert.equal(batch.manifestHash,manifestHash);assert.equal(batch.sourceHash,sha(rows));assert.equal(batch.findings.length,rows.length);}
 catch(e){
  if(e.code!=='ENOENT')throw e;
  const forms=new Set(mannMakeFormsForTest(make));
  const makeRows=catalog.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
  assert.deepEqual(match(rows[0],makeRows),match(rows[0],catalog),'Make prefilter must preserve full-catalog matching');
  batch={make,manifestHash,sourceHash:sha(rows),findings:[]};
  for(const source of rows){
   const decision=match(source,makeRows);
   const validated=new Set(decision.targets.filter(t=>t.independentlyValidated).map(t=>t.vehicleVariantKey));
   batch.findings.push({sourceRequirementId:source.id,sourceHash:sha(source),systemCode:source.systemCode,sourceUrl:source.sourceUrl,oldStatus:old.get(source.id)?.status,decision,canonical:(canonical.get(source.id)??[]).map(r=>({revisionId:r.id,vehicleVariantKey:r.vehicleVariantKey,currentlyValidated:validated.has(r.vehicleVariantKey),scopedDraft:!!r.applicabilityJson?.window,applyEligible:r.applyEligible})),publicationAllowed:false});
   if(batch.findings.length%100===0)console.log(JSON.stringify({make,makeDone:batch.findings.length,makeTotal:rows.length,previousMakesDone:processed,total:sources.length}));
  }
  await immutable(path,batch);
 }
 for(const f of batch.findings){
  const status=f.decision.status;counts[status]=(counts[status]??0)+1;
  const transition=`${f.oldStatus} -> ${status}`;transitions[transition]=(transitions[transition]??0)+1;
  const system=systems[f.systemCode]??={};system[status]=(system[status]??0)+1;
  for(const r of f.decision.reviewReasons)reasons[r]=(reasons[r]??0)+1;
  findings.push(f);
 }
 processed+=rows.length;console.log(JSON.stringify({completedMake:make,processed,total:sources.length,statuses:counts}));
}
assert.equal(new Set(findings.map(f=>f.sourceRequirementId)).size,sources.length);
const summary={manifestHash,total:sources.length,catalogRows:catalog.length,counts,transitions,systems,reviewReasons:Object.fromEntries(Object.entries(reasons).sort((a,b)=>b[1]-a[1])),canonicalRevisions:plan.newRevisions.length,canonicalTargetsNotValidatedInUnscopedReplay:findings.flatMap(f=>f.canonical.filter(c=>!c.currentlyValidated)).length,productionApplyAllowed:false,limitations:['Unscoped replay does not replace engine/date/equipment-scoped draft validation.','Vehicle identity matching does not verify technical specifications or publication eligibility.','All sources are covered; no live database writes or deployment.']};
await immutable(resolve(out,'summary.json'),summary);
console.log(JSON.stringify(summary));
