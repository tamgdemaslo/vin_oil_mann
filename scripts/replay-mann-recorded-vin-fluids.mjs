import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {parseCopy,sha} from './lib/mann-offline-scope.mjs';
const root=resolve(import.meta.dirname,'..'),dir=resolve(root,'outputs/mann-gentra-evidence-review-2026-09-14');
const liveSnapshot=process.argv[2]==='--live-snapshot'?resolve(process.argv[3]??''):null;
const sx4=process.argv[2]==='--sx4-112'||Boolean(liveSnapshot);
const outlander=process.argv[2]==='--outlander-4b11'||sx4;
const recovered=process.argv[2]==='--recovered-nine'||outlander;
const logan=process.argv[2]==='--logan'||recovered;
const tepee=process.argv[2]==='--current-v13'||logan;
const qualifierCleanup=process.argv[2]==='--qualifier-cleanup'||tepee;
const marketOptions=process.argv[2]==='--market-options'||qualifierCleanup;
const priority=process.argv[2]==='--current-v12'||marketOptions;
const engineOptions=process.argv[2]==='--engine-options'||priority;
const explain=process.argv[2]==='--explain-empty'||engineOptions;
assert.ok(process.argv.length===2||(process.argv.length===3&&explain&&!liveSnapshot)||(process.argv.length===4&&liveSnapshot));
const planRaw=await readFile(resolve(dir,'plan.json'),'utf8');
assert.equal(sha(planRaw),sx4?'8055983eb6f96501a987a0742f83ac4e50135664398509f15542e07584a1d1eb':outlander?'d313fa2b94d11aa7b183283a6a9c406838a99a627528a2e98c219265643c2292':recovered?'813977a2654f21eac4510323cd8491eb8be59a5bf8b25c38e15aaea9fad4c444':logan?'32431c5c77b2f9621576f414652657ed93e4d362ee49325af9276b6c0fa2c709':tepee?'244d1c661d1ac5d6943c1c9b97b41e4c4072847ca002ef6740b682d34cee3936':priority?'00c29d1d9f1f77436216938a8ab6484f3756830515a0f68b37f32ac193dd2bba':'12a5a5563418358782de3d4ca4e3507b1ccc8bb3e5ff8651439755d961f4392f');
const plan=JSON.parse(planRaw),mannRaw=await readFile('/tmp/mann_filter_applications.sql','utf8');
assert.equal(sha(mannRaw),'5e34efadc60014077b55655e0c62cdcbb8b1f44d3a8aace2399e941b45003fda');
const catalogState={rows:parseCopy(mannRaw,'mann_filter_applications'),aliasCalls:0,mappingCalls:0,catalogCalls:0};
const profileState={calls:0,rows:plan.newRevisions.map(r=>({...r,createdAt:new Date('2026-09-15'),reviewDecisions:[],reviewConfirmed:false,
  run:{status:'COMPLETED',mode:'STAGING',independentHumanSignoff:false,productionApplyAuthorized:false,gatesJson:{
    catalogPreviewPolicy:r.provenanceJson.catalogPreviewPolicy,transmissionTypeCountPolicy:r.provenanceJson.explicitTransmissionTypeCount?.policy,
    conditionalTransmissionPolicy:r.provenanceJson.conditionalTransmissionPolicy,conditionalEquipmentPolicy:r.provenanceJson.conditionalEquipmentPolicy,
    equipmentComponentDrivePolicy:r.provenanceJson.explicitComponentDriveCondition?.policy,equipmentModelPolicy:r.provenanceJson.explicitEquipmentModel?.policy,
    transmissionModelListPolicy:r.provenanceJson.explicitTransmissionModelList?.policy,automaticProductSelection:false}}}))};
if(liveSnapshot){
  const audit=JSON.parse(await readFile(resolve(liveSnapshot,'report.json'),'utf8'));
  assert.equal(audit.transaction.readOnly,'on');
  assert.equal(audit.sourceTables.mann_filter_applications.snapshotSha256,sha(mannRaw));
  for(const key of ['missing','added','changed'])assert.equal(audit.sourceTables.mann_filter_applications[key].length,0);
  const liveRows=JSON.parse(await readFile(resolve(liveSnapshot,'revisions.json'),'utf8'));
  const decisions=JSON.parse(await readFile(resolve(liveSnapshot,'reviewDecisions.json'),'utf8'));
  assert.equal(liveRows.length,audit.revisions);
  profileState.rows=liveRows.map(r=>({...r,createdAt:new Date(r.createdAt),reviewDecisions:decisions.filter(d=>d.revisionId===r.id)}));
}
globalThis[Symbol.for('mann-resolver-archive-test')]=catalogState;
globalThis[Symbol.for('mann-profile-db-route-test')]=profileState;
const fixture=resolve(root,'scripts/fixtures/mann-vin-replay-stubs.mjs');
const j=createJiti(import.meta.url,{moduleCache:false,alias:{'@':resolve(root,'src'),'@/lib/db':fixture,'@/lib/branch-api':fixture,'@/lib/integrations/tronk/client':fixture}});
const savedFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('Network forbidden during recorded VIN replay');};
const findings=[],inputHashes={plan:sha(planRaw),mann:sha(mannRaw)};
try{
  const {lookupVehicle}=await j.import('../src/lib/vehicle-identity.ts');
  const {resolveMannVehicle}=await j.import('../src/lib/mann-vehicle-resolver.ts');
  const {mannTechnicalContextFromVehicle:context,canConfirmVehicleDestinationMarket:canConfirmMarket}=await j.import('../src/lib/mann-technical-request-context.ts');
  const {VEHICLE_DESTINATION_MARKETS}=await j.import('../src/lib/vehicle-market.ts');
  const {POST}=await j.import('../src/app/api/mann-catalog/technical-profile/route.ts');
  const {mannTechnicalScopeMatches:matches}=await j.import('../src/lib/mann-technical-applicability.ts');
  for(const file of ['dataset-c.generation-2-traces.json','dataset-d.blind-traces.json']){
    const raw=await readFile(resolve(root,'outputs/mann-matching-private',file),'utf8');inputHashes[file]=sha(raw);
    const data=JSON.parse(raw);assert.equal(data.results.length,100);
    for(const sample of data.results){
      // Pseudonymous sample reference only. Never export VIN, plates, provider
      // payloads, input hashes or saved personal identifiers from private traces.
      const result={sampleRef:sha([file,sample.sampleId]).slice(0,16),dataset:file.startsWith('dataset-c')?'C':'D'};
      const trace=sample.providerTrace;
      if(!/^[A-HJ-NPR-Z0-9]{17}$/i.test(trace?.vin??'')){findings.push({...result,status:'NO_RECORDED_VIN'});continue;}
      const replayState={vin:trace.vin.toUpperCase(),trace,methods:[],discardedCacheWrites:0};
      globalThis[Symbol.for('mann-vin-recorded-replay')]=replayState;
      let lookup;
      try{lookup=await lookupVehicle({organizationId:`OFFLINE_REPLAY_${result.sampleRef}`,inputType:'vin',input:replayState.vin,refresh:true});}
      catch(error){if(error.code!=='RECORDED_ATTEMPT_MISSING')throw error;findings.push({...result,status:'REPLAY_INCOMPLETE',missingMethod:error.message.split(':')[1]});continue;}
      result.methods=replayState.methods;result.lookupStatus=lookup.status;
      if(!lookup.vehicle){findings.push({...result,status:'DECODE_NO_VEHICLE',failure:lookup.diagnostics.failureCode});continue;}
      // Preserve multiple decoded candidates; do not silently pick one report.
      const vehicles=lookup.candidates.map(c=>c.vehicle),evaluations=[];
      for(const vehicle of vehicles){
        const resolution=await resolveMannVehicle({organizationId:`OFFLINE_REPLAY_${result.sampleRef}`,vehicle});
        assert.notEqual(resolution.status,'resolved','No saved mappings supplied; no automatic candidate selection');
        const candidates=[];
        for(const candidate of resolution.candidates){
          const body={variantKeys:candidate.variantIds,vehicleContext:context(vehicle,{},candidate)};
          const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
          assert.equal(response.status,200);
          const p=await response.json();assert.ok(p.items.every(i=>!i.automaticSelectionEligible));
          const hiddenDrafts=[];
          if(explain)for(const r of (liveSnapshot?profileState.rows:plan.newRevisions).filter(r=>['ACTIVE','STAGED','REVIEW'].includes(r.state)&&candidate.variantIds.includes(r.vehicleVariantKey)&&!p.items.some(i=>i.revisionId===r.id))){
            const a=r.applicabilityJson,c=body.vehicleContext,reasons=[];
            if(r.provenanceJson.catalogPreviewEligible===false)reasons.push('PUBLICATION_ELIGIBILITY_HELD');
            for(const field of ['requiredVehicleDrive','requiredMarket','requiredTransmission','requiredEquipment','transmissionGearCount','matchedEngineScope','window']){
              if(field in a&&!matches({[field]:a[field]},c)){
                const missing={requiredVehicleDrive:!c.confirmedDrive,requiredMarket:!c.confirmedMarket,requiredTransmission:!c.confirmedTransmissionType,
                  requiredEquipment:!c.confirmedEquipment?.length,transmissionGearCount:!c.transmissionGearCount,matchedEngineScope:!c.engineCode,window:!c.year&&!c.productionMonth}[field];
                reasons.push(`${field}:${missing?'MISSING_CONTEXT':'OUTSIDE_OR_INVALID_SCOPE'}`);
              }
            }
            if(a.sourceVehicleScope){
              const {generation,...identity}=a.sourceVehicleScope;
              if(!matches({sourceVehicleScope:identity},c))reasons.push('MODEL_OR_MAKE_SCOPE_MISMATCH');
              else if(!matches({sourceVehicleScope:a.sourceVehicleScope},c))reasons.push(c.generation?'GENERATION_SCOPE_MISMATCH':'GENERATION_CONTEXT_MISSING');
            }
            if(!reasons.length)reasons.push('OTHER_PROFILE_GATE_OR_PRECEDENCE');
            hiddenDrafts.push({revisionId:r.id,systemCode:r.systemCode,reasons});
          }
          const engineChoices=[];
          if(engineOptions&&!vehicle.engineCode)for(const code of candidate.technicalIdentity?.engineOptions??[]){
            const request={variantKeys:candidate.variantIds,vehicleContext:context(vehicle,{confirmedEngineCode:code},candidate)};
            assert.equal(request.vehicleContext.engineCode,code);
            const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request)}));
            assert.equal(response.status,200);const profile=await response.json();
            assert.ok(profile.items.every(i=>!i.automaticSelectionEligible));
            engineChoices.push({engineCode:code,visibleRevisionIds:profile.items.map(i=>i.revisionId)});
          }
          const marketChoices=[];
          if(marketOptions && canConfirmMarket(vehicle) && plan.newRevisions.some(r=>candidate.variantIds.includes(r.vehicleVariantKey)&&r.applicabilityJson.requiredMarket)){
            for(const confirmedMarket of VEHICLE_DESTINATION_MARKETS)for(const confirmedEngineCode of [undefined,...(!vehicle.engineCode?candidate.technicalIdentity?.engineOptions??[]:[])]){
              const vehicleContext=context(vehicle,{confirmedMarket,confirmedEngineCode},candidate);
              assert.equal(vehicleContext.confirmedMarket,confirmedMarket);
              const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:candidate.variantIds,vehicleContext})}));
              assert.equal(response.status,200);const p=await response.json();assert.ok(p.items.every(i=>!i.automaticSelectionEligible));
              marketChoices.push({confirmedMarket,confirmedEngineCode,visibleRevisionIds:p.items.map(i=>i.revisionId),systems:[...new Set(p.items.map(i=>i.systemCode))]});
            }
          }
          const transmissionChoices=[];
          if(liveSnapshot)for(const option of p.transmissionOptions??[]){
            const ask=async details=>{
              const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,transmissionType:option.type,vehicleContext:{...body.vehicleContext,...details}})}));
              assert.equal(response.status,200);return response.json();
            };
            const base=await ask({});
            const probes=[{details:{},profile:base}];
            for(const transmissionGearCount of base.transmissionGearCountOptions??[]){
              const details={transmissionGearCount},profile=await ask(details);probes.push({details,profile});
              for(const transmissionModel of profile.transmissionComponentOptions??[])probes.push({details:{...details,transmissionModel},profile:await ask({...details,transmissionModel})});
            }
            for(const transmissionModel of base.transmissionComponentOptions??[])probes.push({details:{transmissionModel},profile:await ask({transmissionModel})});
            for(const {details,profile} of probes){
              assert.ok(profile.items.every(i=>!i.automaticSelectionEligible));
              transmissionChoices.push({type:option.type,...details,visibleRevisionIds:profile.items.map(i=>i.revisionId),systems:[...new Set(profile.items.map(i=>i.systemCode))]});
            }
          }
          candidates.push({variantIds:candidate.variantIds,confidence:candidate.confidence,...(liveSnapshot?{vehicleContext:body.vehicleContext,transmissionChoices}:{}),...(marketOptions?{marketChoices}:{}),...(engineOptions?{engineChoices}:{}),
            draftCount:plan.newRevisions.filter(r=>candidate.variantIds.includes(r.vehicleVariantKey)).length,
            visibleRevisionIds:p.items.map(i=>i.revisionId),systems:[...new Set(p.items.map(i=>i.systemCode))],
            vehicleDriveRequired:p.vehicleDriveRequired??false,rearAirConditioningRequired:p.rearAirConditioningRequired??false,
            transmissionOptions:p.transmissionOptions?.map(o=>o.type)??[],
            contextFields:Object.entries(body.vehicleContext).filter(([,v])=>v!==undefined).map(([k])=>k),...(explain?{hiddenDrafts}:{})});
        }
        evaluations.push({make:vehicle.makeCanonical??vehicle.makeRaw,model:vehicle.modelCanonical??vehicle.modelRaw,
          missingIdentity:['engineCode','generationRaw','productionMonth','year'].filter(k=>!vehicle[k]),resolution:resolution.status,candidates});
      }
      findings.push({...result,status:'REPLAYED',decodedCandidates:vehicles.length,evaluations});
    }
  }
  const replayed=findings.filter(f=>f.status==='REPLAYED');
  const summary={samples:findings.length,statusCounts:Object.fromEntries([...new Set(findings.map(f=>f.status))].map(s=>[s,findings.filter(f=>f.status===s).length])),
    samplesWithMannCandidates:replayed.filter(f=>f.evaluations.some(e=>e.candidates.length)).length,
    samplesWithAnyDraftCandidate:replayed.filter(f=>f.evaluations.some(e=>e.candidates.some(c=>c.draftCount))).length,
    samplesWithAnyVisibleCandidate:replayed.filter(f=>f.evaluations.some(e=>e.candidates.some(c=>c.visibleRevisionIds.length))).length,
    profileCalls:profileState.calls,catalogCalls:catalogState.catalogCalls};
  const files=['src/lib/mann-row-generation-evidence.ts','data/mann-sx4-generation-evidence-v1.json','src/lib/vehicle-identity.ts','src/lib/mann-vehicle-resolver.ts','src/lib/mann-technical-request-context.ts','src/app/api/mann-catalog/technical-profile/route.ts','src/lib/mann-unified-technical-profile.ts'];
  if(priority)files.push('src/lib/vehicle-normalization.ts','src/lib/mann-confirmable-engine-codes.ts','src/lib/mann-technical-applicability.ts','src/lib/mann-catalog.ts');
  if(explain){
    const counts={};
    for(const f of replayed){
      if(f.evaluations.some(e=>e.candidates.some(c=>c.visibleRevisionIds.length)))continue;
      const reasons=new Set(f.evaluations.flatMap(e=>e.candidates.flatMap(c=>c.hiddenDrafts.flatMap(r=>r.reasons))));
      for(const reason of reasons)counts[reason]=(counts[reason]??0)+1;
    }
    summary.emptyDraftSampleReasons=counts;
    const previous=JSON.parse(await readFile(resolve(dir,'recorded-vin-fluid-replay-v1.json'),'utf8'));
    for(const [key,value] of Object.entries(previous.summary))if(priority?['samples','statusCounts'].includes(key):(!engineOptions||!['samplesWithAnyVisibleCandidate','profileCalls'].includes(key)))assert.deepEqual(summary[key],value,'Preserve recorded decoding; retrieval can change only in current-v12 replay');
    if(engineOptions){
      summary.samplesWithAnyVisibleEngineChoice=replayed.filter(f=>f.evaluations.some(e=>e.candidates.some(c=>c.visibleRevisionIds.length||c.engineChoices.some(choice=>choice.visibleRevisionIds.length)))).length;
      summary.engineChoiceChecks=replayed.flatMap(f=>f.evaluations.flatMap(e=>e.candidates.flatMap(c=>c.engineChoices))).length;
    }
  }
  const report={kind:'RECORDED_PROVIDER_VIN_TO_CURRENT_DRAFT_PROFILE_REPLAY',inputHashes,summary,
    runtimeHashes:Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(resolve(root,f),'utf8'))]))),findings,
    limitations:['Recorded provider responses, not live VIN calls or authentication/browser/production validation.','Actual lookupVehicle and resolver; all DB/cache/provider calls intercepted, no network.','No saved model aliases or manual mappings; archived catalog and current draft rows only, simulated completed staging.','Every offered top-five candidate evaluated hypothetically after explicit confirmation; no candidate asserted correct or automatically selected.','No market/date/gearbox/equipment facts guessed. Any visible candidate is not all-fluid completeness.','Missing recorded attempts remain incomplete, never fabricated as provider failures.'],productionApplyAllowed:false};
  if(engineOptions)report.limitations.push('Engine choice outcomes are hypothetical explicit confirmations, not proof of the installed engine.');
  if(liveSnapshot){
    report.kind='RECORDED_PROVIDER_VIN_TO_PERSISTED_SNAPSHOT_PROFILE_REPLAY';
    report.inputHashes.persistedRevisions=sha(await readFile(resolve(liveSnapshot,'revisions.json'),'utf8'));
    report.inputHashes.persistedReviews=sha(await readFile(resolve(liveSnapshot,'reviewDecisions.json'),'utf8'));
    report.persistedRevisionCount=profileState.rows.length;
    summary.transmissionChoiceChecks=replayed.flatMap(f=>f.evaluations.flatMap(e=>e.candidates.flatMap(c=>c.transmissionChoices))).length;
    summary.samplesWithVisibleTransmissionChoice=replayed.filter(f=>f.evaluations.some(e=>e.candidates.some(c=>c.transmissionChoices.some(p=>p.systems.some(s=>s.endsWith('_TRANSMISSION')))))).length;
    report.limitations.push('Transmission type/model/gear choices are hypothetical choices offered by profile, never asserted installed. Missing dates/markets/engines are not filled. Hidden reasons cover all non-superseded snapshot rows.');
    report.limitations[2]='No saved model aliases or manual mappings; unchanged archived MANN catalog and persisted live revisions with actual run/review metadata. No staging simulation.';
  }
  if(marketOptions){
    summary.marketChoiceChecks=replayed.flatMap(f=>f.evaluations.flatMap(e=>e.candidates.flatMap(c=>c.marketChoices))).length;
    summary.samplesWithAnyVisibleMarketChoice=replayed.filter(f=>f.evaluations.some(e=>e.candidates.some(c=>c.visibleRevisionIds.length||c.engineChoices.some(choice=>choice.visibleRevisionIds.length)||c.marketChoices.some(choice=>choice.visibleRevisionIds.length)))).length;
    report.limitations.push('All supported destination choices are hypothetical user confirmations, not verified destinations or automatic VIN coverage. Choices are only offered for absent evidence; existing/conflicting labels unchanged.');
  }
  if(priority){
    const previousRaw=await readFile(resolve(dir,sx4?'recorded-vin-fluid-replay-v10.json':outlander?'recorded-vin-fluid-replay-v9.json':recovered?'recorded-vin-fluid-replay-v8.json':logan?'recorded-vin-fluid-replay-v7.json':tepee?'recorded-vin-fluid-replay-v6.json':qualifierCleanup?'recorded-vin-fluid-replay-v5.json':marketOptions?'recorded-vin-fluid-replay-v4.json':'recorded-vin-fluid-replay-v3.json'),'utf8'),previous=JSON.parse(previousRaw);
    if(marketOptions&&!qualifierCleanup)for(const key of ['samplesWithMannCandidates','samplesWithAnyDraftCandidate','samplesWithAnyVisibleCandidate','samplesWithAnyVisibleEngineChoice','catalogCalls','engineChoiceChecks'])assert.deepEqual(summary[key],previous.summary[key]);
    const before=new Map(previous.findings.map(f=>[f.sampleRef,f]));
    for(const f of findings){const old=before.get(f.sampleRef);assert.ok(old);for(const key of ['status','lookupStatus','decodedCandidates'])assert.deepEqual(f[key],old[key]);}
    const visible=f=>f.evaluations?.some(e=>e.candidates.some(c=>c.visibleRevisionIds.length))??false;
    report.previousReplay={hash:sha(previousRaw),summary:previous.summary,gainedVisibleSamples:findings.filter(f=>visible(f)&&!visible(before.get(f.sampleRef))).map(f=>f.sampleRef),lostVisibleSamples:findings.filter(f=>!visible(f)&&visible(before.get(f.sampleRef))).map(f=>f.sampleRef)};
  }
  await writeFile(liveSnapshot?resolve(liveSnapshot,'recorded-vin-fluid-transmission-replay.json'):resolve(dir,sx4?'recorded-vin-fluid-replay-v11.json':outlander?'recorded-vin-fluid-replay-v10.json':recovered?'recorded-vin-fluid-replay-v9.json':logan?'recorded-vin-fluid-replay-v8.json':tepee?'recorded-vin-fluid-replay-v7.json':qualifierCleanup?'recorded-vin-fluid-replay-v6.json':marketOptions?'recorded-vin-fluid-replay-v5.json':priority?'recorded-vin-fluid-replay-v4.json':engineOptions?'recorded-vin-fluid-replay-v3.json':explain?'recorded-vin-fluid-replay-v2.json':'recorded-vin-fluid-replay-v1.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(summary));
}finally{
  globalThis.fetch=savedFetch;
  for(const name of ['mann-resolver-archive-test','mann-profile-db-route-test','mann-vin-recorded-replay'])delete globalThis[Symbol.for(name)];
}
