import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-disputed-year-preview-2026-09-14');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
const coverageRaw=await readFile(resolve(dir,'full-source-coverage.json'),'utf8'),coverage=JSON.parse(coverageRaw);
assert.equal(coverage.sourceHash,sha(sourceRaw));
const selected=new Set(coverage.rows.filter(r=>r.status==='UNRESOLVED_MATCH_OR_CONDITIONS'&&['ENGINE_OIL','ENGINE_COOLANT','BRAKE_FLUID'].includes(r.systemCode)).map(r=>r.requirementId));
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const sources=overlay.requirements.filter(r=>r.make==='volkswagen'&&r.model==='passat'&&selected.has(r.id));
const catalog=parseCopy(mannRaw,'mann_filter_applications').filter(r=>r.make==='VW (VOLKSWAGEN)');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const results=[];
for(const source of sources){
  results.push({requirementId:source.id,sourceHash:sha(overlay.originalById.get(source.id)),systemCode:source.systemCode,decision:match(source,catalog)});
  if(results.length%20===0)console.log(JSON.stringify({processed:results.length,total:sources.length}));
}
const report={kind:'PASSAT_BASE_IDENTITY_FULL_MAKE_RECHECK',productionApplyAllowed:false,
  sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),coverageHash:sha(coverageRaw),
  resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),identityCorrections:overlay.metadata,
  summary:{requirements:results.length,statuses:Object.fromEntries([...Map.groupBy(results,r=>r.decision.status)].map(([k,v])=>[k,v.length]))},
  limitation:'Fresh full-make rematch only; no date or engine narrowing, source technical approval, new preview revisions or production writes. Old resolver-bound artifacts must not be presented as current replays.',results};
await writeFile(resolve(dir,'passat-base-identity-recheck-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
