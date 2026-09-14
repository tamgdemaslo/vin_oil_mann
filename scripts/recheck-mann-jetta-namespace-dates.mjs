import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha,applicabilityWindow} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';

const root=resolve(import.meta.dirname,'..');
const dir=resolve(root,'outputs/mann-source-quality-preview-2026-09-14');
const parentRaw=await readFile(resolve(dir,'jetta-generation-namespace-v1.json'),'utf8');
const parent=JSON.parse(parentRaw);
assert.equal(parent.productionApplyAllowed,false);
assert.equal(parent.modelAliasVerifiedForPublication,false);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(parent.sourceHash,sha(sourceRaw));
assert.equal(parent.mannHash,sha(mannRaw));
const overlay=await loadIdentityOverlay(root,sourceRaw,parent.identityCorrections.path,parent.identityCorrections.sha256);
const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
const changes=new Map(parent.changed.map(r=>[r.rowId,r]));
const catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>r.make==='VW (VOLKSWAGEN)').map(row=>{
  const change=changes.get(row.id);
  if(!change)return row;
  assert.equal(sha(row),change.originalHash);
  assert.equal(row.model,'Jetta IV(162)');
  assert.ok(row.vehicleYearFrom>=2010);
  return {...row,model:change.diagnosticModel,modelNormalized:'JETTA VI 162'};
});
assert.equal(catalog.filter(r=>changes.has(r.id)).length,changes.size);
const ownRaw=await readFile(resolve(dir,'own-year-range-audit-v1.json'),'utf8');
const own=JSON.parse(ownRaw);
assert.equal(own.sourceHash,sha(sourceRaw));
const ownById=new Map(own.findings.map(r=>[r.requirementId,r]));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const results=[];
for(const prior of parent.results){
  const original=sources.get(prior.requirementId);assert.ok(original);
  assert.equal(sha(overlay.originalById.get(original.id)),prior.sourceHash);
  const ownRange=ownById.get(original.id);
  if(ownRange)assert.equal(ownRange.sourceHash,prior.sourceHash);
  const source=ownRange?{...original,yearFrom:ownRange.proposedIntersection.from,yearTo:ownRange.proposedIntersection.to}:original;
  // Follow only the prior top candidate. This is a bounded diagnostic, not an exhaustive resolver.
  const top=prior.after.topCandidates[0];
  const targets=catalog.filter(r=>top?.variantIds.includes(r.vehicleVariantKey)&&changes.has(r.id));
  const windows=new Map();
  for(const target of targets){
    const window=applicabilityWindow(source,target);
    if(window)windows.set(sha(window),window);
  }
  const outcomes=[];
  for(const window of windows.values()){
    const scoped={...source,...window.narrowedYears};
    for(const key of Object.keys(source).filter(k=>!['yearFrom','yearTo'].includes(k)))assert.deepEqual(scoped[key],source[key]);
    const decision=match(scoped,catalog);
    outcomes.push({window,decision,publicationAllowed:false});
  }
  results.push({requirementId:source.id,systemCode:source.systemCode,sourceHash:prior.sourceHash,
    ownRange:ownRange??null,priorStatus:prior.after.status,outcomes});
  console.log(JSON.stringify({processed:results.length,total:parent.results.length}));
}
const outcomes=results.flatMap(r=>r.outcomes);
const report={kind:'DIAGNOSTIC_JETTA_NAMESPACE_DATE_RECHECK',productionApplyAllowed:false,
  modelAliasVerifiedForPublication:false,parentHash:sha(parentRaw),ownRangeAuditHash:sha(ownRaw),
  sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),
  summary:{requirements:results.length,withoutWindow:results.filter(r=>!r.outcomes.length).length,
    outcomes:outcomes.length,statuses:Object.fromEntries([...Map.groupBy(outcomes,r=>r.decision.status)].map(([k,v])=>[k,v.length]))},
  limitation:'Hypothetical model alias only. Year-level full-make rematch; exact month windows retained but runtime not tested. No engine lists split, gearbox inferred, source values corrected, or publication permitted. Top-candidate windows only, not exhaustive coverage.',results};
await writeFile(resolve(dir,'jetta-namespace-date-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
