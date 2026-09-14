import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-passat-date-inclusive-preview-2026-09-14');
const [mannRaw,planRaw,resolverRaw]=await Promise.all([readFile('/tmp/mann_filter_applications.sql','utf8'),readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')]);
const plan=JSON.parse(planRaw),rows=parseCopy(mannRaw,'mann_filter_applications');
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {rowBodyCodes}=await jiti.import('../src/lib/mann-vehicle-resolver.ts');
const findings=[];
for(const row of rows){
  const headingCodes=rowBodyCodes({...row,vehicleText:'',effectiveVehicleText:''});
  const specificCodes=rowBodyCodes(row);
  if(sha([...headingCodes].sort())===sha([...specificCodes].sort()))continue;
  const explicitGroups=[row.vehicleText,row.effectiveVehicleText].flatMap(v=>[...String(v??'').matchAll(/\(([^)]*)\)/g)])
    .map(m=>m[1].toUpperCase().trim().split(/[\s,;/]+/).filter(Boolean))
    .filter(c=>c.length&&c.every(x=>headingCodes.includes(x)));
  if(!explicitGroups.length)continue;
  assert.ok(specificCodes.every(c=>headingCodes.includes(c)));
  findings.push({mannRowId:row.id,mannRowHash:sha(row),vehicleVariantKey:row.vehicleVariantKey,make:row.make,model:row.model,
    vehicleText:row.vehicleText,effectiveVehicleText:row.effectiveVehicleText,headingCodes,specificCodes});
}
const variants=new Set(findings.map(r=>r.vehicleVariantKey));
const affected=plan.newRevisions.filter(r=>variants.has(r.vehicleVariantKey));
const report={mannHash:sha(mannRaw),planHash:sha(planRaw),resolverHash:sha(resolverRaw),catalogRows:rows.length,
  narrowedRows:findings.length,narrowedVariants:variants.size,affectedPreviewRevisions:affected.length,
  affectedRevisionIds:affected.map(r=>r.id),byMake:Object.fromEntries([...Map.groupBy(findings,r=>r.make)].map(([k,v])=>[k,v.length])),
  findings,productionApplyAllowed:false,limitation:'Current explicit-detail vs heading-only body scope inventory. Not full old/new matching equivalence, source-side or competitor impact clearance; affected previews require rematch.'};
await writeFile(resolve(dir,'specific-body-scope-impact-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,findings:undefined,affectedRevisionIds:undefined},null,2));
