import {explicitGearboxList} from './mann-explicit-gearbox-list.mjs';
import {sha} from './mann-offline-scope.mjs';

// A contradiction blocks every involved source, not just a minority label.
// These are source consistency checks, not an authoritative gearbox catalogue.
export function gearboxSourceQuality(sources,componentParser,labelParser) {
 const systems=new Set(['AUTOMATIC_TRANSMISSION','MANUAL_TRANSMISSION','CVT_TRANSMISSION','ROBOT_TRANSMISSION','TRANSMISSION_GENERIC']);
 const evidence=[];
 for(const source of sources){
  if(!systems.has(source.systemCode))continue;
  const component=componentParser(source.componentModel);
  const models=explicitGearboxList(source.componentModel)??(component.kind==='model'?[component.model]:[]);
  const label=labelParser(source.systemNameRaw,source.componentModel);
  if(!Number.isInteger(label.transmissionGearCount))continue;
  for(const model of models)evidence.push({make:source.make,model,gearCount:label.transmissionGearCount,sourceRequirementId:source.id,sourceHash:sha(source),systemLabel:source.systemNameRaw,originalComponent:source.componentModel});
 }
 const conflicts=[...Map.groupBy(evidence,r=>`${r.make}:${r.model}`)].filter(([,rows])=>new Set(rows.map(r=>r.gearCount)).size>1)
  .map(([key,rows])=>({key,reason:'SOURCE_MODEL_GEAR_COUNT_CONFLICT',evidence:rows,publicationAllowed:false}));
 const heldBySource=new Map();
 for(const conflict of conflicts)for(const entry of conflict.evidence){
  const held=heldBySource.get(entry.sourceRequirementId)??[];
  if(!held.some(c=>c.key===conflict.key))held.push(conflict);
  heldBySource.set(entry.sourceRequirementId,held);
 }
 return {conflicts,heldBySource};
}
