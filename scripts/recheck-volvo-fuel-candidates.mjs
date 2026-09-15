import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {applyAuditedTablePower} from './lib/mann-table-power-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const evidenceRaw=await readFile(resolve(dir,'volvo-fuel-exact-evidence-v1.json'),'utf8');assert.equal(sha(evidenceRaw),'6778a1b462a7fdadddb6b50cfbb0f7899f7405a091a2fbf42de295c6c0cd21cd');const evidence=JSON.parse(evidenceRaw);
for(const d of evidence.documents)assert.equal(createHash('sha256').update(await readFile(d.path)).digest('hex'),d.sha256);
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(planRaw),evidence.planHash);const plan=JSON.parse(planRaw);
const raw=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');assert.equal(sha(raw),'e69dcb74c344c793e4a2cf091077143efb0d332ed24660af7415795b031f01ae');
const sql=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(sql),'e802cacc05c23f8c21bc4d84bbf6796b15d9bb5be86e41964a028276fa4f92a0');
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const overlay=await loadIdentityOverlay(root,sql,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'),'fbbe7b991ba80e19d62b42aaece22cb739860443256a8d935160f69ab9f90d34');
const power=await applyAuditedTablePower(root,overlay.requirements,raw);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{prepareFluidCatalog}=await j.import('../src/lib/fluid-catalog.ts'),{matchFluidRequirementToMann:match}=await j.import('../src/lib/mann-fluid-matcher-v2.ts'),{mannMakeFormsForTest}=await j.import('../src/lib/mann-vehicle-resolver.ts'),{normalizeMannText}=await j.import('../src/lib/mann-catalog.ts');
assert.equal(power.parserHash,'27204ec4b2b92106085793c38fcf5d2e7c24622289ca924bebbc06a855f72615');
const fresh=new Map(prepareFluidCatalog({rowsNdjson:raw,mannFiltersCsv:''}).requirements.map(s=>[s.id,s]));
const byRaw=new Map(raw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const candidates=new Map(evidence.proposals.filter(p=>p.after).map(p=>[p.requirementId,p]));assert.equal(candidates.size,19);
const anchors=new Map(evidence.anchorAssessments.map(a=>[a.sourceRowId,a]));
const forms=new Set(mannMakeFormsForTest('VOLVO')),catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));assert.equal(catalog.length,1362);
let unchanged=0;const findings=[];
for(const original of power.requirements){
 const parsed=fresh.get(original.id);assert.ok(parsed);
 const before={...original,engineCodeNormalized:parsed.engineCodeNormalized,engineCodesJson:parsed.engineCodesJson};
 const proposal=candidates.get(original.id),after=proposal?{...before,...proposal.after}:before;
 if(!proposal){assert.deepEqual(after,before);unchanged++;continue;}
 assert.equal(before.fuelType,proposal.before.fuelType);assert.equal(after.fuelType,'diesel');assert.equal(proposal.apply,false);
 assert.equal(sha(byRaw.get(proposal.sourceRowId)),proposal.sourceRowHash);
 for(const id of proposal.evidenceAnchorIds){const a=anchors.get(id);assert.ok(a?.allCodesHaveFuelEvidence);assert.equal(sha(byRaw.get(id)),a.sourceRowHash);assert.ok(a.evidence.every(e=>e.fact?.fuel==='diesel'));}
 assert.deepEqual({...after,fuelType:before.fuelType},before);
 const oldDecision=match(before,catalog),newDecision=match(after,catalog);
 const valid=d=>d.targets.filter(t=>t.independentlyValidated).map(t=>t.vehicleVariantKey),oldValid=valid(oldDecision),newValid=valid(newDecision);
 const canonical=plan.newRevisions.filter(r=>r.sourceRequirementId===original.id).map(r=>({revisionId:r.id,vehicleVariantKey:r.vehicleVariantKey,engineScope:r.applicabilityJson.matchedEngineScope,oldValidated:oldValid.includes(r.vehicleVariantKey),newValidated:newValid.includes(r.vehicleVariantKey),verificationStatus:r.verificationStatus}));
 findings.push({sourceRequirementId:original.id,sourceUrl:original.sourceUrl,systemCode:original.systemCode,beforeFuel:before.fuelType,afterFuel:after.fuelType,beforeHash:sha(before),afterHash:sha(after),evidenceAnchorIds:proposal.evidenceAnchorIds,marketReviewRequired:proposal.marketReviewRequired,oldDecision,newDecision,addedValidatedTargets:newValid.filter(k=>!oldValid.includes(k)),removedValidatedTargets:oldValid.filter(k=>!newValid.includes(k)),canonical,publicationAllowed:false});
}
assert.equal(findings.length,19);assert.equal(unchanged,13277);
const summary={fullSourceRecords:power.requirements.length,unchangedRecords:unchanged,fuelOnlyCandidates:findings.length,catalogRows:catalog.length,statuses:Object.fromEntries([...Map.groupBy(findings,f=>`${f.oldDecision.status} -> ${f.newDecision.status}`)].map(([k,v])=>[k,v.length])),addedValidatedTargets:findings.reduce((n,f)=>n+f.addedValidatedTargets.length,0),removedValidatedTargets:findings.reduce((n,f)=>n+f.removedValidatedTargets.length,0),marketReviewCandidates:findings.filter(f=>f.marketReviewRequired).length,canonicalRevisions:findings.reduce((n,f)=>n+f.canonical.length,0),canonicalValidatedLost:findings.flatMap(f=>f.canonical.filter(c=>c.oldValidated&&!c.newValidated)).length};
const hashes={evidence:sha(evidenceRaw),plan:sha(planRaw),raw:sha(raw),sql:sha(sql),mann:sha(mannRaw),parser:power.parserHash};
for(const path of ['mann-fluid-matcher-v2.ts','mann-vehicle-resolver.ts','vehicle-normalization.ts','mann-row-generation-evidence.ts'])hashes[path]=sha(await readFile(resolve(root,'src/lib',path),'utf8'));
await writeFile(resolve(dir,'volvo-fuel-candidate-replay-v1.json'),JSON.stringify({kind:'VOLVO_FUEL_ONLY_CANDIDATE_PAIRED_REPLAY',hashes,summary,findings,productionApplyAllowed:false,limitations:['Nineteen fresh paired matcher runs; other13277 source objects are unchanged, not independently rematched here.','Only in-memory fuel correction; raw archive, SQL, importer and canonical plan unchanged.','Market/year/gearbox and fluid suitability review remain mandatory even if fuel conflict disappears.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
