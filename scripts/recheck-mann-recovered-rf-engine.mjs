import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-exact-capacity-engine-preview-2026-09-14');
const [planRaw,evidenceRaw,sourceRaw,mannRaw]=await Promise.all([
  readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'engineless-source-context-v2.json'),'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),
]);
const evidence=JSON.parse(evidenceRaw),plan=JSON.parse(planRaw);
assert.equal(evidence.planHash,sha(planRaw));assert.equal(evidence.sourceHash,sha(sourceRaw));
assert.equal(plan.inputHashes.source,sha(sourceRaw));
const rawText=await readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8');
assert.equal(evidence.rawHash,sha(rawText));
const rawRows=new Map(rawText.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const forms=new Set(mannMakeFormsForTest('KIA'));
const catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
assert.ok(catalog.length);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const results=[];
for(const e of evidence.results.filter(r=>r.status==='LITERAL_CODE_PRESENT_IN_RAW_IMPORT_LOSS')){
  assert.deepEqual(e.literalTargetCodes,['RF']);assert.equal(e.anchors.length,1);
  const anchor=e.anchors[0],raw=rawRows.get(anchor.rowId);assert.equal(sha(raw),anchor.rowHash);
  assert.equal(raw.source_url,e.sourceUrl);assert.equal(raw.table_index,e.tableIndex);
  assert.equal(raw.model,'- RF Diesel / 83 л.с. / Россия');
  const revision=plan.newRevisions.find(r=>r.id===e.revisionId);assert.equal(sha(revision),e.revisionHash);
  const source=sources.get(e.sourceRequirementId),original=overlay.originalById.get(source.id);
  assert.equal(sha(original),e.sourceHash);
  const window=revision.applicabilityJson.window.intersection;
  const base={...source,yearFrom:Number(window.from.slice(0,4)),yearTo:Number(window.to.slice(0,4))};
  const recovered={...base,engineCodeNormalized:'RF',engineCodesJson:['RF'],powerHp:83,fuelType:'diesel'};
  const before=match(base,catalog),after=match(recovered,catalog);
  const target=after.targets.find(t=>t.vehicleVariantKey===revision.vehicleVariantKey);
  const capacity=parse(original.fillVolumeText,original.systemCode);
  const fingerprint=originalAssociationFingerprint(revision.vehicleVariantKey,original,capacity);
  const reasons=['SOURCE_RUSSIA_MARKET_CONDITION_NOT_YET_VERIFIED'];
  if(!target?.independentlyValidated)reasons.push('FULL_MAKE_TARGET_NOT_CONFIRMED');
  if(capacity.needsReview)reasons.push('CAPACITY_REVIEW');
  if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
  if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_REVIEW');
  results.push({revisionId:revision.id,revisionHash:e.revisionHash,sourceRequirementId:source.id,
    systemCode:source.systemCode,anchor,originalAssociationFingerprint:fingerprint,
    recoveredEngine:'RF',sourceConditions:{powerHp:83,fuelType:'diesel',market:'Россия'},
    beforeStatus:before.status,afterStatus:after.status,target:target??null,
    alternatives:after.topCandidates.slice(0,5),reviewReasons:after.reviewReasons,
    status:'REVIEW',reasons,publicationAllowed:false});
}
assert.equal(results.length,2);
const report={planHash:sha(planRaw),evidenceHash:sha(evidenceRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),
  matcherHash:sha(await readFile(resolve(root,'src/lib/mann-fluid-matcher-v2.ts'),'utf8')),
  resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),
  results,productionApplyAllowed:false,limitation:'Diagnostic full-make replay only. RF restored from source, not target. Source market condition explicitly unresolved. No revision replacement or publication.'};
await writeFile(resolve(dir,'recovered-rf-engine-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(results.map(r=>({system:r.systemCode,before:r.beforeStatus,after:r.afterStatus,targetConfirmed:r.target?.independentlyValidated??false,reasons:r.reasons})),null,2));
