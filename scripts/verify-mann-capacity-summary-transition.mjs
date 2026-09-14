import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const beforeRaw=await readFile(resolve(dir,'capacity-summary-before-v1.json'),'utf8'),afterRaw=await readFile(resolve(dir,'capacity-summary-after-v1.json'),'utf8');
const before=JSON.parse(beforeRaw),after=JSON.parse(afterRaw);assert.equal(before.parserHash,'6885c95dbe512c6d85f72a8f7bb93ab3dba4c8d0aa0c590eabb82e1bc9cbe397');assert.equal(after.parserHash,sha(await readFile(resolve(root,'src/lib/fluid-catalog.ts'),'utf8')));assert.equal(before.snapshotHash,after.snapshotHash);
const strip=r=>{const {serviceVolumeLiters,totalVolumeLiters,...rest}=r;return rest;};
assert.deepEqual({...after.prepared,requirements:after.prepared.requirements.map(strip)},{...before.prepared,requirements:before.prepared.requirements.map(strip)});
assert.equal(after.prepared.requirements.length,13296);
const expected=(caps,kinds)=>{
 const selected=caps.filter(c=>kinds.includes(c.kind));if(!selected.length)return null;
 let value;for(const c of selected){if(c.qualifier!=='EXACT'||c.minLiters==null||c.minLiters!==c.maxLiters)return null;if(value!==undefined&&value!==c.minLiters)return null;value=c.minLiters;}return value;
};
const changes=[];
for(let i=0;i<after.prepared.requirements.length;i++){
 const a=after.prepared.requirements[i],b=before.prepared.requirements[i];assert.equal(a.id,b.id);
 assert.equal(a.serviceVolumeLiters,expected(a.capacitiesJson,['service','partial','with_filter']));assert.equal(a.totalVolumeLiters,expected(a.capacitiesJson,['total']));
 if(a.serviceVolumeLiters!==b.serviceVolumeLiters||a.totalVolumeLiters!==b.totalVolumeLiters)changes.push({id:a.id,systemCode:a.systemCode,before:{service:b.serviceVolumeLiters,total:b.totalVolumeLiters},after:{service:a.serviceVolumeLiters,total:a.totalVolumeLiters},capacities:a.capacitiesJson});
}
const report={kind:'CAPACITY_SUMMARY_ONLY_PARSER_TRANSITION',beforeParserHash:before.parserHash,afterParserHash:after.parserHash,beforeHash:sha(beforeRaw),afterHash:sha(afterRaw),snapshotHash:after.snapshotHash,checked:13296,changed:changes.length,serviceChanged:changes.filter(c=>c.before.service!==c.after.service).length,totalChanged:changes.filter(c=>c.before.total!==c.after.total).length,allOtherPreparedFieldsIdentical:true,changes,productionApplyAllowed:false};
await writeFile(resolve(dir,'capacity-summary-transition-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,changes:undefined}));
