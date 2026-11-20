import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';
const mock=resolve('scripts/fixtures/mann-fluid-research-mocks.mjs');
const j=createJiti(import.meta.url,{alias:{'@':resolve('src'),'@/lib/db':mock,'@/lib/openai-client':mock,'@/lib/branch-api':mock}});
const { prisma }=await j.import('./fixtures/mann-fluid-research-mocks.mjs');
const { bindRequestTenantStore }=await j.import('../src/lib/request-tenant-store.ts');
bindRequestTenantStore({mode:'branch',branchId:'branch1',organizationId:'org1',allowedBranchIds:['branch1']});
prisma.productMannLink={findMany:async()=>[]};
prisma.localProduct={findMany:async()=>[]};
prisma.$queryRaw=async()=>[];
const { normalizePartsApiMannCard,partsApiCatalogMonth }=await j.import('../src/lib/partsapi-mann-normalization.ts');
const { lookupVehicle,toVehicle }=await j.import('../src/lib/vehicle-identity.ts');
const { tronkClient }=await j.import('../src/lib/integrations/tronk/client.ts');
const { resolveMannVehicle,canAutomaticallySelectMann }=await j.import('../src/lib/mann-vehicle-resolver.ts');
const { reviewedMannRows }=await j.import('../src/lib/mann-reviewed-applications.ts');
const { mannTechnicalContextFromVehicle }=await j.import('../src/lib/mann-technical-request-context.ts');
const { POST }=await j.import('../src/app/api/mann-catalog/technical-profile/route.ts');
const { missingMannFluids }=await j.import('../src/lib/mann-fluid-research.ts');
const { quoteRequirementChoices }=await j.import('../src/lib/maintenance-quote.ts');
const vin='WDB2030451A000001';
// Anonymized recorded characteristics; the original response stays private.
const payload=JSON.parse(await readFile(new URL('./fixtures/partsapi-mercedes-c200-kompressor.json',import.meta.url),'utf8'));
const normalized=normalizePartsApiMannCard(payload.result['0'],vin);
assert.equal(normalized.vinMatches,false);
assert.equal(normalized.returnedVin,'WDB2030451A000002');
assert.equal(normalized.vehicle.Modification,'C 200 Kompressor (203.045)');
assert.deepEqual(normalized.vehicle.ManufacturerTypeCodes,['203.045']);
assert.equal(normalized.vehicle.CatalogMonthFrom,'2000-05');
assert.equal(normalized.vehicle.CatalogMonthTo,'2002-06');
assert.equal(partsApiCatalogMonth('200013'),undefined);

const state=globalThis.fluidResearchTest={applications:[],rows:[],sources:[],requirements:[],links:[],calls:0,payload:{items:[],systems:[],unresolved:[]}};
prisma.vehicleLookupCache={create:async()=>({id:'fixture-cache'}),updateMany:async()=>({count:1}),findFirst:async()=>null};
prisma.vehicleModelAlias={findMany:async()=>[]};
prisma.mannVehicleVariant={findMany:async()=>[]};
prisma.vehicleMannMapping={findMany:async()=>[]};
const findApplications=prisma.mannFilterApplication.findMany;
prisma.mannFilterApplication.findMany=async args=>args.where.makeNormalized ? state.applications : findApplications(args);
let partsCalls=0,tronkCalls=0;
globalThis.fetch=async url=>{assert.equal(url.origin,'https://api.partsapi.ru');assert.equal(url.searchParams.get('vin'),vin);partsCalls++;return Response.json(payload);};
process.env.PARTSAPI_VINDECODE_KEY='fixture-not-a-secret';
tronkClient.decodeVinPrimary=async()=>{tronkCalls++;return {ok:true,method:'vindecode',durationMs:1,providerRequestId:null,data:{decode:{Reports:[
 {Data:{Brand:'MERCEDES-BENZ',Model:'C-Klasse',Generation:'III',BodyName:'W203',Modification:'C180',EngineSeries:'M111.951',EngineVolume:{Ccm:1998,L:2}}},
 {Data:{Brand:'MERCEDES-BENZ',Model:'C-Klasse',Generation:'III',BodyName:'W203',Modification:'C200K',EngineSeries:'M111.955',EngineVolume:{Ccm:1998,L:2},EnginePower:{KW:120,PS:163.15}}}
]}}};};
tronkClient.decodeVinExtended=async()=>({ok:false,method:'vindecode2',durationMs:1,code:'provider',message:'no data'});
const result=await lookupVehicle({organizationId:'org1',inputType:'vin',input:vin,refresh:true});
assert.equal(partsCalls,1);assert.equal(tronkCalls,0,'PartsAPI catalogue VIN mismatch must not trigger TRONK');
assert.deepEqual(result.sourceMethods,['partsapi_vindecode']);
assert.equal(result.vehicle.vin,vin);
assert.equal(result.vehicle.engineCode,undefined,'missing PartsAPI engine code is resolved from the MANN modification, not invented by the decoder');
assert.equal(result.vehicle.year,undefined);
const resolution=await resolveMannVehicle({organizationId:'org1',vehicle:result.vehicle});
assert.equal(resolution.status,'resolved',JSON.stringify(resolution.candidates));
assert.equal(resolution.usedManualMapping,false);
assert.equal(resolution.selection.confirmedByUser,false);
assert.deepEqual(resolution.filters.map(row=>row.mannArticle),['HU 727/1 x','C 47 109','WK 720','CUK 3461']);
const { normalizeMannArticle } = await j.import('../src/lib/mann-catalog.ts');
for (const filter of resolution.filters) assert.equal(filter.mannArticleNormalized, normalizeMannArticle(filter.mannArticle), 'supplemental filters must use the warehouse article key, preserving meaningful slashes');
assert.equal(resolution.selectedApplication.technicalIdentity.engineCode,'M111.955');
const candidate=resolution.selectedApplication;
assert.equal(canAutomaticallySelectMann(result.vehicle,[candidate,{...candidate,applicationId:'other',score:candidate.score-1}]),false,'ties must remain ambiguous');
assert.equal(canAutomaticallySelectMann(result.vehicle,[{...candidate,mismatchedFields:['мощность']}]),false);

// A genuinely VIN-consistent PartsAPI response follows the same matcher without
// TRONK. This is an explicit synthetic transport case, not the recorded payload.
payload.result['0'].vin=vin;
const direct=await lookupVehicle({organizationId:'org1',inputType:'vin',input:vin,refresh:true});
assert.equal(tronkCalls,0);
assert.equal(direct.sourceMethods[0],'partsapi_vindecode');
assert.equal(direct.vehicle.modificationName,'C 200 Kompressor (203.045)');
assert.equal(direct.vehicle.year,undefined);
const directResolution=await resolveMannVehicle({organizationId:'org1',vehicle:direct.vehicle});
assert.equal(directResolution.status,'resolved');
// Configured PartsAPI remains the only VIN provider for ambiguous or failed responses.
const originalFetch=globalThis.fetch;
const alternate={...payload.result['0'],typeName:'C 180 (203.035)',motorCodes:['M111.951'],powerHpFrom:129,powerHpTo:129};
globalThis.fetch=async()=>Response.json({result:[payload.result['0'],alternate]});
const ambiguousParts=await lookupVehicle({organizationId:'org1',inputType:'vin',input:vin,refresh:true});
assert.equal(ambiguousParts.candidates.length,2,'keep separate PartsAPI modifications');
assert.equal(tronkCalls,0,'ambiguity must not trigger another VIN provider');
globalThis.fetch=async()=>new Response('',{status:503});
const unavailableParts=await lookupVehicle({organizationId:'org1',inputType:'vin',input:vin,refresh:true});
assert.equal(unavailableParts.status,'unavailable');assert.equal(tronkCalls,0);
globalThis.fetch=async()=>Response.json({result:[]});
const emptyParts=await lookupVehicle({organizationId:'org1',inputType:'vin',input:vin,refresh:true});
assert.equal(emptyParts.status,'not_found');assert.equal(tronkCalls,0);
globalThis.fetch=originalFetch;

assert.equal(directResolution.selectedApplication.applicationId,candidate.applicationId);
const vehicleContext=mannTechnicalContextFromVehicle(result.vehicle,{},candidate);
assert.match(vehicleContext.generation,/W203/);
const input={variantKeys:candidate.variantIds,vehicleContext};
const request=async body=>{
 const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...input,...body})}));
 assert.equal(response.status,200);return response.json();
};
process.env.OPENAI_API_KEY='fixture-not-a-real-key';
const source={sourceUrl:'https://example.com/manual',sourceTitle:'Test manual (fixture)',excerpt:'Test-only evidence, not a vehicle recommendation.'};
state.payload={items:[{...source,systemCode:'ENGINE_COOLANT',specification:'TEST-COOLANT',volumeText:'9 л, сервисная замена'}],systems:[],unresolved:[]};
const initial=await request({});
assert.equal(quoteRequirementChoices(initial,null).automaticVolume,'7');
assert.deepEqual(quoteRequirementChoices(initial,null).specifications,['MB 229.5']);
assert.equal((await request({researchMissing:true,researchGroup:'basic'})).status,'saved');
assert.equal(state.calls,1);assert.equal(state.links.length,1);
const saved=await request({});
assert.equal(saved.items.find(i=>i.systemCode==='ENGINE_COOLANT').specifications[0],'TEST-COOLANT');
const gaps=missingMannFluids(saved);
assert.equal(gaps.some(g=>g.systemCode==='ENGINE_COOLANT'),false);
assert.equal(gaps.find(g=>g.systemCode==='ENGINE_OIL').viscosity,true);
state.payload={items:[
 {...source,systemCode:'ENGINE_OIL',specification:'MB 229.5; SAE 5W-40',volumeText:'999 л, с фильтром'},
 {...source,systemCode:'BRAKE_FLUID',specification:'TEST-BRAKE',volumeText:'1 л, сервисная замена'}
],systems:[],unresolved:[]};
await request({researchMissing:true,researchGroup:'basic'});
assert.equal(state.calls,2);
const researched=JSON.parse(state.request.input);
assert.equal(researched.missing.some(g=>g.systemCode==='ENGINE_COOLANT'),false,'existing DB fluid is not searched again');
assert.equal(researched.missing.find(g=>g.systemCode==='ENGINE_OIL').volume,false,'known capacity is not replaced');
assert.equal(state.requirements.find(r=>r.systemCode==='ENGINE_OIL').fillVolumeText,null,'unexpected AI capacity is discarded');
assert.ok(state.links.every(link=>link.mannVariantKey===candidate.variantId));
delete process.env.OPENAI_API_KEY;
const reloaded=await request({});
assert.equal(quoteRequirementChoices(reloaded,null).automaticVolume,'7');
assert.deepEqual(quoteRequirementChoices(reloaded,null).viscosities,['5W-40']);
assert.ok(reloaded.items.some(i=>i.systemCode==='BRAKE_FLUID'&&i.specifications[0]==='TEST-BRAKE'));
assert.equal((await request({researchMissing:true,researchGroup:'basic'})).status,'complete');
assert.equal(state.calls,2,'repeated selection reuses the DB without an API call');
assert.equal(reviewedMannRows().length,1);
console.log('PASS recorded PartsAPI card VIN mismatch accepted -> no TRONK -> exact MANN -> four filters -> DB first -> missing fields research -> linked persistence -> reload without AI');

if (process.env.MAINTENANCE_UI_FIXTURE_PATH) {
  const {writeFile}=await import('node:fs/promises');
  await writeFile(process.env.MAINTENANCE_UI_FIXTURE_PATH,JSON.stringify({lookup:result,resolution,initialProfile:saved,finalProfile:reloaded,
    research:{status:'saved',items:[{...source,systemCode:'ENGINE_OIL',specification:'5W-40',volumeText:''},{...source,systemCode:'BRAKE_FLUID',specification:'TEST-BRAKE',volumeText:'1 л, сервисная замена'}],systems:[],unresolved:['Модель установленной коробки не определена: требуется подтверждение.'],message:'Тестовый транспорт OpenAI: найденное сохранено.'}}));
}

const {mannFluidDisplayItems}=await j.import('../src/lib/mann-fluid-display.ts');
const display=mannFluidDisplayItems(reloaded.items);
assert.equal(display.catalogItems.filter(item=>item.systemCode==='ENGINE_OIL').length,1,'saved SAE must not create a second oil card');
assert.ok(display.researchItems.some(item=>item.systemCode==='ENGINE_OIL'&&item.specification==='5W-40'));
assert.equal(display.catalogItems.find(item=>item.systemCode==='ENGINE_OIL').capacities[0].nominalLiters,7);
const volumeOnly={...reloaded.items.find(item=>item.systemCode==='BRAKE_FLUID'),specifications:[],viscosityGrades:[],researchVolumeText:'1 л, сервисная замена'};
assert.ok(mannFluidDisplayItems([volumeOnly]).catalogItems.includes(volumeOnly),'volume-only cached discovery must remain visible');
console.log('PASS one fluid card after reload, retained verified volume and visible volume-only saved research');

// Existing structured MANN identity must supplement sparse PDF filter rows.
state.applications=[{vehicleVariantKey:'db-bmw',make:'BMW',makeNormalized:'BMW',model:'X6 (E71/E72)',modelNormalized:'X6 E71 E72',modelYears:null,vehicleText:'xDrive 35 i (E71)',effectiveVehicleText:'xDrive 35 i (E71)',engineCode:null,engineCodeNormalized:null,kw:null,hp:null,vehicleYears:null,vehicleYearFrom:null,vehicleYearTo:null,condition:null}];
prisma.mannVehicleVariant.findMany=async()=>[{key:'db-bmw',engineVolumeCc:2979,engineCode:'N54B30',powerKw:225,powerHp:306,fuelType:'gasoline',generation:null,bodyCodesJson:['E71']}];
prisma.mannFilterApplication.findFirst=async()=>null;
const bmw=normalizePartsApiMannCard({manuName:'BMW',modelName:'X6 (E71/E72)',typeName:'xDrive 35 i',motorCodes:['N54B30'],cylinderCapacityCcm:2979,powerKwFrom:225,powerKwTo:225,fuelType:'бензин'},'WBAFG410X0L197055');
const dbResolved=await resolveMannVehicle({organizationId:'org1',vehicle:toVehicle(bmw.vehicle,'partsapi_vindecode',{vin:'WBAFG410X0L197055'})});
assert.equal(dbResolved.status,'resolved',JSON.stringify(dbResolved.candidates));
assert.equal(dbResolved.selectedApplication.variantId,'db-bmw');
assert.equal(dbResolved.selectedApplication.technicalIdentity.engineCode,'N54B30');
assert.ok(dbResolved.selectedApplication.matchedFields.includes('объём двигателя'));
assert.ok(dbResolved.selectedApplication.matchedFields.includes('мощность'));
console.log('PASS structured MANN database fields enrich sparse filter rows before matching');

const {mannResearchEngineCode}=await j.import('../src/lib/mann-research-catalog.ts');
assert.equal(mannResearchEngineCode([{...reviewedMannRows()[0],engineCode:'M112.946/953'}],'M112.953'),'M112.953','research must use the same compressed engine-list normalization as MANN matching');

assert.equal(normalizePartsApiMannCard({manuName:'Mercedes-Benz',modelName:'C-Class',motorCodes:[{},null,123]},vin).vehicle.EngineCode,undefined);
assert.equal(normalizePartsApiMannCard({manuName:'Mercedes-Benz',modelName:'C-Class',motorCodes:['M111955','M 111.955']},vin).vehicle.EngineCodes.length,1,'equivalent engine spellings are not multiple engine alternatives');

// Exercise the production stock matcher with a real canonical slash-bearing key.
const { matchMannArticlesToLocalProducts } = await j.import('../src/lib/mann-catalog.ts');
const originalProducts = prisma.localProduct.findMany;
prisma.localProduct.findMany = async () => [{ id:'oil-stock', name:'MANN HU 727/1 x', brand:'MANN', article:'HU727/1X', code:null, oemParts:null, salePriceCents:10000, stockBalances:[] }];
const stockResults = await matchMannArticlesToLocalProducts({mannArticles:[resolution.filters[0]]});
assert.equal(stockResults[0].mannArticleNormalized,resolution.filters[0].mannArticleNormalized);
assert.equal(stockResults[0].bestMatch?.id,'oil-stock');
prisma.localProduct.findMany = originalProducts;
console.log('PASS supplemental oil filter joins the production warehouse matcher by canonical article');

// Broad historical mapping must not override a conflicting current engine/chassis.
state.applications.push({...state.applications[0],vehicleVariantKey:'wrong-bmw',model:'X6 (G06)',modelNormalized:'X6 G06',vehicleText:'xDrive 40 i (G06)',effectiveVehicleText:'xDrive 40 i (G06)',engineCode:'B58B30',engineCodeNormalized:'B58B30'});
const broadMapping={mannApplicationId:'wrong-bmw',normalizedGeneration:null,bodyCodesJson:[],yearFrom:null,yearTo:null,engineCode:null,engineFamily:null,engineVolumeCc:null,powerKw:null,powerHp:null,fuelType:null,driveType:null};
prisma.vehicleMannMapping.findMany=async()=>[broadMapping];
const protectedResolution=await resolveMannVehicle({organizationId:'org1',vehicle:toVehicle(bmw.vehicle,'partsapi_vindecode',{vin:'WBAFG410X0L197055'})});
assert.equal(protectedResolution.selectedApplication?.variantId,'db-bmw');
assert.equal(protectedResolution.usedManualMapping,false,'conflicting historical mappings are not authoritative');
prisma.vehicleMannMapping.findMany=async()=>[{...broadMapping,mannApplicationId:'db-bmw',engineCode:'N54B30'}];
const retainedConfirmation=await resolveMannVehicle({organizationId:'org1',vehicle:toVehicle(bmw.vehicle,'partsapi_vindecode',{vin:'WBAFG410X0L197055'})});
assert.equal(retainedConfirmation.usedManualMapping,true,'compatible genuine confirmations remain usable');
console.log('PASS saved mapping cannot override engine/chassis conflicts; compatible confirmations retained');

const {hasEngineOilServiceResearchVolume}=await j.import('../src/lib/maintenance-quote.ts');
assert.equal(hasEngineOilServiceResearchVolume('4,6 л — каталоговый основной объём; включение фильтра не указано'),false);
assert.equal(hasEngineOilServiceResearchVolume('4,4 л — замена с масляным фильтром'),true);
assert.equal(hasEngineOilServiceResearchVolume('4,4 л — общий объём'),false);
const unqualifiedVolume={...volumeOnly,systemCode:'ENGINE_OIL',specifications:['VW 502.00'],viscosityGrades:['5W-40'],capacities:[],researchVolumeText:'4,6 л — каталоговый основной объём; включение фильтра не указано'};
assert.equal(missingMannFluids({items:[unqualifiedVolume]}).find(g=>g.systemCode==='ENGINE_OIL').volume,true);
console.log('PASS unknown-filter main volume remains a missing service-with-filter field');

const reviewOnlyChoices=quoteRequirementChoices({items:[{...unqualifiedVolume,researchResult:true,requiresReview:true,sourceStatus:'catalog_preview'}]},null);
assert.ok(reviewOnlyChoices.specifications.includes('VW 502.00'),'reviewed-source facts remain visible as manual suggestions');
assert.equal(reviewOnlyChoices.automaticSpecification,'');
assert.equal(reviewOnlyChoices.automaticViscosity,'');
assert.equal(reviewOnlyChoices.automaticVolume,'');
assert.equal(quoteRequirementChoices(initial,null).automaticSpecification,'MB 229.5','verified reference still prefills');
console.log('PASS unverified discoveries never become default quote requirements');

prisma.vehicleMannMapping.findMany=async()=>[{...broadMapping,mannApplicationId:'db-bmw'}];
const broadCompatible=await resolveMannVehicle({organizationId:'org1',vehicle:toVehicle(bmw.vehicle,'partsapi_vindecode',{vin:'WBAFG410X0L197055'})});
assert.equal(broadCompatible.usedManualMapping,false,'a make/model-only historical decision cannot select a variant');
prisma.vehicleMannMapping.findMany=async()=>[{...broadMapping,mannApplicationId:'db-bmw',engineCode:'N54B30'}];
const missingEngine=toVehicle({...bmw.vehicle,EngineCode:undefined,EngineCodes:[],EngineSeries:undefined},'partsapi_vindecode',{vin:'WBAFG410X0L197055'});
assert.equal((await resolveMannVehicle({organizationId:'org1',vehicle:missingEngine})).usedManualMapping,false,'missing current engine does not satisfy a saved engine constraint');
console.log('PASS mapping requires present positive discriminators rather than missing-field wildcards');
