import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-identity-scoped-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&process.argv[2]==='--literal-lines'),'Only offline --literal-lines mode supported');
const literalLines=process.argv[2]==='--literal-lines';
const [raw,sourceRaw,mannRaw,snapshotRaw]=await Promise.all([readFile(resolve(dir,literalLines?'engine-line-scopes-v1.json':'source-engine-branches-v1.json'),'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8'),
  readFile(resolve(root,'../vin-oil-mann/outputs/podbormasla-20260723/podbormasla_rows.ndjson'),'utf8')]);
const branches=JSON.parse(raw);assert.equal(sha(sourceRaw),branches.sourceHash);assert.equal(sha(snapshotRaw),branches.snapshotHash);
let anchorBranches=branches;
if(literalLines){
  const anchorRaw=await readFile(resolve(dir,'source-engine-branches-v1.json'),'utf8');
  assert.equal(sha(anchorRaw),branches.branchHash);anchorBranches=JSON.parse(anchorRaw);
  assert.equal(sha(await readFile(resolve(root,'src/lib/fluid-engine-line-context.ts'),'utf8')),branches.helperHash);
  assert.equal(branches.results.length,anchorBranches.results.length);
  for(let i=0;i<branches.results.length;i++){
    const original=anchorBranches.results[i],current=branches.results[i];
    for(const field of Object.keys(original).filter(k=>!['scope','status','reasons'].includes(k)))assert.deepEqual(current[field],original[field]);
    assert.deepEqual(current.anchorScope,original.scope);
  }
}
assert.equal(sha(sourceRaw),anchorBranches.sourceHash);assert.equal(sha(snapshotRaw),anchorBranches.snapshotHash);
assert.equal(sha(await readFile(resolve(root,'src/lib/fluid-engine-context-branch.ts'),'utf8')),anchorBranches.helperHash);
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(dir,'source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),rawRows=new Map(snapshotRaw.trim().split('\n').map(JSON.parse).map(r=>[r.row_id,r]));
const rows=parseCopy(mannRaw,'mann_filter_applications'),variants=Map.groupBy(rows,r=>r.vehicleVariantKey);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {prepareFluidCatalog}=await jiti.import('../src/lib/fluid-catalog.ts');
const {narrowFluidEngineContext:narrow}=await jiti.import('../src/lib/fluid-engine-context-branch.ts');
const {extractFluidEngineLineContext:extractLine,narrowFluidEngineLineScope:narrowLine}=await jiti.import('../src/lib/fluid-engine-line-context.ts');
const prepared=new Map(prepareFluidCatalog({rowsNdjson:snapshotRaw,mannFiltersCsv:''}).requirements.map(r=>[r.id,r]));
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const {normalizeEngineCode}=await jiti.import('../src/lib/vehicle-normalization.ts');
const {parseFluidCapacities}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const makeCache=new Map(),matchCache=new Map(),capacityCache=new Map(),results=[];let attempts=0;
for(const branch of branches.results){
  const source=sources.get(branch.requirementId),original=overlay.originalById.get(branch.requirementId),anchor=prepared.get(branch.engineAnchorRequirementId);
  assert.ok(source&&original&&anchor);assert.equal(sha(original),branch.sourceHash);
  const row=rawRows.get(source.sourceRowId),anchorRow=rawRows.get(branch.engineAnchorRowId);assert.ok(row&&anchorRow);assert.equal(sha(anchorRow),branch.engineAnchorRowHash);
  const narrowed=narrow(source,row,anchor,anchorRow,branch.engineCode);
  if(literalLines){
    assert.ok(narrowed.requirement);
    for(const [k,v] of Object.entries(branch.anchorScope))assert.deepEqual(narrowed.requirement[k],v);
    const context=extractLine(anchorRow.application??'',branch.engineCode);
    assert.deepEqual(context,branch.literalLineContext);
    const lineResult=narrowLine(branch.anchorScope,context);
    assert.deepEqual(lineResult.scope,branch.scope);assert.deepEqual(lineResult.reasons,branch.reasons);
    narrowed.requirement=lineResult.scope?{...narrowed.requirement,...lineResult.scope}:null;
  }
  if(!branch.scope){assert.equal(narrowed.requirement,null);results.push({...branch,outcomes:[],status:'SOURCE_CONTEXT_REVIEW'});continue;}
  assert.ok(narrowed.requirement);for(const [k,v] of Object.entries(branch.scope))assert.deepEqual(narrowed.requirement[k],v);
  const r=narrowed.requirement,identity=normalize(r),code=branch.engineCode;
  assert.ok(identity&&identity.sourceExactEngineCodes.length===1&&identity.sourceExactEngineCodes[0]===code);
  if(!makeCache.has(identity.canonicalMake)){
    const forms=new Set(mannMakeFormsForTest(identity.canonicalMake)),catalog=rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
    const engineIndex=new Map();for(const row of catalog)for(const engine of String(row.engineCode??'').split(/[;,/|]+/).map(normalizeEngineCode).filter(Boolean)){
      if(!engineIndex.has(engine))engineIndex.set(engine,new Set());engineIndex.get(engine).add(row.vehicleVariantKey);
    }
    makeCache.set(identity.canonicalMake,{catalog,engineIndex});
  }
  const {catalog,engineIndex}=makeCache.get(identity.canonicalMake),targets=[...(engineIndex.get(code)??[])],outcomes=[];
  if(!capacityCache.has(source.id))capacityCache.set(source.id,parseFluidCapacities(source.fillVolumeText,source.systemCode));
  const capacity=capacityCache.get(source.id),sourceBlockers=[];
  if(capacity.needsReview)sourceBlockers.push('CAPACITY_REQUIRES_REVIEW');
  if(!source.specificationText?.trim()&&!source.specificationsJson?.length)sourceBlockers.push('MISSING_SPECIFICATION');
  if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)sourceBlockers.push('SOURCE_IDENTITY_CONFLICT');
  for(const key of targets){
    const target=variants.get(key),windows=target.map(row=>applicabilityWindow(r,row)),window=windows[0];
    if(!window||windows.some(w=>!w)||new Set(windows.map(sha)).size!==1)continue;
    if(!target.every(row=>String(row.engineCode??'').split(/[;,/|]+/).map(normalizeEngineCode).includes(code)))continue;
    const cacheKey=sha({requirementId:r.id,scope:branch.scope,years:window.narrowedYears});
    if(!matchCache.has(cacheKey)){matchCache.set(cacheKey,match({...r,...window.narrowedYears},catalog));attempts++;}
    const decision=matchCache.get(cacheKey),accepted=decision.targets.find(t=>t.vehicleVariantKey===key&&t.independentlyValidated&&!t.hardConflicts.length&&!t.reviewBlockers.length&&t.matchedFields.includes('точный код двигателя'));
    const candidate=decision.topCandidates.find(c=>c.variantIds.includes(key));
    const originalFingerprint=originalAssociationFingerprint(key,original,capacity),reasons=[...sourceBlockers];
    if(denied.has(originalFingerprint))reasons.push('PREVIOUSLY_REJECTED_ASSOCIATION');
    outcomes.push({vehicleVariantKey:key,window,status:accepted&&!reasons.length?'ENGINE_CONTEXT_MATCH_CANDIDATE':'REVIEW',reasons,
      matchStatus:decision.status,validation:accepted??null,originalAssociationFingerprint:originalFingerprint,
      candidate:candidate?{score:candidate.score,hardConflicts:candidate.hardConflicts,reviewBlockers:candidate.reviewBlockers}:null});
  }
  results.push({...branch,sourceVehicleScope:{make:source.make,model:source.model,...(source.generation?{generation:source.generation}:{})},
    outcomes,status:outcomes.some(r=>r.status==='ENGINE_CONTEXT_MATCH_CANDIDATE')?'HAS_MATCH':targets.length?'REVIEW':'EXACT_ENGINE_ABSENT_FROM_MANN'});
  if(results.length%100===0)console.log(JSON.stringify({processed:results.length,total:branches.results.length,attempts}));
}
const matches=results.flatMap(r=>r.outcomes.filter(o=>o.status==='ENGINE_CONTEXT_MATCH_CANDIDATE').map(o=>({...o,requirementId:r.requirementId,engineCode:r.engineCode,anchorRowId:r.engineAnchorRowId,scope:r.scope})));
const report={kind:literalLines?'SOURCE_ENGINE_LITERAL_LINE_FULL_MAKE_RECHECK':'SOURCE_ENGINE_ANCHOR_FULL_MAKE_RECHECK',branchHash:sha(raw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),snapshotHash:sha(snapshotRaw),identityCorrections:overlay.metadata,
  summary:{anchorBranches:results.length,fullMakeAttempts:attempts,matchingBranches:results.filter(r=>r.status==='HAS_MATCH').length,
    matches:matches.length,uniqueSourceRequirements:new Set(matches.map(r=>r.requirementId)).size},productionApplyAllowed:false,
  limitation:'Independently matched narrowed engine contexts, not publication revisions. Need compare broad run, dedup scopes, runtime/composition checks and technical source condition review.',results};
await writeFile(resolve(dir,literalLines?'engine-line-recheck-v1.json':'source-engine-branch-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
