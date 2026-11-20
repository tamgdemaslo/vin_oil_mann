import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {createJiti} from 'jiti';
import {batchHash} from './lib/maintenance-vin-batch.mjs';
import {findManualSourceReplay} from './lib/maintenance-manual-source-replay.mjs';
const j=createJiti(import.meta.url,{alias:{'@':resolve('src')}});
const {mannResearchScope,mannResearchHasSpecificConditions}=await j.import('../src/lib/mann-research-scope.ts');
const original={organizationId:'org1',variantKeys:['key'],engineCode:'ABC',items:[{systemCode:'ENGINE_OIL',specification:'TEST',volumeText:'',sourceUrl:'https://example.com/manual',sourceTitle:'Fixture',excerpt:'Fixture'}]};
const legacyEvidenceId='manual-source:'+batchHash(JSON.stringify(original));
const scopedId=scope=>'manual-source:'+batchHash(JSON.stringify({...original,scope}));
const rows=[{id:legacyEvidenceId,organizationId:'org1'}];let writes=0,calls=0;
const tx={aIAgentTechnicalEvidence:{findFirst:async({where})=>rows.find(row=>row.id===where.id&&row.organizationId===where.organizationId),create:async()=>{writes++;throw Error('No writes during replay guard');}}};
const before=structuredClone(rows);
for(const context of [undefined,{}, {engineCode:'ABC'}]){
 const scope=mannResearchScope(context),result=await findManualSourceReplay(tx,{organizationId:'org1',evidenceId:scopedId(scope),legacyEvidenceId,hasSpecificConditions:mannResearchHasSpecificConditions(scope)});
 assert.equal(result.status,'LEGACY_SCOPE_REVIEW_REQUIRED');assert.equal(result.previous.id,legacyEvidenceId);
}
const explicit=mannResearchScope({year:2015,confirmedMarket:'RU',engineCode:'ABC'});
assert.equal(await findManualSourceReplay(tx,{organizationId:'org1',evidenceId:scopedId(explicit),legacyEvidenceId,hasSpecificConditions:mannResearchHasSpecificConditions(explicit)}),null,'genuinely new explicit configuration can create scoped evidence');
const current={id:scopedId(explicit),organizationId:'org1'};rows.push(current);
assert.equal((await findManualSourceReplay(tx,{organizationId:'org1',evidenceId:current.id,legacyEvidenceId,hasSpecificConditions:true})).status,'ALREADY_IMPORTED');
assert.equal(await findManualSourceReplay(tx,{organizationId:'org2',evidenceId:current.id,legacyEvidenceId,hasSpecificConditions:false}),null,'tenant isolation');
assert.deepEqual(rows.slice(0,1),before);assert.equal(writes,0);assert.equal(calls,0);
assert.equal(mannResearchHasSpecificConditions(mannResearchScope({rearAirConditioning:false})),true,'explicit false is a condition');
console.log('PASS legacy manual import repeat held without promotion/writes/provider; exact v4 idempotence, explicit scoped import and tenant isolation');
