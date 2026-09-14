import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {sha} from './lib/mann-offline-scope.mjs';
assert.ok(process.argv.length===2||(process.argv.length===3&&['--equipment','--transmission','--lists'].includes(process.argv[2])));
const equipment=process.argv[2]==='--equipment';
const lists=process.argv[2]==='--lists',transmission=lists||process.argv[2]==='--transmission',conditional=equipment||transmission;
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,lists?'outputs/mann-mercedes-transmission-preview-2026-09-14':transmission?'outputs/mann-mercedes-equipment-preview-2026-09-14':equipment?'outputs/mann-mercedes-bulk-preview-2026-09-14':'outputs/mann-mercedes-compressed-preview-2026-09-14');
const prefix=lists?'mercedes-transmission-list':transmission?'mercedes-transmission':equipment?'mercedes-equipment':'mercedes-bulk';
const condition=r=>transmission?{type:r.applicabilityJson.transmissionType,...(lists?{models:r.provenanceJson.explicitTransmissionModelList.models}:{model:r.applicabilityJson.componentModel}),gearCount:r.applicabilityJson.transmissionGearCount}:r.applicabilityJson.requiredEquipment;
const supplementRaw=await readFile(resolve(dir,`${prefix}-preview-supplement-v1.json`),'utf8'),auditRaw=await readFile(resolve(root,'outputs/mann-mercedes-compressed-preview-2026-09-14/mercedes-bulk-source-engine-recheck-v1.json'),'utf8');
const supplement=JSON.parse(supplementRaw),audit=JSON.parse(auditRaw);
if(conditional){const recheckRaw=await readFile(resolve(dir,lists?'mercedes-transmission-list-recheck-v1.json':transmission?'mercedes-bulk-transmission-recheck-v1.json':'mercedes-bulk-equipment-recheck-v1.json'),'utf8');assert.equal(supplement.auditHash,sha(recheckRaw));assert.equal(JSON.parse(recheckRaw).auditHash,sha(auditRaw));}
else assert.equal(supplement.auditHash,sha(auditRaw));
const ids=new Set(supplement.revisions.map(r=>r.sourceRequirementId)),pending=[],unsupported=[],sources=[];
const month=n=>`${Math.floor(n/12)}-${String(n%12+1).padStart(2,'0')}`;
let total=0,covered=0;
for(const result of audit.results.filter(r=>ids.has(r.sourceRequirementId))){
 const domain=new Set(),accepted=new Set();
 const candidates=supplement.revisions.filter(r=>r.sourceRequirementId===result.sourceRequirementId);
 if(conditional)assert.equal(new Set(candidates.map(r=>JSON.stringify(condition(r)))).size,1,'Partition must not union different equipment or transmission conditions');
 for(const branch of result.branches){
   const context=branch.recoveredEngineContext;
   if(!Number.isInteger(context.yearFrom)||!Number.isInteger(context.yearTo)||context.yearFrom>context.yearTo){unsupported.push({sourceRequirementId:result.sourceRequirementId,branch,publicationAllowed:false});continue;}
   for(const code of context.engineCodesJson){
     let start=null;
     for(let n=context.yearFrom*12;n<=context.yearTo*12+12;n++){
       const sentinel=n===context.yearTo*12+12;
       const key=`${code}:${month(n)}`;
       const found=!sentinel&&candidates.some(r=>r.applicabilityJson.matchedEngineScope.includes(code)&&month(n)>=r.applicabilityJson.window.intersection.from&&month(n)<=r.applicabilityJson.window.intersection.to);
       if(!sentinel){domain.add(key);if(found)accepted.add(key);}
       if(!sentinel&&!found&&start===null)start=n;
       if((sentinel||found)&&start!==null){pending.push({sourceRequirementId:result.sourceRequirementId,sourceHash:result.sourceHash,anchorRowId:branch.anchorRowId,matchedEngineScope:[code],window:{from:month(start),to:month(n-1)},reason:'UNCOVERED_SOURCE_ENGINE_MONTHS',publicationAllowed:false});start=null;}
     }
   }
 }
 for(const r of candidates){
   const w=r.applicabilityJson.window.intersection;
   for(const code of r.applicabilityJson.matchedEngineScope)for(let n=Number(w.from.slice(0,4))*12+Number(w.from.slice(5))-1;n<=Number(w.to.slice(0,4))*12+Number(w.to.slice(5))-1;n++)assert.ok(domain.has(`${code}:${month(n)}`),'Proposed scope outside original branch domain');
 }
 total+=domain.size;covered+=accepted.size;sources.push({sourceRequirementId:result.sourceRequirementId,total:domain.size,covered:accepted.size,pending:domain.size-accepted.size});
}
assert.equal(sources.length,ids.size);
const report={supplementHash:sha(supplementRaw),auditHash:sha(auditRaw),summary:{sources:sources.length,totalEngineMonths:total,coveredEngineMonths:covered,pendingEngineMonths:total-covered,pendingIntervals:pending.length,unsupportedBranches:unsupported.length},sources,pending,unsupported,productionApplyAllowed:false,
 limitation:conditional?'Exact engine/month coverage only conditional on each revision equipment or transmission conditions; does not confirm equipment on VIN or cover another configuration. Unrepresented sources and rejected candidates remain unresolved.':'Exact finite source-engine/year domain partition for represented sources; not OEM/date correctness. Other327-source records and six rejected candidates remain unresolved.'};
if(transmission)for(const entry of pending)entry.requiredTransmission=condition(supplement.revisions.find(r=>r.sourceRequirementId===entry.sourceRequirementId));
await writeFile(resolve(dir,`${prefix}-partition-v1.json`),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
