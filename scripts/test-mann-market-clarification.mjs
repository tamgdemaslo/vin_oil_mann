import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
import {resolve} from 'node:path';
const j=createJiti(import.meta.url,{alias:{'@':resolve(import.meta.dirname,'../src')}});
const {mannTechnicalContextFromVehicle:context,unsupportedVehicleMarketLabels:labels,canConfirmVehicleDestinationMarket:missing}=await j.import('../src/lib/mann-technical-request-context.ts');
const base={makeRaw:'MITSUBISHI',modelRaw:'OUTLANDER',sourceMethods:['manual'],market:'ex.NA',marketEvidence:{values:['ex.NA']},countryOfOrigin:'Russia'};
const proof={sourceLabels:['ex.NA'],evidenceReference:'Заводская комплектация: документ 123'};
const before=JSON.stringify(base);assert.deepEqual(labels(base),['ex.NA']);assert.equal(missing(base),false);
assert.equal(context(base).confirmedMarket,undefined);assert.equal(context(base,{confirmedMarket:'RU'}).confirmedMarket,undefined);
assert.equal(context(base,{confirmedMarket:'RU',marketClarification:proof}).confirmedMarket,'RU');assert.equal(JSON.stringify(base),before);
for(const marketEvidence of [{values:['RU','US']},{values:['RU','ex.NA']},{values:['US','NA']}]){const v={...base,market:undefined,marketEvidence};assert.deepEqual(labels(v),[]);assert.equal(context(v,{confirmedMarket:'RU',marketClarification:{...proof,sourceLabels:marketEvidence.values}}).confirmedMarket,undefined);}
assert.equal(context(base,{confirmedMarket:'RU',marketClarification:{...proof,sourceLabels:['NA']}}).confirmedMarket,undefined);
assert.equal(context(base,{confirmedMarket:'RU',marketClarification:{...proof,evidenceReference:'да'}}).confirmedMarket,undefined);
assert.equal(context({...base,market:'NA',marketEvidence:{values:['NA']}},{confirmedMarket:'RU',marketClarification:proof}).confirmedMarket,undefined);
assert.equal(context({...base,market:'US',marketEvidence:{values:['US']}},{confirmedMarket:'RU',marketClarification:proof}).confirmedMarket,'US');
assert.equal(context({...base,market:undefined,marketEvidence:{values:[]}},{confirmedMarket:'JP'}).confirmedMarket,'JP');
assert.equal(context(base,{confirmedMarket:'RU',marketClarification:{...proof,evidenceReference:'x'.repeat(501)}}).confirmedMarket,undefined);
console.log('PASS: explicit document-based unknown-market clarification only; no origin inference, decoded mutation, stale-label reuse or known conflict override.');
