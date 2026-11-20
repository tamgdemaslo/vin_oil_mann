import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
const mock=resolve('scripts/fixtures/mann-fluid-research-mocks.mjs');
const j=createJiti(import.meta.url,{alias:{'@':resolve('src'),'@/lib/db':mock,'@/lib/openai-client':mock,'@/lib/branch-api':mock}});
const {researchMissingMannFluids:run,missingMannFluids}=await j.import('../src/lib/mann-fluid-research.ts');
const {POST}=await j.import("../src/app/api/mann-catalog/technical-profile/route.ts");
const {addMannResearchCatalogToProfile:read,persistMannResearchCatalog:persist}=await j.import('../src/lib/mann-research-catalog.ts');
const {prisma}=await j.import('./fixtures/mann-fluid-research-mocks.mjs');
const application={vehicleVariantKey:'key',make:'FORD',model:'Mondeo V',effectiveVehicleText:'2.5(CNG)',vehicleText:'2.5(CNG)',engineCode:'C25HDEX',vehicleYears:'05/15 ->',modelYears:null,kw:'110',hp:'150'};
const item={systemCode:'ENGINE_OIL',specification:'VW 504.00; SAE 5W-30',volumeText:'5 л. с фильтром',sourceUrl:'https://example.com/manual',sourceTitle:'Manual',excerpt:'Test excerpt'};
const profile={items:[],status:'none',transmissionOptions:[],containsCatalogPreview:false};
const input={organizationId:'org1',variantKeys:['key'],vehicleContext:{make:'FORD'},profile};
const reset=()=>globalThis.fluidResearchTest={applications:[application],rows:[],calls:0,payload:{items:[item],unresolved:[]}};
const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only-not-a-real-key';
try {
 let scoped=reset();
 scoped.applications=[{...application,engineCode:'B47D20A,B47D20B'}];
 const exact={...input,vehicleContext:{make:'FORD',engineCode:'B47D20A'}};
 assert.equal((await run(exact)).status,'saved');
 assert.equal(JSON.parse(scoped.request.input).vehicle.variants[0].engineCode,'B47D20A');
 assert.equal((await read({...input,engineCode:'B47D20A'})).items.length,1);
 assert.equal((await read({...input,engineCode:'B47D20B'})).items.length,0);
 assert.equal((await read(input)).items.length,0);
 let s=reset();
 assert.equal((await run(input)).status,'saved');
 assert.equal(s.sources.length,1);assert.equal(s.requirements.length,1);assert.equal(s.links.length,1);
 assert.equal(s.links[0].requirementId,s.requirements[0].id);
 assert.equal(s.requirements[0].sourceRowId,s.sources[0].id);
 assert.equal(s.links[0].mannVariantKey,'key');assert.equal(s.links[0].status,'review_required');
 await run(input);assert.equal(s.links.length,1,'repeated persistence is idempotent');assert.equal(s.calls,1);
 delete process.env.OPENAI_API_KEY;
 const loaded=await read(input);
 assert.equal(loaded.items[0].specifications[0],item.specification);
 assert.equal(loaded.items[0].researchVolumeText,item.volumeText);
 assert.equal(loaded.items[0].evidence[0].url,item.sourceUrl);
 assert.equal(loaded.items[0].automaticSelectionEligible,false);
 const response=await POST(new Request("http://localhost/api/mann-catalog/technical-profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({variantKeys:["key"]})}));
 assert.equal(response.status,200);assert.equal((await response.json()).items[0].researchVolumeText,item.volumeText,"profile API reads catalog directly");
 assert.equal(missingMannFluids(loaded).some(row=>row.systemCode==='ENGINE_OIL'),false);
 assert.equal((await run({...input,profile:loaded})).status,'unavailable');assert.equal(s.calls,1,'no AI request when service unavailable; saved fields remain visible');
 assert.equal((await read({...input,organizationId:'org2'})).items.length,0,'no organizational leak');
 assert.equal((await read({...input,transmissionType:'automatic'})).items.length,0,'different transmission must not reuse fluid scope');
 const verified={...loaded.items[0],researchResult:undefined,researchVolumeText:undefined,sourceStatus:'primary_source',specifications:['Verified'],viscosityGrades:['5W-30'],capacities:[{nominalLiters:4}],automaticSelectionEligible:true};
 assert.deepEqual((await read({...input,profile:{...profile,status:'active',items:[verified]}})).items,[verified],'AI cannot overwrite complete catalog data');
 const withOnlyTotal = {...profile,items:[{...verified,capacities:[{nominalLiters:8,serviceContext:'TOTAL'}]}]};
 assert.equal(missingMannFluids(withOnlyTotal).find(row=>row.systemCode==='ENGINE_OIL').volume,true);
 const withSavedServiceVolume = await read({...input,profile:withOnlyTotal});
 assert.equal(withSavedServiceVolume.items[1].researchVolumeText,item.volumeText);
 assert.equal(missingMannFluids(withSavedServiceVolume).some(row=>row.systemCode==='ENGINE_OIL'),false);
 const withoutViscosity={...verified,specifications:['VW 504.00'],viscosityGrades:[]};
 assert.equal(missingMannFluids({...profile,items:[withoutViscosity]}).find(row=>row.systemCode==='ENGINE_OIL').viscosity,true);
 const enriched=await read({...input,profile:{...profile,items:[withoutViscosity]}});
 assert.deepEqual(enriched.items[1].viscosityGrades,['5W-30']);
 assert.deepEqual(enriched.items[1].specifications,[]);
 // Simulate a legacy evidence row with an expired TTL and no linked catalog rows.
 s.sources=[];s.requirements=[];s.links=[];delete s.rows[0].facts.catalogMaterialized;s.rows[0].validUntil=new Date('2020-01-01');
 assert.equal((await read(input)).items.length,1);assert.equal(s.links.length,1);assert.equal(s.calls,1,'legacy evidence materialized without AI');
 // The catalog is sufficient even if the research ledger has been removed.
 s.rows=[];assert.equal((await read(input)).items[0].researchVolumeText,item.volumeText);
 // Saved source amounts must supplement unresolved text rather than being hidden by it.
 for(const unresolvedVolume of ['Объём не установлен','7,0 л — полный объём для МКПП; 8,6 л — полный объём для CVT']){
  s=reset();
  const existingCoolant={revisionId:'existing-coolant',systemCode:'ENGINE_COOLANT',systemLabel:'Охлаждающая жидкость',
   specifications:['NISSAN coolant'],viscosityGrades:[],capacities:[],researchVolumeText:unresolvedVolume,
   sourceStatus:'catalog_preview',requiresReview:true,automaticSelectionEligible:false,userConfirmedTransmission:false,
   evidence:[{url:'https://example.com/original',title:'Original conditional source'}]};
  const before={...profile,status:'catalog_preview',items:[existingCoolant],containsCatalogPreview:true};
  assert.equal(missingMannFluids(before).find(g=>g.systemCode==='ENGINE_COOLANT').volume,true);
  const resolvedCoolant={...item,systemCode:'ENGINE_COOLANT',specification:'',volumeText:'7 л',sourceUrl:'https://example.com/resolved-coolant'};
  await prisma.$transaction(tx=>persist(tx,{organizationId:input.organizationId,variantKeys:input.variantKeys,
   applications:[application],evidenceId:'manual-coolant-evidence',sourceKind:'manual_source_review',items:[resolvedCoolant]}));
  const supplemented=await read({...input,profile:before,materializeSaved:false});
  assert.equal(supplemented.items.length,2,'unresolved existing coolant text must not suppress a saved resolved amount');
  assert.deepEqual(supplemented.items[0],existingCoolant,'original conditional source remains visible unchanged');
  assert.equal(supplemented.items[1].researchVolumeText,'7 л');
  assert.ok(supplemented.items.every(row=>row.requiresReview===true&&row.automaticSelectionEligible===false),'neither source is promoted or automatically bound');
  assert.equal(supplemented.items[1].evidence[0].url,resolvedCoolant.sourceUrl);
  assert.equal(missingMannFluids(supplemented).some(g=>g.systemCode==='ENGINE_COOLANT'),false);
  assert.equal(s.calls,0,'reading persisted manual sources makes no provider call');
 }
 console.log('PASS unresolved coolant text does not suppress saved resolved amounts; both sources stay review-only');
 process.env.OPENAI_API_KEY='test-only-not-a-real-key';
 s=reset();s.failCatalog=true;
 const failed=await run(input);assert.equal(failed.errorCode,'storage');
 assert.equal(s.sources,undefined);assert.equal(s.requirements,undefined);assert.equal(s.links,undefined,'failed links roll back source and requirement writes');
 assert.equal(s.rows[0].status,'failed');
 s=reset();
 s.failCatalogRead=true;
 const w203Response=await POST(new Request("http://localhost/api/mann-catalog/technical-profile", {
   method:"POST", headers:{"Content-Type":"application/json"},
   body:JSON.stringify({variantKeys:["key"],vehicleContext:{model:"C-Klasse III (W203)",engineCode:"M271.940"}}),
 }));
 assert.equal(w203Response.status,200);
 assert.equal((await w203Response.json()).items[0].capacities[0].nominalLiters,5.5);
 console.log('PASS linked catalog persistence, repeat read without AI, legacy promotion, deduplication, scope, verified precedence, transaction rollback');
}finally{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
