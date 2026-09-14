import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,originalAssociationFingerprint} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-disputed-year-preview-2026-09-14');
assert.ok(process.argv.length===2||(process.argv.length===3&&['--b7','--dates','--specific-dates'].includes(process.argv[2])));
const specific=process.argv[2]==='--specific-dates',dates=process.argv[2]==='--dates'||specific,b7=process.argv[2]==='--b7'||dates;
const [auditRaw,sourceRaw,mannRaw]=await Promise.all([readFile(resolve(dir,specific?'passat-date-candidate-scopes-v2.json':dates?'passat-date-candidate-scopes-v1.json':b7?'passat-candidate-scope-audit-v4.json':'passat-candidate-scope-audit-v3.json'),'utf8'),
  readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),readFile('/tmp/mann_filter_applications.sql','utf8')]);
const audit=JSON.parse(auditRaw);assert.equal(audit.sourceHash,sha(sourceRaw));assert.equal(audit.mannHash,sha(mannRaw));
const parentRaw=await readFile(resolve(dir,specific?'passat-source-body-recheck-v4.json':b7?'passat-source-body-recheck-v3.json':'passat-source-body-recheck-v2.json'),'utf8');assert.equal(audit.parentHash,sha(parentRaw));
assert.equal(JSON.parse(parentRaw).resolverHash,sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>r.make==='VW (VOLKSWAGEN)');
const catalogById=new Map(catalog.map(r=>[r.id,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {parseFluidCapacities}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const denied=new Set(JSON.parse(await readFile(resolve(root,'data/mann-technical-association-denylist-v1.json'),'utf8')).rejectedAssociationFingerprints);
const grouped=Map.groupBy(audit.results,r=>sha({id:r.requirementId,variant:r.vehicleVariantKey,body:r.bodyCodes,engines:r.matchedEngineScope,window:r.proposedWindow}));
const results=[];
for(const contexts of grouped.values()){
  const context=contexts[0],source=sources.get(context.requirementId),original=overlay.originalById.get(context.requirementId);
  assert.ok(source&&original);assert.equal(sha(original),context.sourceHash);
  for(const row of contexts)assert.equal(sha(catalogById.get(row.mannRowId)),row.mannRowHash);
  const {from,to}=context.proposedWindow;assert.ok(from&&to&&from<=to);
  const scoped={...source,bodyCodesJson:context.bodyCodes,yearFrom:Number(from.slice(0,4)),yearTo:Number(to.slice(0,4))};
  // Preserve the entire original engine list during reranking; matched scope is
  // not permission to hide alternative engines or overwrite technical facts.
  for(const field of Object.keys(source).filter(k=>!['bodyCodesJson','yearFrom','yearTo'].includes(k)))assert.deepEqual(scoped[field],source[field]);
  const decision=match(scoped,catalog);
  const validation=decision.targets.find(r=>r.vehicleVariantKey===context.vehicleVariantKey&&r.independentlyValidated&&!r.hardConflicts.length&&!r.reviewBlockers.length);
  const capacity=parseFluidCapacities(original.fillVolumeText,original.systemCode);
  const fingerprint=originalAssociationFingerprint(context.vehicleVariantKey,original,capacity);
  const reasons=[];
  if(contexts.some(r=>r.status!=='MONTH_ENGINE_SCOPE_CANDIDATE'))reasons.push('SOURCE_SCOPE_REVIEW');
  if(!['CONFIRMED_SINGLE','CONFIRMED_MULTI_APPLICABILITY'].includes(decision.status)||!validation)reasons.push('FULL_MAKE_REMATCH_NOT_CONFIRMED');
  if(capacity.needsReview)reasons.push('CAPACITY_REQUIRES_REVIEW');
  if(!original.specificationText?.trim()&&!original.specificationsJson?.length)reasons.push('MISSING_SPECIFICATION');
  if(source.rawRequirementJson?.sourceIdentity?.reviewRequired)reasons.push('SOURCE_IDENTITY_CONFLICT');
  if(denied.has(fingerprint))reasons.push('PREVIOUSLY_REJECTED_ASSOCIATION');
  results.push({requirementId:source.id,systemCode:source.systemCode,sourceHash:context.sourceHash,
    vehicleVariantKey:context.vehicleVariantKey,sourceContextHashes:contexts.map(sha),bodyCodes:context.bodyCodes,
    matchedEngineScope:context.matchedEngineScope,window:context.proposedWindow,scopedYears:{from:scoped.yearFrom,to:scoped.yearTo},
    originalAssociationFingerprint:fingerprint,status:reasons.length?'REVIEW':'SCOPED_MATCH_CANDIDATE',reasons,
    capacity,decision,publicationAllowed:false});
  if(results.length%10===0)console.log(JSON.stringify({processed:results.length,total:grouped.size}));
}
const report={kind:'PASSAT_FINAL_SCOPE_FULL_MAKE_RECHECK',auditHash:sha(auditRaw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),
  resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),productionApplyAllowed:false,
  summary:{inputRowContexts:audit.results.length,deduplicatedContexts:results.length,requirements:new Set(results.map(r=>r.requirementId)).size,
    statuses:Object.fromEntries([...Map.groupBy(results,r=>r.status)].map(([k,v])=>[k,v.length]))},
  limitation:'Reranked exact scope candidates, not staged revisions, runtime verification or OEM approval. Original fingerprints checked against denylist; live protected predecessor reconciliation still required.',results};
await writeFile(resolve(dir,specific?'passat-date-final-scopes-v2.json':dates?'passat-date-final-scopes-v1.json':b7?'passat-final-scope-recheck-v2.json':'passat-final-scope-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
