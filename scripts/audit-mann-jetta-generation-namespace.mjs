import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-source-quality-preview-2026-09-14');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
const overlay=await loadIdentityOverlay(root,sourceRaw,resolve(root,'outputs/mann-identity-scoped-2026-09-14/source-identity-corrections.json'));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {matchFluidRequirementToMann:match}=await jiti.import('../src/lib/mann-fluid-matcher-v2.ts');
const rows=parseCopy(mannRaw,'mann_filter_applications').filter(r=>r.make==='VW (VOLKSWAGEN)');
assert.ok(rows.length);
const changed=[],unscopedRows=[];
const virtual=rows.map(row=>{
  if(row.model!=='Jetta IV(162)')return row;
  if(row.vehicleYearFrom==null){unscopedRows.push({rowId:row.id,reason:'NO_EXPLICIT_START_YEAR',variantKey:row.vehicleVariantKey});return row;}
  assert.ok(row.vehicleYearFrom>=2010,'162 row predates proposed namespace mapping');
  const next={...row,model:'Jetta VI(162)',modelNormalized:'JETTA VI 162'};
  for(const key of Object.keys(row).filter(k=>!['model','modelNormalized'].includes(k)))assert.deepEqual(next[key],row[key]);
  changed.push({rowId:row.id,originalHash:sha(row),variantKey:row.vehicleVariantKey,before:row.model,diagnosticModel:next.model});
  return next;
});
assert.ok(changed.length);
const selected=overlay.requirements.filter(r=>r.make==='volkswagen'&&r.model==='jetta'&&r.generation==='VI'&&r.bodyCodesJson?.includes('A6'));
const results=[];
for(const source of selected){
  const before=match(source,rows),after=match(source,virtual);
  results.push({requirementId:source.id,sourceHash:sha(overlay.originalById.get(source.id)),systemCode:source.systemCode,
    before,after,publicationAllowed:false});
  if(results.length%10===0)console.log(JSON.stringify({processed:results.length,total:selected.length}));
}
const report={kind:'DIAGNOSTIC_MANN_JETTA_GENERATION_NAMESPACE',sourceHash:sha(sourceRaw),mannHash:sha(mannRaw),identityCorrections:overlay.metadata,
  productionApplyAllowed:false,modelAliasVerifiedForPublication:false,
  evidence:[{url:'https://www.mann-filter.com/jp-ja/catalog/search-results/product.html/c27009_mann-filter.html',role:'MANN uses IV(162) with 2014-2017 engine applications'},
    {url:'https://www.volkswagen-newsroom.com/en/press-releases/the-new-jetta-world-premiere-north-american-international-auto-show-410',role:'Volkswagen generation chronology: sixth Jetta premiered 2010'}],
  summary:{sourceRequirements:results.length,virtualCatalogRows:changed.length,unscopedRows:unscopedRows.length,
    before:Object.fromEntries([...Map.groupBy(results,r=>r.before.status)].map(([k,v])=>[k,v.length])),
    after:Object.fromEntries([...Map.groupBy(results,r=>r.after.status)].map(([k,v])=>[k,v.length]))},
  limitation:'Virtual catalogue-label experiment only. Needs explicit vehicle-type crosswalk proof, date/engine scope rematch, source conditions and runtime identity integration. Never globally equate IV and VI.',changed,unscopedRows,results};
await writeFile(resolve(dir,'jetta-generation-namespace-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary,null,2));
