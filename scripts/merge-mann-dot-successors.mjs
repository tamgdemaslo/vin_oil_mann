import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14'),path=resolve(dir,'plan.json'),reportPath=resolve(dir,'dot-merge-operations-v1.json');
const mode=process.argv[2],raw=await readFile(path,'utf8');
if(mode==='prepare'){
 const draftRaw=await readFile(resolve(dir,'dot-successors-v1.json'),'utf8');assert.equal(sha(draftRaw),'c916606557cf9bfcdc06d8a9403e9c4cdab5bed004e60c7ddd63d707888e48e5');
 const batch=JSON.parse(draftRaw),plan=JSON.parse(raw);assert.equal(sha(raw),batch.planHash);
 const operations=[],ids=new Map();
 const render=x=>JSON.stringify(x,null,2).split('\n').map(l=>'    '+l).join('\n')+',';
 for(const f of batch.findings){
  const old=plan.newRevisions.find(r=>r.id===f.originalRevisionId),next=batch.drafts.find(r=>r.id===f.successorId);assert.equal(sha(old),f.originalRevisionHash);
  const restored=structuredClone(next);restored.id=old.id;restored.semanticFingerprint=old.semanticFingerprint;delete restored.provenanceJson.dotTokenRepair;
  const dot=restored.technicalDataJson.specifications.filter(s=>s.type==='DOT');assert.equal(dot.length,1);assert.equal(dot[0].value,next.provenanceJson.dotTokenRepair.before+'+');dot[0].value=next.provenanceJson.dotTokenRepair.before;assert.deepEqual(restored,old);
  const fingerprint=sha({policy:next.provenanceJson.catalogPreviewPolicy,sourceRequirementId:next.sourceRequirementId,vehicleVariantKey:next.vehicleVariantKey,applicability:next.applicabilityJson,technicalData:next.technicalDataJson});
  assert.equal(next.semanticFingerprint,fingerprint);assert.equal(next.id,`mtar_${fingerprint.slice(0,24)}`);assert.equal(next.applyEligible,false);
  operations.push({from:render(old),to:render(next)});ids.set(old.id,next.id);
 }
 let actionCount=0;for(const a of plan.existingActions)if(ids.has(a.successorId)){operations.push({from:render(a),to:render({...a,successorId:ids.get(a.successorId)})});actionCount++;}
 assert.equal(ids.size,82);assert.equal(actionCount,13);
 const history={parentPlanHash:sha(raw),batchHash:sha(draftRaw),replacements:batch.findings.map(f=>({originalRevisionId:f.originalRevisionId,successorId:f.successorId})),updatedActionReferences:actionCount,publicationAllowed:false};
 const kind='  "kind": "PASSAT_INCLUSIVE_OFFLINE_PREVIEW",';
 operations.push({from:kind,to:kind+'\n'+JSON.stringify({dotTokenRepair:history},null,2).split('\n').slice(1,-1).join('\n')+','});
 for(const o of operations){assert.equal(raw.split(o.from).length,2);o.offset=raw.indexOf(o.from);}operations.sort((a,b)=>a.offset-b.offset);
 let current=raw;const groups=[];
 for(let i=0;i<operations.length;i+=6){const group=operations.slice(i,i+6),beforeHash=sha(current);for(const o of group)current=current.replace(o.from,o.to);groups.push({beforeHash,afterHash:sha(current),operations:group});}
 const updated=JSON.parse(current);assert.equal(new Set(updated.newRevisions.map(r=>r.id)).size,1932);
 const report={parentPlanHash:sha(raw),afterPlanHash:sha(current),batchHash:sha(draftRaw),revisions:82,actionReferences:13,otherRevisionsPreserved:1850,groups,productionApplyAllowed:false};
 await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,groups:groups.length}));
}else{
 const report=JSON.parse(await readFile(reportPath,'utf8'));
 if(mode==='patch'){
  const group=report.groups[Number(process.argv[3])];assert.ok(group);assert.equal(sha(raw),group.beforeHash);
  process.stdout.write('*** Begin Patch\n*** Update File: '+path+'\n'+group.operations.map(o=>'@@\n'+o.from.split('\n').map(l=>'-'+l).join('\n')+'\n'+o.to.split('\n').map(l=>'+'+l).join('\n')).join('\n')+'\n*** End Patch\n');
 }else if(mode==='verify'){
  assert.equal(sha(raw),report.afterPlanHash);let restored=raw;
  for(const g of [...report.groups].reverse())for(const o of [...g.operations].reverse()){assert.equal(restored.split(o.to).length,2);restored=restored.replace(o.to,o.from);}
  assert.equal(sha(restored),report.parentPlanHash);console.log(JSON.stringify({planHash:sha(raw),restorationVerified:true,revisions:82,otherRevisionsPreserved:1850,actionReferences:13}));
 }else throw new Error('Unknown mode');
}
