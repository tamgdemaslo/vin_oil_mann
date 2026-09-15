import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const [beforeVersion,afterVersion]=process.argv.slice(2);
assert.ok(/^v\d+$/.test(beforeVersion??'')&&/^v\d+$/.test(afterVersion??''));assert.notEqual(beforeVersion,afterVersion);
const dir=resolve(import.meta.dirname,'../outputs/mann-gentra-evidence-review-2026-09-14');
const load=async v=>{const raw=await readFile(resolve(dir,`recorded-vin-fluid-replay-${v}.json`),'utf8');return {raw,data:JSON.parse(raw)};};
const before=await load(beforeVersion),after=await load(afterVersion);
function contexts(report){
 const result=new Map();
 for(const sample of report.findings)for(const [evaluation,e] of (sample.evaluations??[]).entries())for(const c of e.candidates){
  const base={sampleRef:sample.sampleRef,evaluation,variantIds:[...c.variantIds].sort()};
  const add=(kind,choice,ids)=>{const descriptor={...base,kind,...choice},key=JSON.stringify(descriptor);assert.ok(!result.has(key));result.set(key,{...descriptor,ids});};
  add('candidate',{},c.visibleRevisionIds);
  for(const x of c.engineChoices??[])add('engine',{engineCode:x.engineCode},x.visibleRevisionIds);
  for(const x of c.marketChoices??[])add('market',{market:x.confirmedMarket,engineCode:x.confirmedEngineCode??null},x.visibleRevisionIds);
 }
 return result;
}
const a=contexts(before.data),b=contexts(after.data),changes=[];let common=0;
for(const [key,old]of a){const next=b.get(key);if(!next){changes.push({kind:'CONTEXT_REMOVED',context:old});continue;}common++;
 const gained=next.ids.filter(id=>!old.ids.includes(id)),lost=old.ids.filter(id=>!next.ids.includes(id));
 if(gained.length||lost.length)changes.push({kind:'ITEMS_CHANGED',context:{...next,ids:undefined},gained,lost});
}
for(const [key,next]of b)if(!a.has(key))changes.push({kind:'CONTEXT_ADDED',context:next});
const beforeSamples=new Map(before.data.findings.map(f=>[f.sampleRef,f.status]));
assert.equal(beforeSamples.size,after.data.findings.length);for(const f of after.data.findings)assert.equal(beforeSamples.get(f.sampleRef),f.status);
const summary={beforeContexts:a.size,afterContexts:b.size,commonContexts:common,changedContexts:changes.filter(c=>c.kind==='ITEMS_CHANGED').length,removedContexts:changes.filter(c=>c.kind==='CONTEXT_REMOVED').length,addedContexts:changes.filter(c=>c.kind==='CONTEXT_ADDED').length,lostItemsInCommonContexts:changes.reduce((n,c)=>n+(c.lost?.length??0),0),gainedItemsInCommonContexts:changes.reduce((n,c)=>n+(c.gained?.length??0),0)};
await writeFile(resolve(dir,`recorded-replay-delta-${beforeVersion}-${afterVersion}.json`),JSON.stringify({kind:'RECORDED_REPLAY_CONTEXT_AND_ITEM_DELTA',beforeHash:sha(before.raw),afterHash:sha(after.raw),summary,changes,productionApplyAllowed:false,limitations:['Hypothetical candidate/engine/market choices from saved replay, not confirmed real vehicle equipment.','Context membership and item IDs checked; comparison does not itself validate technical values or all-fluid completeness.','Removed contexts require separate interpretation, not automatic data-loss attribution.']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({summary,changes}));
