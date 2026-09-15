import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
const dir='outputs/mann-live-audit-1789479529769',read=n=>JSON.parse(readFileSync(`${dir}/${n}.json`,'utf8'));
const audit=read('full-replacement-context-audit-1789480061007'),live=read('revisions'),drafts=read('skoda-service-scoped-drafts').newRevisions;
const j=createJiti(import.meta.url,{alias:{'@':resolve('src')}}),{buildMannUnifiedTechnicalProfile:profile}=await j.import('../src/lib/mann-unified-technical-profile.ts');
const findings=[];
for(const source of audit.findings){for(const ref of source.live){
 const r=live.find(x=>x.id===ref.id);assert.ok(r);const s=r.applicabilityJson??{};
 const context={...s.sourceVehicleScope,engineCode:s.matchedEngineScope?.[0]??source.engine,productionMonth:s.window?.intersection?.from,transmissionModel:r.provenanceJson?.explicitTransmissionModelList?.models?.[0]??r.componentModel,transmissionGearCount:s.transmissionGearCount};
 const rows=live.filter(x=>x.vehicleVariantKey===r.vehicleVariantKey).map(x=>({...x,createdAt:new Date(x.createdAt)}));
 const p=profile(rows,s.transmissionType,context),item=p.items.find(x=>x.revisionId===r.id);
 findings.push({id:r.id,sourceId:source.sourceId,model:source.model,engine:source.engine,state:r.state,scope:s,syntheticContext:context,visibleInSyntheticContext:!!item,shownCapacities:item?.capacities??null,hasPreparedSuccessor:drafts.some(d=>d.existingAssociation.revisionId===r.id),sourceText:source.raw});
}}
const summary={storedRevisions:findings.length,preparedSuccessors:findings.filter(r=>r.hasPreparedSuccessor).length,visibleSynthetic:findings.filter(r=>r.visibleInSyntheticContext).length,archived:findings.filter(r=>r.state==='SUPERSEDED').length};
const output=`${dir}/stored-service-contexts-${Date.now()}.json`;writeFileSync(output,JSON.stringify({summary,findings,productionChanged:false,limitations:['Synthetic contexts only; not installed VIN proof.','Hidden in this probe does not prove hidden for all contexts.','Existing scoped successors require a distinct reviewed correction policy; do not bypass old-row guards.']},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,summary}));
