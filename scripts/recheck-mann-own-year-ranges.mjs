import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-source-quality-preview-2026-09-14');
const raw=await readFile(resolve(dir,'own-year-range-audit-v1.json'),'utf8'),audit=JSON.parse(raw);
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(audit.sourceHash,sha(sourceRaw));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=new Map(overlay.requirements.map(r=>[r.id,r])),rows=parseCopy(mannRaw,'mann_filter_applications');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match,normalizeFluidRequirementVehicle:normalize}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const {mannMakeFormsForTest}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const {normalizeMannText}=await jiti.import('../src/lib/mann-catalog.ts');
const results=[];
for(const f of audit.findings){
  const source=sources.get(f.requirementId);assert.ok(source);assert.equal(sha(overlay.originalById.get(f.requirementId)),f.sourceHash);
  assert.ok(f.proposedIntersection);
  const scoped={...source,yearFrom:f.proposedIntersection.from,yearTo:f.proposedIntersection.to};
  const identity=normalize(scoped);assert.ok(identity);
  const forms=new Set(mannMakeFormsForTest(identity.canonicalMake));
  const catalog=rows.filter(r=>forms.has(normalizeMannText(r.makeNormalized||r.make)));
  const decision=match(scoped,catalog);
  results.push({requirementId:source.id,systemCode:source.systemCode,sourceHash:f.sourceHash,ownYearEvidence:f,
    correctedYears:f.proposedIntersection,decision,publicationAllowed:false});
}
const report={kind:'OWN_YEAR_RANGE_FULL_MAKE_RECHECK',auditHash:sha(raw),sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),identityCorrections:overlay.metadata,
  productionApplyAllowed:false,summary:{requirements:results.length,statuses:Object.fromEntries([...Map.groupBy(results,r=>r.decision.status)].map(([k,v])=>[k,v.length]))},
  limitation:'Full-make year-only rematch, not approved proposals. All gearbox, engine, capacity, source and protected-record gates still apply.',results};
await writeFile(resolve(dir,'own-year-range-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
