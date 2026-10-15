import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
const mock=resolve('scripts/fixtures/mann-fluid-research-mocks.mjs');
const j=createJiti(import.meta.url,{alias:{'@':resolve('src'),'@/lib/db':mock,'@/lib/openai-client':mock,'@/lib/branch-api':mock}});
const {researchMissingMannFluids:run,missingMannFluids}=await j.import('../src/lib/mann-fluid-research.ts');
const {POST}=await j.import("../src/app/api/mann-catalog/technical-profile/route.ts");
const {addMannResearchCatalogToProfile:read}=await j.import('../src/lib/mann-research-catalog.ts');
const application={vehicleVariantKey:'key',make:'FORD',model:'Mondeo V',effectiveVehicleText:'2.5(CNG)',vehicleText:'2.5(CNG)',engineCode:'C25HDEX',vehicleYears:'05/15 ->',modelYears:null,kw:'110',hp:'150'};
const item={systemCode:'ENGINE_OIL',specification:'TEST',volumeText:'5 л. с фильтром',sourceUrl:'https://example.com/manual',sourceTitle:'Manual',excerpt:'Test excerpt'};
const profile={items:[],status:'none',transmissionOptions:[],containsCatalogPreview:false};
const input={organizationId:'org1',variantKeys:['key'],vehicleContext:{make:'FORD'},profile};
const reset=()=>globalThis.fluidResearchTest={applications:[application],rows:[],calls:0,payload:{items:[item],unresolved:[]}};
const previous=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only-not-a-real-key';
try {
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
 const verified={...loaded.items[0],researchResult:undefined,researchVolumeText:undefined,sourceStatus:'primary_source',specifications:['Verified'],capacities:[{nominalLiters:4}],automaticSelectionEligible:true};
 assert.deepEqual((await read({...input,profile:{...profile,status:'active',items:[verified]}})).items,[verified],'AI cannot overwrite complete catalog data');
 // Simulate a legacy evidence row with an expired TTL and no linked catalog rows.
 s.sources=[];s.requirements=[];s.links=[];delete s.rows[0].facts.catalogMaterialized;s.rows[0].validUntil=new Date('2020-01-01');
 assert.equal((await read(input)).items.length,1);assert.equal(s.links.length,1);assert.equal(s.calls,1,'legacy evidence materialized without AI');
 // The catalog is sufficient even if the research ledger has been removed.
 s.rows=[];assert.equal((await read(input)).items[0].researchVolumeText,item.volumeText);
 process.env.OPENAI_API_KEY='test-only-not-a-real-key';
 s=reset();s.failCatalog=true;
 const failed=await run(input);assert.equal(failed.errorCode,'storage');
 assert.equal(s.sources,undefined);assert.equal(s.requirements,undefined);assert.equal(s.links,undefined,'failed links roll back source and requirement writes');
 assert.equal(s.rows[0].status,'failed');
 console.log('PASS linked catalog persistence, repeat read without AI, legacy promotion, deduplication, scope, verified precedence, transaction rollback');
}finally{if(previous===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previous;}
