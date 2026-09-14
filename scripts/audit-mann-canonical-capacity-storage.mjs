import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const raw=await readFile(resolve(dir,'plan.json'),'utf8');assert.equal(sha(raw),'31f8407dde303ca792f858299a5c40282a4079d65b9e8a9a8e020941e8411c5c');const plan=JSON.parse(raw);
const priorRaw=await readFile(resolve(dir,'unspecified-service-capacity-audit-v1.json'),'utf8'),prior=JSON.parse(priorRaw);assert.equal(prior.planHash,sha(raw));
const ids=new Set(prior.findings.map(f=>f.sourceRequirementId)),cachedFields=[],qualifiers={},affected=[];
function scan(value,path,id){if(!value||typeof value!=='object')return;for(const [k,v]of Object.entries(value)){
 if(['serviceVolumeLiters','fillVolumeMaxLiters','totalVolumeLiters'].includes(k))cachedFields.push({revisionId:id,path:`${path}.${k}`,value:v});
 if(k==='qualifier')qualifiers[v]=(qualifiers[v]??0)+1;
 scan(v,`${path}.${k}`,id);
}}
for(const r of plan.newRevisions){scan(r.technicalDataJson,'technicalDataJson',r.id);if(ids.has(r.sourceRequirementId))affected.push(r.id);}
assert.equal(cachedFields.length,0);assert.equal(affected.length,prior.affectedCandidateRevisions);
const codeFiles=['src/lib/mann-unified-technical-profile.ts','src/lib/mann-capacity-label.ts','src/components/shipment/VehicleLookupPanel.tsx'];
const report={kind:'CANONICAL_CAPACITY_STORAGE_AUDIT',planHash:sha(raw),priorAuditHash:sha(priorRaw),checked:plan.newRevisions.length,flaggedImportedSourceRevisions:affected.length,cachedScalarFieldsInTechnicalData:cachedFields,qualifiers,codeHashes:Object.fromEntries(await Promise.all(codeFiles.map(async p=>[p,sha(await readFile(resolve(root,p),'utf8'))]))),productionApplyAllowed:false,limitation:'Canonical technical data does not use the legacy service/max scalar fields. This does not prove source capacity type, OEM correctness, condition selection, or actual production records. Do not bulk-null these independently stored capacity arrays.'};
await writeFile(resolve(dir,'canonical-capacity-storage-audit-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
