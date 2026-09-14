import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-engine-preview-2026-09-14');
const raw=await readFile('/tmp/mann_filter_applications.sql','utf8'),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const rows=parseCopy(raw,'mann_filter_applications'),plan=JSON.parse(planRaw);
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {splitMannEngineCodeList:split}=await jiti.import('../src/lib/mann-engine-code-list.ts');
const {normalizeEngineCode:norm}=await jiti.import('../src/lib/vehicle-normalization.ts');
const unique=a=>[...new Set(a.filter(Boolean))];
const changes=[];
for(const row of rows){
 const before=unique(String(row.engineCode??'').split(/[;,/|]+/).map(s=>norm(s.replace(/\b(?:AND ALWAYS|UND IMMER|FOR OUR COMPLETE).*$/i,'').trim())));
 const after=unique(split(row.engineCode).map(s=>norm(s.trim())));
 if(JSON.stringify(before)===JSON.stringify(after))continue;
 const removed=before.filter(c=>!after.includes(c)),added=after.filter(c=>!before.includes(c));
 assert.ok(removed.every(c=>/^\d{3}$/.test(c)));assert.ok(added.every(c=>/^(M|OM)\d{3}\.\d{3}$/.test(c)));
 changes.push({rowId:row.id,variant:row.vehicleVariantKey,make:row.make,raw:row.engineCode,before,after,removed,added});
}
const variants=new Set(changes.map(r=>r.variant));
const affected=plan.newRevisions.filter(r=>variants.has(r.vehicleVariantKey)).map(r=>({revisionId:r.id,revisionHash:sha(r),sourceRequirementId:r.sourceRequirementId,systemCode:r.systemCode,scope:r.applicabilityJson}));
const report={planHash:sha(planRaw),mannHash:sha(raw),helperHash:sha(await readFile(resolve(root,'src/lib/mann-engine-code-list.ts'),'utf8')),
 resolverHash:sha(await readFile(resolve(root,'src/lib/mann-vehicle-resolver.ts'),'utf8')),
 summary:{catalogRows:rows.length,changedRows:changes.length,changedVariants:variants.size,affectedRevisions:affected.length},changes,affected,
 productionApplyAllowed:false,limitation:'Whole-catalog before/after code parsing inventory. Only bare numeric fragments removed; no full engine lost. Does not prove whole-matcher acceptance equivalence or OEM fitment.'};
await writeFile(resolve(dir,'compressed-engine-impact-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
