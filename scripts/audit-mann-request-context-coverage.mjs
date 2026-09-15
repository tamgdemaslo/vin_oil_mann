import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {sha,parseCopy} from './lib/mann-offline-scope.mjs';

// Measures missing decoder fields, not VIN accuracy or publication readiness.
const root=resolve(import.meta.dirname,'..');
const dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const confirmed=process.argv[2]==='--confirmed-selection';
assert.ok(process.argv.length===2 || (process.argv.length===3&&confirmed));
const raw=await readFile(resolve(dir,'plan.json'),'utf8');
assert.equal(sha(raw),'12a5a5563418358782de3d4ca4e3507b1ccc8bb3e5ff8651439755d961f4392f');
const plan=JSON.parse(raw),fixture=resolve(root,'scripts/fixtures/mann-profile-db-route-stubs.mjs');
const j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':fixture,'@/lib/branch-api':fixture}});
const {POST}=await j.import('../src/app/api/mann-catalog/technical-profile/route.ts');
const {mannTechnicalContextFromVehicle:contextFromVehicle}=await j.import('../src/lib/mann-technical-request-context.ts');
let rank,normalize,mapped;
if(confirmed){
  ({rankMannCandidatesForTest:rank,normalizeDecodedVehicleForTest:normalize}=await j.import('../src/lib/mann-vehicle-resolver.ts'));
  const mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
  assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
  mapped=Map.groupBy(parseCopy(mannRaw,'mann_filter_applications'),r=>r.vehicleVariantKey);
}
const state={calls:0,rows:plan.newRevisions.map(r=>({...r,createdAt:new Date('2026-09-15'),reviewDecisions:[],reviewConfirmed:false,
  run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{
    catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,
    transmissionTypeCountPolicy:r.provenanceJson.explicitTransmissionTypeCount?.policy,
    conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,
    conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,
    equipmentComponentDrivePolicy:r.provenanceJson.explicitComponentDriveCondition?.policy,
    equipmentModelPolicy:r.provenanceJson.explicitEquipmentModel?.policy,
    transmissionModelListPolicy:r.provenanceJson.explicitTransmissionModelList?.policy,
    automaticProductSelection:false}}}))};
globalThis[Symbol.for('mann-profile-db-route-test')]=state;
const cases=new Map(),findings=[];
for(const r of plan.newRevisions){
  const a=r.applicabilityJson,s=a.sourceVehicleScope,m=a.window?.intersection?.from;
  if(!s||!m||!a.matchedEngineScope?.length)continue;
  for(const engineCode of a.matchedEngineScope){
    const vehicle={makeRaw:s.make,modelRaw:s.model,generationRaw:s.generation,engineCode,year:Number(m.slice(0,4)),productionMonth:m,sourceMethods:['manual']};
    const key=JSON.stringify([r.vehicleVariantKey,vehicle]);
    cases.set(key,{variantKey:r.vehicleVariantKey,vehicle});
  }
}
try{
  for(const c of cases.values()){
    const results={};
    for(const mode of ['completeIdentity','withoutEngine','withoutGeneration','yearOnly']){
      const vehicle={...c.vehicle};
      if(mode==='withoutEngine')delete vehicle.engineCode;
      if(mode==='withoutGeneration')delete vehicle.generationRaw;
      if(mode==='yearOnly')delete vehicle.productionMonth;
      const normalized=confirmed?normalize(vehicle):undefined;
      const candidate=normalized?rank(normalized,mapped.get(c.variantKey)??[]).find(cand=>cand.variantIds.includes(c.variantKey)):undefined;
      const vehicleContext=contextFromVehicle(vehicle,{},candidate);
      const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:[c.variantKey],vehicleContext})}));
      assert.equal(response.status,200);
      const p=await response.json();
      assert.ok(p.items.every(i=>!i.automaticSelectionEligible));
      results[mode]={...(confirmed?{selectedIdentity:candidate?.technicalIdentity??null,vehicleContext}:{}),itemIds:p.items.map(i=>i.revisionId),systems:[...new Set(p.items.map(i=>i.systemCode))],
        vehicleDriveRequired:p.vehicleDriveRequired??false,rearAirConditioningRequired:p.rearAirConditioningRequired??false,
        transmissionOptions:p.transmissionOptions?.length??0};
    }
    const baseline=new Set(results.completeIdentity.itemIds);
    const lost=Object.fromEntries(['withoutEngine','withoutGeneration','yearOnly'].map(mode=>[mode,[...baseline].filter(id=>!results[mode].itemIds.includes(id))]));
    findings.push({...c,results,lost});
  }
  const summary={drafts:plan.newRevisions.length,variantKeys:new Set(plan.newRevisions.map(r=>r.vehicleVariantKey)).size,contexts:findings.length,routeCalls:state.calls,
    baselineNonempty:findings.filter(f=>f.results.completeIdentity.itemIds.length).length,
    lostContexts:Object.fromEntries(['withoutEngine','withoutGeneration','yearOnly'].map(mode=>[mode,findings.filter(f=>f.lost[mode].length).length])),
    completelyEmptyAfterLoss:Object.fromEntries(['withoutEngine','withoutGeneration','yearOnly'].map(mode=>[mode,findings.filter(f=>f.lost[mode].length&&!f.results[mode].itemIds.length).length]))};
  const files=['src/components/shipment/VehicleLookupPanel.tsx','src/lib/mann-vehicle-resolver.ts','src/lib/mann-technical-request-context.ts','src/app/api/mann-catalog/technical-profile/route.ts','src/lib/mann-unified-technical-profile.ts'];
  const report={kind:'CURRENT_PLAN_REQUEST_CONTEXT_SENSITIVITY',planHash:sha(raw),summary,files:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),
    limitations:['Source-derived synthetic vehicle identities, not decoded VINs.','Actual request-context builder, route validation and profile query projection; authentication and DB stubbed.','Current drafts only; simulated completed staging, no publication or legacy merge.','No market, gearbox, drive or equipment confirmations inferred. CompleteIdentity means only make/model/generation/engine/date.','Counts are contexts, not approved vehicles, all fluids or source coverage.'],productionApplyAllowed:false,findings};
  if(confirmed){
    const before=JSON.parse(await readFile(resolve(dir,'request-context-coverage-v1.json'),'utf8'));
    assert.equal(before.planHash,report.planHash);
    assert.equal(before.findings.length,findings.length);
    for(let i=0;i<findings.length;i++){
      assert.deepEqual(JSON.parse(JSON.stringify(findings[i].vehicle)),before.findings[i].vehicle);
      assert.equal(findings[i].variantKey,before.findings[i].variantKey);
      assert.deepEqual(findings[i].results.completeIdentity.itemIds,before.findings[i].results.completeIdentity.itemIds);
      assert.deepEqual(findings[i].results.yearOnly.itemIds,before.findings[i].results.yearOnly.itemIds,'Never infer exact month from MANN interval');
    }
    report.beforeSummary=before.summary;
    report.limitations.push('Known target candidate explicitly selected from archived target rows; does not test global top-five retrieval or a real user selection.');
  }
  await writeFile(resolve(dir,confirmed?'request-context-confirmed-selection-v1.json':'request-context-coverage-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(summary));
}finally{delete globalThis[Symbol.for('mann-profile-db-route-test')];}
