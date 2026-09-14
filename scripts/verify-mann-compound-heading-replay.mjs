import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..');
const before=resolve(root,'outputs/mann-whole-source-current-recheck-2026-09-14');
const after=resolve(root,'outputs/mann-compound-headings-recheck-2026-09-14');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8');
const sources=new Map(parseCopy(sourceRaw,'vehicle_fluid_requirements').map(r=>[r.id,r]));
async function load(dir){
 const summaryRaw=await readFile(resolve(dir,'summary.json'),'utf8'),summary=JSON.parse(summaryRaw);
 assert.equal(summary.sourceHash,sha(sourceRaw));assert.equal(summary.processed,sources.size);
 const path=resolve(dir,'decisions.ndjson'),hash=createHash('sha256');
 for await(const chunk of createReadStream(path))hash.update(chunk);
 assert.equal(hash.digest('hex'),summary.decisionsHash);
 const map=new Map(),counts={};let count=0;
 for await(const line of createInterface({input:createReadStream(path),crlfDelay:Infinity})){
  const row=JSON.parse(line);assert.equal(row.originalSourceHash,sha(sources.get(row.requirementId)));assert.equal(row.publicationAllowed,false);counts[row.decision.status]=(counts[row.decision.status]??0)+1;
  assert.ok(!map.has(row.requirementId));count++;
  const make=row.decision.normalizedVehicle?.canonicalMake;
  map.set(row.requirementId,{effectiveSourceHash:row.effectiveSourceHash,decisionHash:sha(row.decision),status:row.decision.status,make,...(dir===after&&['FAW','EXEED','DAEWOO'].includes(make)?{decision:row.decision,identityReasons:row.identityReasons}:{})});
 }
 assert.equal(count,sources.size);assert.equal(map.size,sources.size);
 assert.deepEqual(counts,summary.statusCounts);
 return {summary,map,summaryHash:sha(summaryRaw)};
}
const old=await load(before),current=await load(after);
assert.equal(current.summary.mannHash,old.summary.mannHash);
assert.equal(current.summary.mannHash,sha(await readFile('/tmp/mann_filter_applications.sql','utf8')));
assert.deepEqual(current.summary.identityOverlay,old.summary.identityOverlay);
for(const [file,hash]of Object.entries(current.summary.codeHashes))assert.equal(hash,sha(await readFile(resolve(root,file),'utf8')));
assert.equal(current.summary.planHash,sha(await readFile(current.summary.planPath,'utf8')));
const findings=[],transitions={};let unchanged=0;
for(const [id,row]of current.map){
 const previous=old.map.get(id);assert.ok(previous);assert.equal(row.effectiveSourceHash,previous.effectiveSourceHash);
 const changed=row.decisionHash!==previous.decisionHash;
 if(!changed){unchanged++;continue;}
 const make=row.make;
 assert.ok(['FAW','EXEED','DAEWOO'].includes(make),`Unexpected change outside declared brands: ${id} ${make}`);
 const transition=`${previous.status} -> ${row.status}`;transitions[transition]=(transitions[transition]??0)+1;
 findings.push({sourceRequirementId:id,originalSource:sources.get(id),make,transition,oldDecisionHash:previous.decisionHash,decision:row.decision,identityReasons:row.identityReasons,publicationAllowed:false});
}
const recovered=findings.filter(f=>f.transition.startsWith('MANN_CATALOG_GAP ->')&&f.decision.topCandidates.length);
const report={beforeSummaryHash:old.summaryHash,afterSummaryHash:current.summaryHash,sourceHash:sha(sourceRaw),planHash:current.summary.planHash,checked:sources.size,unchanged,changed:findings.length,transitions,recoveredCandidateSources:recovered.length,recoveredByMake:Object.fromEntries([...Map.groupBy(recovered,f=>f.make)].map(([k,v])=>[k,v.length])),recoveredStrongIdentity:recovered.filter(f=>!f.identityReasons.length).length,findings,productionApplyAllowed:false,limitation:'Retrieval repair, not verified fluid publication. All source engines, power, dates, market and technical conditions still require scope checks. Existing canonical revisions are unchanged.'};
await writeFile(resolve(after,'verified-impact-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,findings:undefined}));
