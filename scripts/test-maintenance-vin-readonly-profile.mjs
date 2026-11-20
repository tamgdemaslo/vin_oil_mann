import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {createMaintenanceVinProfileLoader} from './lib/maintenance-vin-profile.mjs';
const mock=resolve('scripts/fixtures/mann-fluid-research-mocks.mjs');
const j=createJiti(import.meta.url,{alias:{'@':resolve('src'),'@/lib/db':mock,'@/lib/openai-client':mock}});
const {prisma}=await j.import(mock);
const {addMannResearchCatalogToProfile,persistMannResearchCatalog}=await j.import('../src/lib/mann-research-catalog.ts');
const profile={items:[],status:'none',transmissionOptions:[],containsCatalogPreview:false};
const application={vehicleVariantKey:'key',make:'FORD',model:'Focus III',vehicleText:'1.6',engineCode:'ABC'};
const context={make:'FORD',engineCode:'ABC',year:2012,confirmedMarket:'EU'};
const s=globalThis.fluidResearchTest={applications:[application],rows:[],calls:0};
await prisma.$transaction(tx=>persistMannResearchCatalog(tx,{organizationId:'org1',variantKeys:['key'],applications:[application],engineCode:'ABC',vehicleContext:context,evidenceId:'fixture',sourceKind:'manual_source_review',items:[{systemCode:'ENGINE_OIL',specification:'TEST',volumeText:'5 л с фильтром',sourceUrl:'https://example.com/manual',sourceTitle:'Fixture',excerpt:'Fixture'}]}));
const originalTransaction=prisma.$transaction,originalFetch=globalThis.fetch;
let writes=0,fetches=0,catalogReads=0;
prisma.$transaction=async()=>{writes++;throw Error('Read-only loader must not materialize saved evidence');};
globalThis.fetch=async()=>{fetches++;throw Error('No fetch permitted');};
try{
 const load=createMaintenanceVinProfileLoader({organization:'org1','match-only':true},{getMannUnifiedTechnicalProfile:async()=>profile,withMannEngineOilReference:p=>p,addMannResearchCatalogToProfile:async input=>{catalogReads++;assert.equal(input.materializeSaved,false);return addMannResearchCatalogToProfile(input);}});
 assert.equal((await load(['key'],context)).items.length,1,'read-only path actually loads compatible saved research');
 const other=await load(['key'],{...context,year:2013});assert.equal(other.items.length,0);assert.match(other.notice,/комплектации/,'read-only audit sees v4 scope rejection notice');
 delete s.links[0].evidenceJson.scopeVersion;
 const legacy=await load(['key'],context);assert.equal(legacy.items.length,0);assert.match(legacy.notice,/комплектации/,'legacy source remains stored but does not fill scoped gaps');
 assert.equal(s.links.length,1);assert.equal(catalogReads,3);assert.equal(writes,0);assert.equal(fetches,0);assert.equal(s.calls,0);
 let executeInput;
 await createMaintenanceVinProfileLoader({organization:'org1'},{getMannUnifiedTechnicalProfile:async()=>profile,withMannEngineOilReference:p=>p,addMannResearchCatalogToProfile:async input=>{executeInput=input;return input.profile;}})(['key'],context);
 assert.equal(Object.hasOwn(executeInput,'materializeSaved'),false,'execute retains default materialization behavior');
 console.log('PASS actual batch profile loader reads v4 catalog in match-only, reports legacy/incompatible scope, 0 writes/fetch/provider; execute default retained');
}finally{prisma.$transaction=originalTransaction;globalThis.fetch=originalFetch;}
