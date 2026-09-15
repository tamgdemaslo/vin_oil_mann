import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-live-audit-1789469257907'),read=f=>JSON.parse(readFileSync(resolve(dir,f),'utf8'));
const audit=read('legacy-transmission-list-rematch-1789474027248.json'),raw=readFileSync(resolve(dir,'revisions.json'),'utf8');assert.equal(sha(raw),audit.liveHash);
const rows=JSON.parse(raw),decisions=read('reviewDecisions.json');
globalThis[Symbol.for('mann-profile-db-route-test')]={calls:0,rows:rows.map(r=>({...r,createdAt:new Date(r.createdAt),reviewDecisions:decisions.filter(d=>d.revisionId===r.id)}))};
const fixture=resolve(root,'scripts/fixtures/mann-vin-replay-stubs.mjs'),j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':fixture,'@/lib/branch-api':fixture}});
const saved=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Network forbidden');};
try{
 const {POST}=await j.import('../src/app/api/mann-catalog/technical-profile/route.ts');
 const findings=[];let calls=0;
 for(const f of audit.findings.filter(f=>f.otherSamePairRevisions.length)){
  assert.equal(f.otherSamePairRevisions.length,1);const r=rows.find(r=>r.id===f.otherSamePairRevisions[0].id),s=r.applicabilityJson;
  const base={...s.sourceVehicleScope,engineCode:s.matchedEngineScope[0],productionMonth:s.window.intersection.from,transmissionGearCount:s.transmissionGearCount};
  const models=r.provenanceJson.explicitTransmissionModelList.models;
  const cases=[...models.map(transmissionModel=>({name:transmissionModel,patch:{transmissionModel},expected:true})),{name:'missing_model',patch:{},expected:false},{name:'wrong_model',patch:{transmissionModel:'WRONG123'},expected:false},{name:'missing_engine',patch:{transmissionModel:models[0],engineCode:undefined},expected:false},{name:'missing_date',patch:{transmissionModel:models[0],productionMonth:undefined},expected:false}];
  const results=[];
  for(const c of cases){calls++;const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:[r.vehicleVariantKey],transmissionType:s.transmissionType,vehicleContext:{...base,...c.patch}})}));assert.equal(response.status,200);const p=await response.json();const item=p.items.find(i=>i.revisionId===r.id);assert.equal(!!item,c.expected,`${r.id} ${c.name}`);if(item)assert.equal(item.automaticSelectionEligible,false);assert.equal(p.items.some(i=>i.revisionId===f.revisionId),false);results.push({name:c.name,successorVisible:!!item,oldHidden:true});}
  findings.push({oldRevisionId:f.revisionId,successorRevisionId:r.id,results});
 }
 assert.equal(findings.length,8);
 const remaining=audit.findings.filter(f=>!findings.some(x=>x.oldRevisionId===f.revisionId)).map(f=>({revisionId:f.revisionId,make:f.make,model:f.model,engine:f.engine,classification:f.classification}));assert.equal(remaining.length,16);
 const output=resolve(dir,`legacy-list-successor-proof-${Date.now()}.json`);const report={kind:'PERSISTED_LEGACY_LIST_SUCCESSOR_ROUTE_PROOF',liveHash:sha(raw),calls,alreadyCoveredPairs:8,findings,remaining,limitations:['Actual POST handler against snapshot-backed database/auth stubs, not live HTTP.','Source-derived synthetic contexts, not actual VIN completeness.','No production or source writes.']};writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,calls,alreadyCoveredPairs:8,remaining},null,2));
}finally{globalThis.fetch=saved;delete globalThis[Symbol.for('mann-profile-db-route-test')];}
