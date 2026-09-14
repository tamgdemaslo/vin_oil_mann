import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';
import {explicitGearboxList} from './lib/mann-explicit-gearbox-list.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-mercedes-transmission-preview-2026-09-14');
const sourceRaw=await readFile('/tmp/vehicle_fluid_requirements.sql','utf8'),planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
const auditRaw=await readFile(resolve(root,'outputs/mann-mercedes-equipment-preview-2026-09-14/mercedes-bulk-transmission-recheck-v1.json'),'utf8');
const plan=JSON.parse(planRaw),audit=JSON.parse(auditRaw),sources=parseCopy(sourceRaw,'vehicle_fluid_requirements'),byId=new Map(sources.map(r=>[r.id,r]));
assert.equal(plan.inputHashes.source,sha(sourceRaw));assert.equal(audit.sourceHash,sha(sourceRaw));
const jiti=createJiti(import.meta.url,{alias:{'@':resolve(root,'src')}});
const {parseFluidCapacities}=await jiti.import('../src/lib/fluid-capacity-parser.ts');
const {extractFluidSourceSystemContext}=await jiti.import('../src/lib/fluid-source-system-context.ts');
const {mannTransmissionComponent}=await jiti.import('../src/lib/mann-transmission-component.ts');
for(const [key,file] of [['matcherHash','mann-fluid-matcher-v2.ts'],['resolverHash','mann-vehicle-resolver.ts'],['componentParserHash','mann-transmission-component.ts'],['labelParserHash','fluid-source-system-context.ts']])assert.equal(audit[key],sha(await readFile(resolve(root,'src/lib',file),'utf8')));
const gearboxSystems=new Set(['AUTOMATIC_TRANSMISSION','MANUAL_TRANSMISSION','CVT_TRANSMISSION','ROBOT_TRANSMISSION','TRANSMISSION_GENERIC']);
const modelEvidence=[];
for(const s of sources.filter(s=>gearboxSystems.has(s.systemCode))){
 const component=mannTransmissionComponent(s.componentModel),models=explicitGearboxList(s.componentModel)??(component.kind==='model'?[component.model]:[]);
 const label=extractFluidSourceSystemContext(s.systemNameRaw,s.componentModel);
 if(!Number.isInteger(label.transmissionGearCount))continue;
 for(const model of models)modelEvidence.push({make:s.make,model,gearCount:label.transmissionGearCount,sourceRequirementId:s.id,sourceHash:sha(s),systemLabel:s.systemNameRaw,originalComponent:s.componentModel});
}
const countConflicts=[...Map.groupBy(modelEvidence,r=>`${r.make}:${r.model}`)].filter(([,rows])=>new Set(rows.map(r=>r.gearCount)).size>1).map(([key,evidence])=>({key,evidence,reason:'SAME_SOURCE_MODEL_DIFFERENT_GEAR_COUNTS',publicationAllowed:false}));
const conflictingModels=new Set(countConflicts.map(r=>r.key));
const lists=sources.filter(s=>gearboxSystems.has(s.systemCode)&&explicitGearboxList(s.componentModel)).map(s=>({sourceRequirementId:s.id,sourceHash:sha(s),make:s.make,systemCode:s.systemCode,models:explicitGearboxList(s.componentModel),originalSource:s,capacity:parseFluidCapacities(s.fillVolumeText,s.systemCode),label:extractFluidSourceSystemContext(s.systemNameRaw,s.componentModel),publicationAllowed:false}));
const unresolved=audit.results.filter(r=>r.status==='REVIEW').map(r=>{
 const source=byId.get(r.sourceRequirementId);assert.equal(r.sourceHash,sha(source));
 const raw=source.componentModel??'',models=explicitGearboxList(raw);
 const category=models?'EXPLICIT_BULLET_MODEL_LIST':/серийн|с\/н/i.test(raw)?'SERIAL_NUMBER_CONDITION':/7\d{2}\.\d{1,2}(?!\d)/.test(raw)?'GEARBOX_FAMILY':r.component.kind==='conditions'?'ALIASES_OR_OTHER_COMPLEX_TEXT':'EXACT_MODEL_OTHER_MATCH_BLOCKER';
 const otherReasons=r.reasons.filter(reason=>reason!=='GEARBOX_FAMILY_LIST_OR_SERIAL_CONDITION');
 if((models??[]).some(model=>conflictingModels.has(`${source.make}:${model}`)))otherReasons.push('SOURCE_MODEL_GEAR_COUNT_CONFLICT');
 return {sourceRequirementId:source.id,sourceHash:sha(source),category,models,originalComponent:raw,sourceSystemLabel:source.systemNameRaw,otherReasons,
   nextAction:models&&!otherReasons.length?'RECHECK_EXACT_MODEL_BRANCHES_WITH_ORIGINAL_TECHNICAL_PAYLOAD':'RETAIN_REVIEW',publicationAllowed:false};
});
assert.equal(unresolved.length,38);
const report={sourceHash:sha(sourceRaw),planHash:sha(planRaw),auditHash:sha(auditRaw),parserHash:sha(await readFile(resolve(root,'scripts/lib/mann-explicit-gearbox-list.mjs'),'utf8')),
 summary:{sourceRows:sources.length,explicitListSources:lists.length,explicitModelBranches:lists.reduce((n,r)=>n+r.models.length,0),unresolvedBranches:unresolved.length,categories:Object.fromEntries([...Map.groupBy(unresolved,r=>r.category)].map(([k,v])=>[k,v.length])),sourceModelGearCountConflicts:countConflicts.length,listOnlyBlockers:unresolved.filter(r=>r.nextAction==='RECHECK_EXACT_MODEL_BRANCHES_WITH_ORIGINAL_TECHNICAL_PAYLOAD').length},lists,unresolved,countConflicts,productionApplyAllowed:false,
 limitation:'Offline structural classification only. A listed code is not an installed VIN gearbox. No alias/family expansion, serial-condition removal or production parser changes. Candidate branches still need exact identity, horsepower, capacity and runtime verification.'};
await writeFile(resolve(dir,'gearbox-list-opportunities-v2.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report.summary));
