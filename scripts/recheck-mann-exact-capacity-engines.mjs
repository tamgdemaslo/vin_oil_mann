import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-exact-engine-v10-preview-2026-09-14');
const proposalDir=resolve(root,'outputs/mann-bmw-body-restored-preview-2026-09-14');
const [raw,proposalRaw,proofRaw,sourceRaw,mannRaw]=await Promise.all([readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(proposalDir,'exact-engine-scope-proposals-v2.json'),'utf8'),
  readFile(resolve(proposalDir,'exact-engine-capacity-runtime-v2.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8')]);
const plan=JSON.parse(raw),proposals=JSON.parse(proposalRaw),proof=JSON.parse(proofRaw);
assert.equal(proof.proposalsHash,sha(proposalRaw));assert.equal(plan.inputHashes.source,sha(sourceRaw));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),rows=parseCopy(mannRaw,'mann_filter_applications');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {parseConditionalFluidCapacities:parseConditions}=await jiti.import('../src/lib/fluid-capacity-conditions.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const results=[],replacements=[],cache=new Map();
for(const proposal of proposals.proposals.filter(p=>p.status==='CAPACITY_BRANCH_REPLAY_REQUIRED')){
  const original=plan.newRevisions.find(r=>r.id===proposal.originalRevisionId);assert.equal(sha(original),proposal.originalRevisionHash);
  assert.equal(proof.results.find(r=>r.originalRevisionId===original.id)?.proposalHash,sha(proposal));
  const source=sources.get(original.sourceRequirementId),originalSource=overlay.originalById.get(source.id);
  const parsed=parseConditions(source.fillVolumeText,source.systemCode,source.engineCodesJson??[]);assert.equal(parsed.status,'structured');
  assert.equal(parsed.branches.length,proposal.proposedCapacityBranches.length);
  const body=normalize(source);assert.ok(body);
  if(!cache.has(body.canonicalMake)){const forms=new Set(mannMakeFormsForTest(body.canonicalMake));cache.set(body.canonicalMake,rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make))));}
  const checked=[];
  for(const branch of proposal.proposedCapacityBranches){
    const sourceBranch=parsed.branches.find(b=>sha(b.condition)===sha(branch.condition));assert.ok(sourceBranch);
    assert.equal(branch.sourceSegment,sourceBranch.sourceSegment);
    const scope=branch.applicabilityJson,w=scope.window.intersection;
    const scoped={...source,engineCodeNormalized:scope.matchedEngineScope[0],engineCodesJson:scope.matchedEngineScope,
      yearFrom:w.from?Number(w.from.slice(0,4)):null,yearTo:w.to?Number(w.to.slice(0,4)):null,fillVolumeText:branch.sourceSegment};
    const decision=match(scoped,cache.get(body.canonicalMake)),validation=decision.targets.find(t=>t.vehicleVariantKey===original.vehicleVariantKey);
    const fingerprint=originalAssociationFingerprint(original.vehicleVariantKey,originalSource,parse(originalSource.fillVolumeText,originalSource.systemCode));
    assert.equal(fingerprint,branch.originalAssociationFingerprint);
    const reasons=[];
    if(!validation?.independentlyValidated)reasons.push('FULL_MAKE_TARGET_NOT_CONFIRMED');
    if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
    if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_REVIEW');
    if(branch.condition.kind==='transmission'&&source.transmissionType&&source.transmissionType!==branch.condition.value)reasons.push('SOURCE_TRANSMISSION_CONTRADICTION');
    checked.push({condition:branch.condition,sourceSegment:branch.sourceSegment,parsedCapacity:sourceBranch.capacity,
      status:reasons.length?'REVIEW':'CONFIRMED_BRANCH',reasons,decision,validation});
  }
  const result={originalRevisionId:original.id,originalRevisionHash:sha(original),proposalHash:sha(proposal),sourceHash:sha(originalSource),branches:checked,publicationAllowed:false};results.push(result);
  if(checked.some(r=>r.status!=='CONFIRMED_BRANCH'))continue;
  const technicalDataJson={...original.technicalDataJson,capacityBranches:proposal.proposedCapacityBranches.map((b,i)=>({...b,validation:checked[i].validation}))};
  const applicabilityJson=proposal.proposedApplicability,key=`${original.sourceRequirementId}:${original.vehicleVariantKey}`,policy=original.provenanceJson.catalogPreviewPolicy;
  const fingerprint=sha({key,policy,applicabilityJson,technicalDataJson});
  const revision={...original,id:`mtar_${fingerprint.slice(0,24)}`,semanticFingerprint:fingerprint,applicabilityJson,technicalDataJson,
    provenanceJson:{...original.provenanceJson,exactCapacityEngineNarrowing:{originalRevisionId:original.id,proposalHash:sha(proposal),validationHash:sha(result)},sourceTechnicalReviewRequired:true}};
  replacements.push({originalRevisionId:original.id,originalRevisionHash:sha(original),revision,residuals:proposal.residuals,publicationAllowed:false});
}
const report={planHash:sha(raw),proposalsHash:sha(proposalRaw),runtimeProofHash:sha(proofRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),
  matcherHash:sha(await readFile(resolve(root,'src/lib/mann-fluid-matcher-v2.ts'),'utf8')),resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),
  results,replacements,summary:{revisions:results.length,branches:results.reduce((n,r)=>n+r.branches.length,0),replacements:replacements.length},productionApplyAllowed:false,
  limitation:'Source conditional parser, exact engine/fullmake and original fingerprint checks. Earlier runtime proof binds same proposals; technical facts remain secondary/unverified. No plan or DB update.'};
await writeFile(resolve(dir,'exact-capacity-engine-replacements-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
