import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const fixture=new URL('./fixtures/mann-market-route-stubs.mjs',import.meta.url).pathname;
const jiti=createJiti(import.meta.url,{moduleCache:false,alias:{'@':new URL('../src',import.meta.url).pathname,'@/lib/branch-api':fixture,'@/lib/mann-unified-technical-profile':fixture}});
const {POST}=await jiti.import('../src/app/api/mann-catalog/technical-profile/route.ts');
for(const market of ['RU','JP','US','KR','AE','EU','SOUTHEAST_ASIA',undefined,'DE','Japan','jp','RU,JP',null,{},true]){
 const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:['test-variant'],vehicleContext:{confirmedMarket:market}})}));
 const allowed=market===undefined||['RU','JP','US','KR','AE','EU','SOUTHEAST_ASIA'].includes(market);
 assert.equal(response.status,allowed?200:400,JSON.stringify(market));
 if(allowed)assert.equal((await response.json()).vehicleContext.confirmedMarket,market);
}
console.log('Actual technical-profile route schema accepts exact market codes only (auth/database stubbed, not production HTTP)');
for(const componentModel of ['01R','TY21C',undefined,'01r','- 01R','LSD','01R / 0BD',null,{}]){
 const confirmation={circuit:'REAR_DIFFERENTIAL',drive:'4WD',componentModel};
 const response=await POST(new Request('http://localhost/api/mann-catalog/technical-profile',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantKeys:['test-variant'],vehicleContext:{confirmedEquipment:[confirmation]}})}));
 const allowed=componentModel===undefined||['01R','TY21C'].includes(componentModel);
 assert.equal(response.status,allowed?200:400);
 if(allowed)assert.deepEqual((await response.json()).vehicleContext.confirmedEquipment,JSON.parse(JSON.stringify([confirmation])));
}
console.log('Exact equipment model request field preserved; malformed codes rejected');
