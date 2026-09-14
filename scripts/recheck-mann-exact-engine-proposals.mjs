import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-bmw-body-restored-preview-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&['--review-only','--exact-competitor'].includes(process.argv[2])));
const exactCompetitor=process.argv[2]==='--exact-competitor',reviewOnly=process.argv[2]==='--review-only'||exactCompetitor;
const [planRaw,proposalRaw,sourceRaw,mannRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'exact-engine-scope-proposals-v1.json'),'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8')]);
const plan=JSON.parse(planRaw),proposals=JSON.parse(proposalRaw);assert.equal(proposals.planHash,sha(planRaw));assert.equal(plan.inputHashes.source,sha(sourceRaw));
let reviewIds=null;
if(reviewOnly){const prior=JSON.parse(await readFile(resolve(dir,'exact-engine-proposal-recheck-v1.json'),'utf8'));assert.equal(prior.planHash,sha(planRaw));reviewIds=new Set(prior.results.filter(r=>r.status==='REVIEW').map(r=>r.originalRevisionId));}
const revisions=new Map(plan.newRevisions.map(r=>[r.id,r]));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),rows=parseCopy(mannRaw,'mann_filter_applications');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const catalogCache=new Map(),results=[];
for(const proposal of proposals.proposals.filter(p=>p.status==='ENDPOINT_ENGINE_GATES_PASSED'&&(!reviewIds||reviewIds.has(p.originalRevisionId)))){
  const revision=revisions.get(proposal.originalRevisionId);assert.equal(sha(revision),proposal.originalRevisionHash);
  const source=sources.get(revision.sourceRequirementId),original=overlay.originalById.get(source.id),scope=proposal.proposedApplicability;
  const years=scope.window.intersection;
  const full={...source,...(revision.provenanceJson.sourceEngineScope??{}),yearFrom:years.from?Number(years.from.slice(0,4)):null,yearTo:years.to?Number(years.to.slice(0,4)):null};
  // Do not silently omit identity evidence from an existing proposal.
  assert.ok(!revision.provenanceJson.sourceBodyEvidence&&!revision.provenanceJson.sourceSectionBodyEvidence,'Explicit body proof needs dedicated replay support');
  const narrowed={...full,engineCodeNormalized:scope.matchedEngineScope[0],engineCodesJson:scope.matchedEngineScope};
  const identity=normalize(narrowed);assert.ok(identity);
  if(!catalogCache.has(identity.canonicalMake)){
    const forms=new Set(mannMakeFormsForTest(identity.canonicalMake));
    catalogCache.set(identity.canonicalMake,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));
  }
  const catalog=catalogCache.get(identity.canonicalMake),fullDecision=match(full,catalog),decision=match(narrowed,catalog);
  const target=decision.topCandidates.find(c=>c.variantIds.includes(revision.vehicleVariantKey));
  const validation=decision.targets.find(t=>t.vehicleVariantKey===revision.vehicleVariantKey);
  const originalTarget=fullDecision.topCandidates.find(c=>c.variantIds.includes(revision.vehicleVariantKey));
  const capacity=parse(original.fillVolumeText,original.systemCode),fingerprint=originalAssociationFingerprint(revision.vehicleVariantKey,original,capacity);
  const reasons=[];
  if(!validation?.independentlyValidated)reasons.push('NARROWED_FULL_MAKE_TARGET_NOT_CONFIRMED');
  if(capacity.needsReview)reasons.push('CAPACITY_REVIEW');
  if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
  if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_REVIEW');
  results.push({originalRevisionId:revision.id,originalRevisionHash:sha(revision),proposalHash:sha(proposal),sourceRequirementId:source.id,
    sourceHash:sha(original),vehicleVariantKey:revision.vehicleVariantKey,originalAssociationFingerprint:fingerprint,
    status:reasons.length?'REVIEW':'NARROWED_TARGET_CONFIRMED',reasons,originalFullSourceStatus:fullDecision.status,
    originalTarget:originalTarget??null,target:target??null,validation:validation??null,decisionStatus:decision.status,
    reviewReasons:decision.reviewReasons,top1Top2Gap:decision.top1Top2Gap,
    alternatives:decision.topCandidates.slice(0,5),publicationAllowed:false});
  if(results.length%25===0)console.log(JSON.stringify({processed:results.length,total:388}));
}
const report={planHash:sha(planRaw),proposalsHash:sha(proposalRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),
  matcherHash:sha(await readFile(resolve(root,'src/lib/mann-fluid-matcher-v2.ts'),'utf8')),
  resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),
  summary:{revisions:results.length,statuses:Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length]))},results,productionApplyAllowed:false,
  limitation:'Fullmake before/after engine narrowing, original source/capacity/identity/denylist checks; original ambiguities retained. Not technical approval, excluded-engine resolution, monthly runtime or predecessor reconciliation.'};
await writeFile(resolve(dir,exactCompetitor?'exact-engine-review-details-v2.json':reviewOnly?'exact-engine-review-details-v1.json':'exact-engine-proposal-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
