import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-equipment-preview-2026-09-14');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const plan=JSON.parse(planRaw),sources=parseCopy(sourceRaw,'vehicle_fluid_requirements');assert.equal(plan.inputHashes.source,sha(sourceRaw));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {mannTransmissionComponent:parse}=await jiti.import('../src/lib/mann-transmission-component.ts');
const old=value=>{
 const raw=(value??'').trim();
 if(/^(?:[-—]|N\/A|NONE|AT|MT|CVT|DCT|DSG|АКПП|МКПП)?$/i.test(raw))return {kind:'type'};
 if(/^(?:ZF\s+|AISIN\s+|JATCO\s+)?[A-Z0-9][A-Z0-9-]{2,15}$/i.test(raw)&&/\d/.test(raw)&&!/^\d+(?:AT|MT|DCT|DSG)$/i.test(raw))return {kind:'model',model:raw.toUpperCase().replace(/\s+/g,' ')};
 return {kind:'conditions',text:raw};
};
const changes=[];
for(const source of sources){
 const before=old(source.componentModel),after=parse(source.componentModel);
 if(JSON.stringify(before)===JSON.stringify(after))continue;
 assert.equal(before.kind,'conditions');assert.equal(after.kind,'model');assert.match(after.model,/^7\d{2}\.\d{3}$/);
 changes.push({sourceRequirementId:source.id,sourceHash:sha(source),make:source.make,systemCode:source.systemCode,raw:source.componentModel,before,after});
}
const affected=plan.newRevisions.filter(r=>JSON.stringify(old(r.componentModel))!==JSON.stringify(parse(r.componentModel))).map(r=>({revisionId:r.id,revisionHash:sha(r),systemCode:r.systemCode,matchClass:r.matchClass,raw:r.componentModel,after:parse(r.componentModel)}));
const mercedes=sources.filter(r=>r.make==='mercedes'&&['AUTOMATIC_TRANSMISSION','MANUAL_TRANSMISSION'].includes(r.systemCode));
const report={sourceHash:sha(sourceRaw),planHash:sha(planRaw),parserHash:sha(await readFile(resolve(root,'src/lib/mann-transmission-component.ts'),'utf8')),
 summary:{sourceRows:sources.length,changedSourceRows:changes.length,affectedCurrentRevisions:affected.length,mercedesGearboxRows:mercedes.length,
 mercedesClassification:Object.fromEntries([...Map.groupBy(mercedes,r=>parse(r.componentModel).kind)].map(([k,v])=>[k,v.length]))},changes,affected,productionApplyAllowed:false,
 limitation:'Full-source component parsing inventory only, not source/VIN gearbox confirmation or technical accuracy. Decimal single models now need exact model selection; complex clauses remain blocked.'};
await writeFile(resolve(dir,'decimal-gearbox-impact-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
