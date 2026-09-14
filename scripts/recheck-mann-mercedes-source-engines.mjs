import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
import {mercedesSourceEngineEvidence} from './lib/mann-mercedes-source-engine.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--compressed'));
const compressed=process.argv[2]==='--compressed';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,compressed?'outputs/mann-mercedes-engine-preview-2026-09-14':'outputs/mann-rf-market-preview-2026-09-14');
const [planRaw,evidenceRaw,sourceRaw,mannRaw,rawText]=await Promise.all([
  readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(root,'outputs/mann-exact-capacity-engine-preview-2026-09-14/engineless-source-context-v2.json'),'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),
  readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const plan=JSON.parse(planRaw),evidence=JSON.parse(evidenceRaw);
assert.equal(evidence.sourceHash,sha(sourceRaw));assert.equal(evidence.rawHash,sha(rawText));assert.equal(plan.inputHashes.source,sha(sourceRaw));
const rawRows=new Map(rawText.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {parseFluidCapacities:parse}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {splitMannEngineCodeList}=await jiti.import('../src/lib/mann-engine-code-list.ts');
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
const forms=new Set(mannMakeFormsForTest('MERCEDES'));
const catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
assert.ok(catalog.length);
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const results=[];
for(const e of evidence.results.filter(r=>r.sourceUrl.includes('/mercedes/')&&(!compressed||plan.newRevisions.some(v=>v.id===r.revisionId)))){
  const original=plan.newRevisions.find(r=>r.id===e.revisionId);assert.equal(sha(original),e.revisionHash);
  assert.equal(original.systemCode,'BRAKE_FLUID');
  const source=sources.get(e.sourceRequirementId),rawSource=overlay.originalById.get(source.id);assert.equal(e.sourceHash,sha(rawSource));
  const anchors=e.anchors.map(a=>{
    const raw=rawRows.get(a.rowId);assert.equal(sha(raw),a.rowHash);assert.equal(raw.source_url,e.sourceUrl);assert.equal(raw.table_index,e.tableIndex);
    return {...a,recovered:mercedesSourceEngineEvidence(raw.model)};
  });
  const codes=[...new Set(anchors.flatMap(a=>a.recovered.map(r=>r.code)))];
  const targetCodes=compressed?[...new Set(catalog.filter(r=>r.vehicleVariantKey===original.vehicleVariantKey).flatMap(r=>splitMannEngineCodeList(r.engineCode).map(s=>normalizeEngineCode(s.trim()))).filter(Boolean))]:e.targetEngineCodes;
  const exact=codes.filter(c=>targetCodes.includes(c));
  const reasons=[];let decision=null,target=null;
  if(!exact.length)reasons.push('NO_LITERAL_FULL_TARGET_CODE_FROM_SAME_SOURCE_PHRASE');
  const window=original.applicabilityJson.window.intersection;
  if(exact.length){
    // Rematch all independently recovered codes; never prune competitors to
    // force the previous target. Keep original inherited technical context.
    decision=match({...source,engineCodeNormalized:codes[0],engineCodesJson:codes,
      yearFrom:Number(window.from.slice(0,4)),yearTo:Number(window.to.slice(0,4))},catalog);
    target=decision.targets.find(t=>t.vehicleVariantKey===original.vehicleVariantKey)??null;
    if(!target?.independentlyValidated)reasons.push('FULL_MAKE_TARGET_NOT_CONFIRMED');
    for(const anchor of anchors.filter(a=>a.recovered.some(r=>exact.includes(r.code)))){
      const years=anchor.years.match(/^\s*(\d{4})\s*[-–]\s*(\d{4})\s*$/);
      if(!years||window.from<`${years[1]}-01`||window.to>`${years[2]}-12`)reasons.push('ANCHOR_DATE_SCOPE_REVIEW');
    }
  }
  const capacity=parse(rawSource.fillVolumeText,rawSource.systemCode),fingerprint=originalAssociationFingerprint(original.vehicleVariantKey,rawSource,capacity);
  if(capacity.needsReview)reasons.push('CAPACITY_REVIEW');
  if(denied.has(fingerprint))reasons.push('DENIED_ORIGINAL_ASSOCIATION');
  if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_REVIEW');
  results.push({revisionId:original.id,revisionHash:sha(original),sourceRequirementId:source.id,anchors,sourceCodes:codes,targetCodes,
    exactCodes:exact,proposedScope:exact.length?{...original.applicabilityJson,matchedEngineScope:exact}:null,
    originalAssociationFingerprint:fingerprint,status:reasons.length?'REVIEW':'SOURCE_ENGINE_RECOVERY_CONFIRMED',reasons:[...new Set(reasons)],
    decisionStatus:decision?.status??null,target,alternatives:decision?.topCandidates.slice(0,5)??[],publicationAllowed:false});
}
assert.equal(results.length,compressed?10:24);
const summary=Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length]));
const report={planHash:sha(planRaw),evidenceHash:sha(evidenceRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),rawHash:sha(rawText),
  matcherHash:sha(await readFile(resolve(root,'src/lib/mann-fluid-matcher-v2.ts'),'utf8')),
  resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),
  helperHash:sha(await readFile(resolve(root,'scripts/lib/mann-mercedes-source-engine.mjs'),'utf8')),
  targetParserHash:sha(await readFile(resolve(root,'src/lib/mann-engine-code-list.ts'),'utf8')),
  summary,results,productionApplyAllowed:false,limitation:'Same-phrase source reconstruction plus full-make replay, not general Mercedes aliases. No revision merge or runtime scope replay. Original inherited power/fuel retained; no independent OEM fluid verification.'};
await writeFile(resolve(dir,compressed?'mercedes-source-engine-recheck-v2.json':'mercedes-source-engine-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({summary,details:results.map(r=>({id:r.revisionId,codes:r.sourceCodes,exact:r.exactCodes,status:r.status,reasons:r.reasons}))},null,2));
