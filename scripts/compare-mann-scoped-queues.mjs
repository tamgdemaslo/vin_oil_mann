#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
import {loadIdentityOverlay} from './lib/mann-source-identity-overlay.mjs';
assert.equal(process.argv.length,4,'Pass previous and current output directories');
const [previous,current]=process.argv.slice(2).map(p=>resolve(p));
const raws=await Promise.all([previous,current].map(p=>readFile(resolve(p,'queue.json'),'utf8')));
const [a,b]=raws.map(JSON.parse);
const root=resolve(import.meta.dirname,'..'),sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
for(const queue of [a,b]){
  assert.equal(queue.summary.sourceHashes.fluids,sha(sourceRaw));
  const meta=queue.summary.identityCorrections;
  const overlay=await loadIdentityOverlay(root,sourceRaw,meta?.path,meta?.sha256);
  const sources=new Map(overlay.requirements.map(r=>[r.id,r]));
  for(const row of queue.requirements)assert.equal(row.vehicle.generation,sources.get(row.requirementId)?.generation,'Generation must agree with verified identity overlay');
}
// Older compact queues omitted matchedEngineScope. Compare canonical scopes,
// not that export-format difference, and validate the compact windows first.
for (const [directory, queue] of [[previous, a], [current, b]]) {
  const canonicalRaw = await readFile(resolve(directory, 'scoped-proposals.ndjson'), 'utf8');
  const canonical = new Map(canonicalRaw.trim().split('\n').filter(Boolean).map(JSON.parse).map(p => [`${p.requirementId}:${p.vehicleVariantKey}`, p]));
  let links = 0;
  for (const row of queue.requirements) for (const proposal of row.proposals) {
    const full = canonical.get(`${row.requirementId}:${proposal.vehicleVariantKey}`);
    assert.ok(full); assert.deepEqual(proposal.window, full.window);
    if ('matchedEngineScope' in proposal) assert.deepEqual(proposal.matchedEngineScope, full.matchedEngineScope);
    proposal.matchedEngineScope = full.matchedEngineScope ?? null;
    links++;
  }
  assert.equal(links, canonical.size);
}
assert.deepEqual(a.summary.sourceHashes,b.summary.sourceHashes,'Cannot compare different source snapshots');
const old=new Map(a.requirements.map(r=>[r.requirementId,r]));
assert.equal(old.size,a.requirements.length);assert.equal(b.requirements.length,old.size);
const seen=new Set(),transitions={},gained=[],lost=[],changed=[],identityChanges=[],systems={};
for(const row of b.requirements){
  const before=old.get(row.requirementId);assert.ok(before&&!seen.has(row.requirementId));seen.add(row.requirementId);
  const {generation:oldGeneration,...oldVehicle}=before.vehicle,{generation:newGeneration,...newVehicle}=row.vehicle;
  assert.deepEqual(newVehicle,oldVehicle);assert.deepEqual(row.technical,before.technical);
  if(oldGeneration!==newGeneration)identityChanges.push({requirementId:row.requirementId,before:oldGeneration,after:newGeneration});
  const transition=`${before.disposition} -> ${row.disposition}`;transitions[transition]=(transitions[transition]??0)+1;
  const system=systems[row.systemCode]??={requirements:0,previousProposed:0,currentProposed:0,review:0,deferred:0};
  system.requirements++;system.previousProposed+=Number(before.proposals.length>0);system.currentProposed+=Number(row.proposals.length>0);
  system.review+=Number(row.disposition==='REVIEW');system.deferred+=Number(row.disposition==='DEFERRED');
  const oldLinks=new Map(before.proposals.map(p=>[p.vehicleVariantKey,p]));
  const newLinks=new Map(row.proposals.map(p=>[p.vehicleVariantKey,p]));
  const added=[...newLinks.keys()].filter(k=>!oldLinks.has(k));
  const removed=[...oldLinks.keys()].filter(k=>!newLinks.has(k));
  const altered=[...newLinks.keys()].filter(k=>oldLinks.has(k)&&sha(newLinks.get(k))!==sha(oldLinks.get(k)));
  const detail={requirementId:row.requirementId,sourceUrl:row.sourceUrl,vehicle:row.vehicle,systemCode:row.systemCode,
    before:before.disposition,after:row.disposition,added,removed,altered,reasons:row.reviewReasons};
  if(!before.proposals.length&&row.proposals.length)gained.push(detail);
  if(before.proposals.length&&!row.proposals.length)lost.push(detail);
  if(added.length||removed.length||altered.length)changed.push(detail);
}
const report={kind:'FULL_SCOPED_QUEUE_COMPARISON',productionApplyAllowed:false,
  inputHashes:{previous:sha(raws[0]),current:sha(raws[1])},requirements:seen.size,transitions,
  newlyProposedRequirements:gained.length,noLongerProposedRequirements:lost.length,
  previousLinks:a.summary.proposals,currentLinks:b.summary.proposals,identityChangedRequirements:identityChanges.length,identityChanges,systems,gained,lost,changed};
await writeFile(resolve(current,'comparison.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,gained:undefined,lost:undefined,changed:undefined,identityChanges:undefined},null,2));
