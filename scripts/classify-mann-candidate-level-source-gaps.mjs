import assert from 'node:assert/strict';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),archive=resolve(root,'outputs/mann-current-full-rematch-2026-09-14-v2');
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8'),plan=JSON.parse(planRaw),queueRaw=await readFile(resolve(dir,'candidate-level-fluid-gap-audit-v2.json'),'utf8'),queue=JSON.parse(queueRaw);
assert.equal(sha(planRaw),queue.hashes.plan);for(const [p,h] of Object.entries(queue.runtimeHashes))assert.equal(sha(await readFile(resolve(root,p),'utf8')),h);
const manifest=JSON.parse(await readFile(resolve(archive,'manifest.json'),'utf8'));assert.equal(sha(manifest),'3536b390392b83b29977aeff91f024c7d63bd32ac69a40b3cdd1c38c08c87e77');
const raw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');assert.equal(sha(raw),manifest.sourceHash);const ids=new Set(parseCopy(raw,'vehicle_fluid_requirements').map(s=>s.id));
const rows=[],batchHashes={};for(const file of (await readdir(archive)).filter(f=>/^make-[a-f0-9]+\.json$/.test(f)).sort()){const raw=await readFile(resolve(archive,file),'utf8'),batch=JSON.parse(raw);assert.equal(batch.manifestHash,sha(manifest));rows.push(...batch.findings);batchHashes[file]=sha(raw);}
assert.equal(rows.length,13296);assert.deepEqual(new Set(rows.map(r=>r.sourceRequirementId)),ids);
const byVariant=new Map(),byModel=new Map(),add=(m,k,v)=>m.set(k,[...(m.get(k)??[]),v]);
for(const f of rows){const d=f.decision,v=d.normalizedVehicle;if(v)add(byModel,JSON.stringify([v.canonicalMake,v.baseModel]),f);
 for(const key of new Set([...d.targets.map(t=>t.vehicleVariantKey),...d.topCandidates.flatMap(c=>c.variantIds)])){
  const t=d.targets.find(t=>t.vehicleVariantKey===key),c=d.topCandidates.find(c=>c.variantIds.includes(key));
  add(byVariant,key,{sourceRequirementId:f.sourceRequirementId,systemCode:f.systemCode,status:d.status,independentlyValidated:t?.independentlyValidated===true,hardConflicts:t?.hardConflicts??c?.hardConflicts??[],reviewBlockers:t?.reviewBlockers??c?.reviewBlockers??d.reviewReasons,sourceVehicle:v,sourceUrl:f.sourceUrl});
 }
}
const j=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}}),{normalizeDecodedVehicleForTest:normalize}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const findings=[],priorities=[];
for(const q of queue.queue){
 assert.ok(!plan.newRevisions.some(r=>r.vehicleVariantKey===q.vehicleVariantKey));
 const contexts=queue.findings.flatMap(f=>f.evaluations.filter(e=>e.candidates.some(c=>!c.hasResolverConflict&&c.missingVariantKeys.includes(q.vehicleVariantKey))).map(e=>({make:e.make,model:e.model})));
 const sameModelIds=new Set();for(const c of contexts){const n=normalize({makeRaw:c.make,modelRaw:c.model,sourceMethods:['manual']});if(n)for(const s of byModel.get(JSON.stringify([n.canonicalMake,n.baseModel]))??[])sameModelIds.add(s.sourceRequirementId);}
 const links=byVariant.get(q.vehicleVariantKey)??[],unconflicted=links.filter(l=>!l.hardConflicts.length);
 const category=unconflicted.some(l=>l.independentlyValidated)?'HISTORICAL_VALIDATED_TARGET':unconflicted.length?'SOURCE_LINK_REQUIRES_SCOPE_REVIEW':links.length?'ONLY_CONFLICTING_SOURCE_LINKS':sameModelIds.size?'SAME_MODEL_SOURCE_NOT_RETRIEVED_FOR_TARGET':'NO_EXACT_MODEL_SOURCE_INDEX';
 findings.push({...q,category,sameModelSourceIds:[...sameModelIds],links});
 for(const l of unconflicted)priorities.push({...l,vehicleVariantKey:q.vehicleVariantKey,sampleRefs:q.sampleRefs,recoveredFromPartialSample:q.newlyRecoveredSamples.length>0});
}
assert.equal(findings.length,184);const summary={sourceRowsIndexed:rows.length,variants:findings.length,categories:Object.fromEntries([...Map.groupBy(findings,f=>f.category)].map(([k,v])=>[k,v.length])),unconflictedSourceTargetPairs:priorities.length,uniqueSources:new Set(priorities.map(p=>p.sourceRequirementId)).size,historicalValidatedPairs:priorities.filter(p=>p.independentlyValidated).length};
priorities.sort((a,b)=>Number(b.independentlyValidated)-Number(a.independentlyValidated)||Number(b.recoveredFromPartialSample)-Number(a.recoveredFromPartialSample)||b.sampleRefs.length-a.sampleRefs.length);
await writeFile(resolve(dir,'candidate-level-source-gap-classification-v1.json'),JSON.stringify({kind:'CLEANED_CANDIDATE_GAPS_JOINED_TO_ALL_SOURCE_RESULTS',planHash:sha(planRaw),queueHash:sha(queueRaw),manifestHash:sha(manifest),batchHashes,summary,findings,prioritizedSourceTargets:priorities,productionApplyAllowed:false,limitations:['Historical matcher output is a search index, not current validation.','No exact model source match does not exclude aliases or unindexed equivalents.','Unconflicted means no stored hard conflict, not proof of applicability.','184 candidate gaps from recorded samples do not represent the entire catalogue or partially filled-system completeness.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(summary));
