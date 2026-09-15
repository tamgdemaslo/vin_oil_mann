import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),rematch=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const [planRaw,replayRaw,manifestRaw,sourceRaw]=await Promise.all([
  readFile(resolve(dir,'plan.json'),'utf8'),readFile(resolve(dir,'recorded-vin-fluid-replay-v2.json'),'utf8'),
  readFile(resolve(rematch,'manifest.json'),'utf8'),readFile('/tmp/vehicle_fluid_requirements.sql','utf8')]);
const plan=JSON.parse(planRaw),replay=JSON.parse(replayRaw),manifest=JSON.parse(manifestRaw);
assert.equal(sha(planRaw),'12a5a5563418358782de3d4ca4e3507b1ccc8bb3e5ff8651439755d961f4392f');
assert.equal(replay.inputHashes.plan,sha(planRaw));
assert.equal(sha(manifest),'3536b390392b83b29977aeff91f024c7d63bd32ac69a40b3cdd1c38c08c87e77');
assert.equal(manifest.sourceHash,sha(sourceRaw));
const sourceIds=new Set(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(s=>s.id)),sourceRows=[],batchHashes={};
for(const file of (await readdir(rematch)).filter(f=>/^make-[a-f0-9]+\.json$/.test(f)).sort()){
  const raw=await readFile(resolve(rematch,file),'utf8'),batch=JSON.parse(raw);
  assert.equal(batch.manifestHash,sha(manifest));batchHashes[file]=sha(raw);sourceRows.push(...batch.findings);
}
assert.equal(sourceRows.length,13296);assert.deepEqual(new Set(sourceRows.map(s=>s.sourceRequirementId)),sourceIds);
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {normalizeDecodedVehicleForTest:normalize}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const byVariant=new Map(),byModel=new Map();
const add=(map,key,value)=>{const rows=map.get(key)??[];rows.push(value);map.set(key,rows);};
for(const f of sourceRows){
  const d=f.decision,v=d.normalizedVehicle;
  if(v)add(byModel,JSON.stringify([v.canonicalMake,v.baseModel]),f);
  const variants=new Set([...d.targets.map(t=>t.vehicleVariantKey),...d.topCandidates.flatMap(c=>c.variantIds)]);
  for(const key of variants){
    const target=d.targets.find(t=>t.vehicleVariantKey===key),candidate=d.topCandidates.find(c=>c.variantIds.includes(key));
    add(byVariant,key,{sourceRequirementId:f.sourceRequirementId,systemCode:f.systemCode,status:d.status,
      independentlyValidated:target?.independentlyValidated===true,
      hardConflicts:target?.hardConflicts??candidate?.hardConflicts??[],
      reviewBlockers:target?.reviewBlockers??candidate?.reviewBlockers??d.reviewReasons,
      sourceHasAnyDraft:plan.newRevisions.some(r=>r.sourceRequirementId===f.sourceRequirementId),
      sourceVehicle:v,sourceUrl:f.sourceUrl});
  }
}
const absent=replay.findings.filter(f=>f.status==='REPLAYED'&&f.evaluations.some(e=>e.candidates.length)&&!f.evaluations.some(e=>e.candidates.some(c=>c.draftCount)));
assert.equal(absent.length,80);
const findings=[],priorities=new Map();
for(const f of absent){
  const evaluations=f.evaluations.map(e=>{
    const v=normalize({makeRaw:e.make,modelRaw:e.model,sourceMethods:['manual']}),sameModel=v?(byModel.get(JSON.stringify([v.canonicalMake,v.baseModel]))??[]):[];
    const candidates=e.candidates.map(c=>{
      const links=c.variantIds.flatMap(key=>(byVariant.get(key)??[]).map(link=>({vehicleVariantKey:key,...link})));
      for(const link of links){
        const key=JSON.stringify([link.sourceRequirementId,link.vehicleVariantKey]);
        const item=priorities.get(key)??{...link,sampleRefs:[]};
        if(!item.sampleRefs.includes(f.sampleRef))item.sampleRefs.push(f.sampleRef);priorities.set(key,item);
      }
      return {variantIds:c.variantIds,sourceLinks:links};
    });
    return {make:e.make,model:e.model,sameModelSourceCount:sameModel.length,
      sameModelSystems:[...new Set(sameModel.map(s=>s.systemCode))],candidates};
  });
  const links=evaluations.flatMap(e=>e.candidates.flatMap(c=>c.sourceLinks));
  const category=links.some(l=>l.independentlyValidated)?'HAS_HISTORICAL_VALIDATED_SOURCE_TARGET':links.length?'HAS_SOURCE_CANDIDATE_LINK':
    evaluations.some(e=>e.sameModelSourceCount)?'HAS_SAME_MODEL_SOURCE_ONLY':'NO_EXACT_MODEL_IN_SOURCE_INDEX';
  findings.push({sampleRef:f.sampleRef,dataset:f.dataset,category,evaluations});
}
const targets=[...priorities.values()].sort((a,b)=>Number(b.independentlyValidated)-Number(a.independentlyValidated)||b.sampleRefs.length-a.sampleRefs.length||a.sourceRequirementId.localeCompare(b.sourceRequirementId));
const summary={samplesWithoutDraft:findings.length,sourceRowsIndexed:sourceRows.length,
  categories:Object.fromEntries([...new Set(findings.map(f=>f.category))].map(category=>[category,findings.filter(f=>f.category===category).length])),
  linkedSourceTargetPairs:targets.length,historicalValidatedPairs:targets.filter(t=>t.independentlyValidated).length,
  linkedSources:new Set(targets.map(t=>t.sourceRequirementId)).size};
const report={kind:'RECORDED_VIN_GAPS_JOINED_TO_WHOLE_SOURCE_REPLAY',planHash:sha(planRaw),vinReplayHash:sha(replayRaw),manifestHash:sha(manifest),batchHashes,summary,findings,prioritizedSourceTargets:targets,
  limitations:['Historical full-source matcher evidence, not a current rematch or publication/technical validation.','Top-five decoded candidates are hypothetical, not user-confirmed true vehicle identities.','No exact model in this index is not proof that equivalent data is absent: aliases and normalization may differ.','Same-model rows may describe other engines, generations or dates. Do not propagate their fluids.','Current draft membership checked against current plan, not historical canonical memberships.'],productionApplyAllowed:false};
await writeFile(resolve(dir,'recorded-vin-source-gaps-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(summary));
