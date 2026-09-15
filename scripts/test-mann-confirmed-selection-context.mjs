import assert from 'node:assert/strict';
import {createJiti} from 'jiti';
const j=createJiti(import.meta.url,{alias:{'@':new URL('../src',import.meta.url).pathname}});
const {normalizeDecodedVehicleForTest:normalize,rankMannCandidatesForTest:rank}=await j.import('../src/lib/mann-vehicle-resolver.ts');
const {mannTechnicalContextFromVehicle:context}=await j.import('../src/lib/mann-technical-request-context.ts');
const {mannConfirmableEngineCodes:codes}=await j.import('../src/lib/mann-confirmable-engine-codes.ts');
assert.deepEqual(codes('CAXA'),['CAXA']);assert.deepEqual(codes('CBZA, CBZB'),['CBZA','CBZB']);
assert.deepEqual(codes('M271.820/860'),['M271.820','M271.860']);
assert.deepEqual(codes('1AZ-FE/FSE'),['1AZFE','1AZFSE']);
for(const raw of ['ALL','2.0T','2.0','AWD','CBZA,','CBZA (86 hp)','CBZA AND ALWAYS SOMETHING','TURBO','CBZA / unknown'])assert.deepEqual(codes(raw),[],raw);
const vehicle={makeRaw:'Toyota',modelRaw:'Allion',year:2013,sourceMethods:['manual']};
const row={vehicleVariantKey:'test-allion',make:'TOYOTA',makeNormalized:'TOYOTA',model:'Allion II',modelNormalized:'ALLION II',modelYears:'2007-2021',
 vehicleText:'1.8',effectiveVehicleText:'1.8',engineCode:'2ZR-FAE',engineCodeNormalized:'2ZRFAE',kw:'105',hp:'143',vehicleYears:'06/07-12/21',vehicleYearFrom:2007,vehicleYearTo:2021,condition:null};
const candidate=rank(normalize(vehicle),[row])[0];assert.ok(candidate);
assert.deepEqual(candidate.technicalIdentity,{engineCode:'2ZRFAE',generation:'II'});
const untouched=structuredClone(vehicle);
assert.equal(context(vehicle).engineCode,undefined);
assert.equal(context(vehicle).generation,undefined);
const selected=context(vehicle,{},candidate);
assert.equal(selected.engineCode,'2ZRFAE');assert.equal(selected.generation,'II');
assert.equal(selected.productionMonth,undefined);assert.equal(selected.confirmedDrive,undefined);assert.equal(selected.confirmedMarket,undefined);
assert.deepEqual(vehicle,untouched);
const existing={...vehicle,engineCode:'ORIGINAL',generationRaw:'I',productionMonth:'2013-06'};
assert.equal(context(existing,{},candidate).engineCode,'ORIGINAL');assert.equal(context(existing,{},candidate).generation,'I');
assert.equal(context(existing,{},candidate).productionMonth,'2013-06');
assert.equal(context(vehicle,{}, {...candidate,mismatchedFields:['двигатель']}).engineCode,undefined);
for(const engineCode of ['2ZR-FAE, 2ZR-FE','2ZR-FAE / 2ZR-FE','2.0',null,'2ZR-FAE (143 hp)']){
 const result=rank(normalize(vehicle),[{...row,engineCode,engineCodeNormalized:engineCode}])[0];
 assert.ok(result);assert.equal(result.technicalIdentity?.engineCode,undefined,engineCode);
}
const multi=rank(normalize(vehicle),[{...row,engineCode:'2ZR-FAE, 2ZR-FE'}])[0];
assert.deepEqual(multi.technicalIdentity.engineOptions,['2ZRFAE','2ZRFE']);
assert.equal(context(vehicle,{},multi).engineCode,undefined);
for(const code of multi.technicalIdentity.engineOptions)assert.equal(context(vehicle,{confirmedEngineCode:code},multi).engineCode,code);
for(const code of ['','WRONG','2ZR-FAE',undefined])assert.equal(context(vehicle,{confirmedEngineCode:code},multi).engineCode,undefined);
assert.equal(context({...vehicle,engineCode:'ORIGINAL'},{confirmedEngineCode:'2ZRFE'},multi).engineCode,'ORIGINAL');
assert.equal(context(vehicle,{confirmedEngineCode:'2ZRFE'},{...multi,mismatchedFields:['мощность']}).engineCode,undefined);
// One grouped candidate must not inherit generation evidence contradicted by
// another variant under the same display heading.
const volvoVehicle={makeRaw:'Volvo',modelRaw:'V60',year:2013,sourceMethods:['manual']};
const shared={...row,make:'VOLVO',makeNormalized:'VOLVO',model:'S60 II/V60',modelNormalized:'S60 II/V60',engineCode:'D5204T3',engineCodeNormalized:'D5204T3'};
assert.equal(rank(normalize(volvoVehicle),[shared])[0]?.technicalIdentity?.generation,undefined,'S60 generation must not become V60 generation');
console.log('PASS: confirmed single-engine identity fills missing fields only; no decoder mutation, inferred dates/equipment, multi-engine or cross-model generation selection.');
const {mannConfirmableEngineCodes:confirmableCodes}=await j.import('../src/lib/mann-confirmable-engine-codes.ts');
assert.deepEqual(confirmableCodes('PE-VPS'),['PEVPS']);
assert.deepEqual(confirmableCodes('PE-VPS, SH-VPTS'),['PEVPS','SHVPTS']);
for(const invalid of ['PE-VPS (155 hp)','PE-VPS /','PE-VPS / ALWAYS','FOR-OUR','ENGINE-CODE','DOHC-MPI','TSI','PE-VPS / DOHC-MPI'])assert.deepEqual(confirmableCodes(invalid),[]);
const {readFile}=await import('node:fs/promises');
const {parseCopy}=await import('./lib/mann-offline-scope.mjs');
const mazdaRows=parseCopy(await readFile('/tmp/mann_filter_applications.sql','utf8'),'mann_filter_applications').filter(r=>confirmableCodes(r.engineCode).some(code=>/^[A-Z]{5,}$/.test(code)));
assert.equal(mazdaRows.length,12);
for(const row of mazdaRows){
  assert.equal(row.make,'MAZDA');
  const v={makeRaw:row.make,modelRaw:row.model,year:row.vehicleYearFrom,powerHp:Number(row.hp)||undefined,sourceMethods:['manual']};
  const candidate=rank(normalize(v),[row])[0];assert.ok(candidate);
  const expected=confirmableCodes(row.engineCode);
  if(expected.length===1)assert.equal(context(v,{},candidate).engineCode,expected[0]);
  else {assert.equal(context(v,{},candidate).engineCode,undefined);assert.deepEqual(candidate.technicalIdentity.engineOptions,expected);}
}
console.log('PASS: 12 actual Mazda catalogue rows preserve literal engine identity; multi-engine lists remain explicit choices.');
