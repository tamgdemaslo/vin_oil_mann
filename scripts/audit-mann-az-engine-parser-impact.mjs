import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-transmission-list-preview-2026-09-14');
const raw=await readFile('/tmp/mann_filter_applications.sql','utf8'),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const rows=parseCopy(raw,'mann_filter_applications'),plan=JSON.parse(planRaw);
const baseline=JSON.parse(await readFile(resolve(dir,'toyota-current-replay-v1.json'),'utf8'));
assert.equal(baseline.mannHash,sha(raw));assert.equal(baseline.planHash,sha(planRaw));
const {splitMannEngineCodeList:after}=await createJiti(import.meta.url).import('../src/lib/mann-engine-code-list.ts');
const before=value=>String(value??'').split(/[;,|]+/).flatMap(segment=>{
 const cleaned=segment.trim(),compressed=cleaned.match(/^((?:OM|M)\d{3}\.)\s*(\d{3}(?:\s*\/\s*\d{3})+)$/);
 if(compressed)return compressed[2].split(/\s*\/\s*/).map(suffix=>compressed[1]+suffix);
 return cleaned.split(/\/+/).map(part=>part.replace(/\b(?:AND ALWAYS|UND IMMER|FOR OUR COMPLETE).*$/i,''));
});
const changes=rows.filter(r=>JSON.stringify(before(r.engineCode))!==JSON.stringify(after(r.engineCode))).map(r=>({variantKey:r.vehicleVariantKey,make:r.make,model:r.model,raw:r.engineCode,before:before(r.engineCode),after:after(r.engineCode)}));
for(const r of changes){assert.equal(r.make,'TOYOTA');assert.equal(r.raw,'1AZ-FE/FSE');assert.deepEqual(r.after,['1AZ-FE','1AZ-FSE']);}
const keys=new Set(changes.map(r=>r.variantKey));
const affected=plan.newRevisions.filter(r=>keys.has(r.vehicleVariantKey)).map(r=>({revisionId:r.id,sourceRequirementId:r.sourceRequirementId,systemCode:r.systemCode,scope:r.applicabilityJson}));
const report={mannHash:sha(raw),planHash:sha(planRaw),parserHash:sha(await readFile(resolve(root,'src/lib/mann-engine-code-list.ts'),'utf8')),summary:{mannRows:rows.length,changedRows:changes.length,changedVariants:keys.size,affectedCurrentRevisions:affected.length},changes,affected,productionApplyAllowed:false,limitation:'Whole-target parser differential; not full matcher, VIN or source technical validation.'};
await writeFile(resolve(dir,'az-engine-parser-impact-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
