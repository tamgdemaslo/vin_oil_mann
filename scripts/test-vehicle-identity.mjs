import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": new URL("../src", import.meta.url).pathname },
});
const {
  assessVehicleDecodeQuality,
  normalizeEngineCode,
  normalizeFrameInput,
  normalizePlateInput,
  normalizeVehicleMake,
  normalizeVehicleModel,
  normalizeVinInput,
  toVehicle,
} = await jiti.import("../src/lib/vehicle-identity.ts");

assert.equal(normalizeVinInput(" wba5e-7101 fg155636 "), "WBA5E7101FG155636");
assert.equal(toVehicle({Market:'Russia'},'tronk_vindecode').marketEvidence.confirmedMarket,'RU');
assert.equal(toVehicle({Market:'RU',market:'DE'},'tronk_vindecode').marketEvidence.confirmedMarket,undefined);
assert.equal(toVehicle({Market:'RU',vendor_detail:{market:'Europe'}},'tronk_vindecode').marketEvidence.confirmedMarket,undefined);
assert.equal(toVehicle({CountryOfOrigin:'RU',country:'Россия'},'tronk_vindecode').marketEvidence.confirmedMarket,undefined);
assert.equal(normalizeFrameInput(" zvw52-3030148 "), "ZVW523030148");
assert.deepEqual(normalizePlateInput("Т 332 ЕК 39"), { original: "Т 332 ЕК 39", normalized: "Т332ЕК39" });
assert.deepEqual(normalizePlateInput("T-744-KO-39"), { original: "T-744-KO-39", normalized: "Т744КО39" });
assert.equal(normalizeVehicleMake("Mercedes-Benz"), "MERCEDES");
assert.equal(normalizeVehicleMake("LandRover"), "LAND ROVER");
assert.equal(normalizeVehicleMake("VOLVO CARS"), "VOLVO");
assert.equal(normalizeVehicleMake("LADA (SHIGULI)"), "LADA");
assert.equal(normalizeVehicleMake("МИНИ"), "MINI");
assert.equal(normalizeVehicleMake("КРАЙСЛЕР"), "CHRYSLER");
assert.equal(normalizeVehicleMake("DS"), "DS AUTOMOBILES");
assert.equal(normalizeVehicleMake("LYNK @ CO"), "LYNK & CO");
assert.equal(normalizeEngineCode("B47 D20-A"), "B47D20A");
assert.equal(normalizeEngineCode("ВАЗ-21120"), "VAZ21120");
assert.deepEqual(normalizeVehicleModel("BMW 5 (G30, G31, F90)", "BMW"), {
  raw: "BMW 5 (G30, G31, F90)",
  canonical: "5",
  generation: undefined,
  bodyCode: "G30",
});
assert.deepEqual(normalizeVehicleModel("X-Trail", "NISSAN"), {
  raw: "X-Trail",
  canonical: "X-TRAIL",
  generation: undefined,
  bodyCode: undefined,
});
assert.equal(normalizeVehicleModel("AB Example", "TEST").bodyCode, "AB", "a leading alphabetic platform token is preserved separately from the model");
assert.equal(normalizeVehicleModel("РТ СRUISЕR LIMITED", "CHRYSLER").canonical, "PT CRUISER LIMITED");
assert.equal(normalizeVehicleModel("БЕЗ МОДЕЛИ 03", "LYNK & CO").canonical, "03");
assert.equal(normalizeVehicleModel("6 SERII", "BMW").canonical, "6");

const tronkExtendedVehicle = toVehicle({
  vin: "Z6FDXXEECDEG85039",
  year: 2014,
  human_name: "Седан",
  mark_info: { code: "FORD", en_name: "Ford", ru_name: "Форд" },
  model_info: { code: "MONDEO", en_name: "Mondeo", ru_name: "Мондео" },
  super_gen: { name: "V", year_from: 2014, year_to: 2019 },
  tech_param: { gear_type: "FORWARD_CONTROL", engine_type: "GASOLINE", transmission: "AUTOMATIC", displacement: 2488, power: 149, power_kvt: 110, human_name: "2.5 AT (149 л.с.)" },
}, "tronk_vindecode2", { vin: "Z6FDXXEECDEG85039" });
assert.equal(tronkExtendedVehicle.makeCanonical, "FORD");
assert.equal(tronkExtendedVehicle.modelCanonical, "MONDEO");
assert.equal(tronkExtendedVehicle.year, 2014);
assert.equal(tronkExtendedVehicle.engineVolumeCc, 2488);
assert.equal(tronkExtendedVehicle.engineVolumeLiters, 2.488);
assert.equal(tronkExtendedVehicle.powerHp, 149);
assert.equal(tronkExtendedVehicle.powerKw, 110);
assert.equal(tronkExtendedVehicle.transmissionName, "AUTOMATIC");
assert.equal(tronkExtendedVehicle.fuelType, "GASOLINE");
assert.equal(assessVehicleDecodeQuality(tronkExtendedVehicle).status, "complete");
assert.equal(assessVehicleDecodeQuality({ ...tronkExtendedVehicle, modelCanonical: undefined }).status, "insufficient");

const tronkPrimaryVehicle = toVehicle({
  Vin: "5TDDZRFH80S966117",
  Brand: "TOYOTA",
  Model: "Highlander",
  BodyName: "GSU55",
  Generation: "III",
  StartYear: "2016",
  FinishYear: "12.2019",
  FinishYear: "12.2019",
  Drive: "AWD",
  FuelType: ["PA"],
  EngineSeries: "2GR-FKS",
  EngineVolume: { L: 3.5, Ccm: 3456 },
  EnginePower: { KW: 220, PS: 299.12, Hp: 295.02 },
  CheckDigit: { Result: "passed" },
}, "tronk_vindecode", { vin: "5TDDZRFH80S966117" });
assert.equal(tronkPrimaryVehicle.makeCanonical, "TOYOTA");
assert.equal(tronkPrimaryVehicle.modelCanonical, "HIGHLANDER");
assert.equal(tronkPrimaryVehicle.generationRaw, "III");
assert.equal(tronkPrimaryVehicle.year, undefined);
assert.equal(tronkPrimaryVehicle.modelYearFrom, 2016);
assert.equal(tronkPrimaryVehicle.modelYearTo, 2019);
assert.equal(tronkPrimaryVehicle.engineVolumeLiters, 3.5);
assert.equal(tronkPrimaryVehicle.engineVolumeCc, 3456);
assert.equal(tronkPrimaryVehicle.powerHp, 299.12);
assert.equal(tronkPrimaryVehicle.powerKw, 220);
assert.equal(tronkPrimaryVehicle.driveType, "AWD");
assert.equal(tronkPrimaryVehicle.engineSeries, "2GRFKS");

const datedPrimaryVehicle = toVehicle({ Brand: "ŠKODA", Model: "Octavia", StartYear: "11.12.2012" }, "tronk_vindecode");
assert.equal(datedPrimaryVehicle.year, undefined);
assert.equal(datedPrimaryVehicle.modelYearFrom, 2012);

const combinedFallbackCases = [
  ["ЛЕНД РОВЕР DISCOVERY 3", "LAND ROVER", "DISCOVERY 3"],
  ["ХЕНДЭ IX55", "HYUNDAI", "IX55"],
  ["НИССАН КАШКАЙ", "NISSAN", "KASHKAI"],
  ["ОПЕЛЬ ВЕКТРА 1.8I 16V", "OPEL", "VEKTRA"],
];
for (const [providerModel, expectedMake, expectedModel] of combinedFallbackCases) {
  const fallbackVehicle = toVehicle({ model: providerModel, ModelYear: 2008 }, "tronk_convertb2b");
  assert.equal(fallbackVehicle.makeCanonical, expectedMake, `${providerModel} yields a canonical make`);
  assert.equal(fallbackVehicle.modelCanonical, expectedModel, `${providerModel} separates make/model and removes the powertrain suffix`);
  assert.equal(fallbackVehicle.year, 2008);
}

console.log("Vehicle identity normalization tests — passed");

// Exercise the shared lookup, including the paid-provider boundary, without a database or network.
const { lookupVehicle } = await jiti.import("../src/lib/vehicle-identity.ts");
const { tronkClient } = await jiti.import("../src/lib/integrations/tronk/client.ts");
const vin = "WBAFG410X0L197055";
const partsCard = {
  manuName: "BMW", modelName: "X6 (E71, E72)", typeName: "xDrive 35 i",
  motorCodes: ["N54B30O0"], cylinderCapacityCcm: 2979, powerKwFrom: 225,
  fuelType: "бензин", impulsionType: "привод на все колеса",
  yearOfConstrFrom: "200801", yearOfConstrTo: "201407",
};
process.env.PARTSAPI_VINDECODE_KEY = "test-key";
let calls = [];
let partsResponse;
globalThis.fetch = async (url) => {
  calls.push("partsapi");
  assert.equal(url.origin, "https://api.partsapi.ru");
  assert.equal(url.searchParams.get("method"), "VINdecode");
  assert.equal(url.searchParams.get("key"), "test-key");
  assert.equal(url.searchParams.get("lang"), "ru");
  assert.equal(url.searchParams.get("vin"), vin);
  return partsResponse();
};
const cache = globalThis.prisma.vehicleLookupCache;
cache.create = async () => ({ id: "test-cache" });
cache.updateMany = async () => ({ count: 1 });
tronkClient.decodeVinPrimary = async () => {
  calls.push("tronk");
  return {
    ok: true, method: "vindecode", durationMs: 1, providerRequestId: null,
    data: { decode: { Reports: [{ Data: {
      Brand: "BMW", Model: "X6", Year: 2012, EngineCode: "TEST-ENGINE",
      EngineVolumeLiters: 3.5, PowerHp: 290, FuelType: "gasoline",
    } }] } },
  };
};
tronkClient.decodeVinExtended = async () => {
  calls.push("tronk-extended");
  return { ok: false, method: "vindecode2", durationMs: 1, code: "provider", message: "no data" };
};

const lookupVin = (extended = false) => lookupVehicle({ organizationId: "test", inputType: "vin", input: vin, refresh: true, extended });
for (const [extended, resultCards] of [
  [false, [partsCard]],
  [true, { first: partsCard, duplicate: partsCard }],
  [false, [{ ...partsCard, powerKwFrom: undefined, motorCodes: [] }]],
]) {
  partsResponse = () => Response.json({ result: resultCards });
  calls = [];
  const result = await lookupVin(extended);
  assert.deepEqual(calls, ["partsapi"]);
  assert.equal(result.status, "found");
  assert.deepEqual(result.sourceMethods, ["partsapi_vindecode"]);
  assert.equal(result.vehicle.makeCanonical, "BMW");
  assert.equal(result.vehicle.modelCanonical, "X6");
  assert.equal(result.vehicle.engineVolumeCc, 2979);
  assert.equal(result.vehicle.driveType, "AWD");
  assert.equal(result.vehicle.year, undefined, "catalogue production start is not the vehicle build year");
  assert.equal(result.vehicle.modelYearFrom, 2008);
  assert.equal(result.vehicle.modelYearTo, 2014);
  assert.equal(result.diagnostics.fallbackUsed, false);
}

for (const [response, status, candidateCount] of [
  [() => Response.json({ result: [] }), 'not_found', 0],
  [() => Response.json({ result: [{ ...partsCard, modelName: "" }] }), 'not_found', 0],
  [() => Response.json({ result: [{ ...partsCard, vin: "WBAFG410X0L197056" }] }), 'found', 1],
  [() => Response.json({ result: [partsCard, { ...partsCard, motorCodes: ["N55B30"] }] }), 'found', 2],
  [() => new Response(null, { status: 503 }), 'unavailable', 0],
  [() => { throw new TypeError("PartsAPI offline"); }, 'unavailable', 0],
]) {
  partsResponse = response; calls = [];
  const result = await lookupVin();
  assert.deepEqual(calls, ["partsapi"], 'configured PartsAPI never switches VIN providers');
  assert.deepEqual(result.sourceMethods, ["partsapi_vindecode"]);
  assert.equal(result.status,status);assert.equal(result.candidates.length,candidateCount);
  assert.equal(result.diagnostics.fallbackUsed, false);
}
for (const [left, right, expected] of [
  [{motorCodes:['N54B30A','N54B30B']},{motorCodes:['N55B30A','N55B30B']},2],
  [{motorCodes:['N54B30A','N54B30B'],yearOfConstrFrom:'200801',yearOfConstrTo:'201001'},{motorCodes:['N54B30A','N54B30B'],yearOfConstrFrom:'201002',yearOfConstrTo:'201407'},2],
  [{motorCodes:['N54B30A','N54B30B']},{motorCodes:['N54B30B','N54B30A']},1],
]) {
  partsResponse=()=>Response.json({result:[{...partsCard,...left},{...partsCard,...right}]});calls=[];
  const result=await lookupVin();assert.equal(result.candidates.length,expected,'dedupe preserves engine options and catalogue ranges, ignoring option order');
  assert.deepEqual(calls,['partsapi']);
}

delete process.env.PARTSAPI_VINDECODE_KEY;
calls = [];
assert.equal((await lookupVin()).status, "found");
assert.deepEqual(calls, ["tronk"]);
console.log("vehicle-identity PartsAPI priority and TRONK fallback passed");

// Production regression: legacy decode returns the whole W203 range while
// vindecode2 has no data. The six-digit Mercedes type must disambiguate it.
const mercedesReports = [
  ['C160K', 'M271.921', 1800, undefined],
  ['C180', 'M111.951', 1998, undefined],
  ['C200CDI', 'OM611.962', 2151, undefined],
  ['C200K', 'M111.955', 1998, 120],
  ['C230K', 'M111.981', 2295, undefined],
].map(([Modification, EngineSeries, Ccm, KW]) => ({ Data: {
  Brand: 'MERCEDES-BENZ', Model: 'C-Klasse', BodyName: 'W203',
  Modification, EngineSeries, EngineVolume: { Ccm, L: Ccm / 1000 },
  EnginePower: { KW }, StartYear: '07.2001', FinishYear: '2003',
} }));
tronkClient.decodeVinPrimary = async () => ({ ok: true, method: 'vindecode', durationMs: 1,
  data: { decode: { Reports: mercedesReports } } });
const specific = await lookupVehicle({ organizationId: 'test', inputType: 'vin', input: 'WDB2030451A000001', refresh: true });
assert.equal(specific.candidates.length, 1);
assert.equal(specific.vehicle.engineCode, 'M111.955');
assert.equal(specific.vehicle.modificationName, 'C 200 Kompressor (203.045)');
assert.equal(specific.vehicle.year, undefined, 'catalogue range must not invent a build year');
const { selectMercedesVinType } = await jiti.import('../src/lib/mercedes-vin-type.ts');
const vehicles = mercedesReports.map(r => toVehicle(r.Data, 'tronk_vindecode'));
assert.equal(selectMercedesVinType('WDB2030451A999999', vehicles)[0].engineCode, 'M111.955', 'type applies beyond one VIN serial');
assert.equal(selectMercedesVinType('WDB2030421A139398', vehicles).length, vehicles.length, 'unsupported type stays ambiguous');
assert.equal(selectMercedesVinType('WVW2030451A139398', vehicles).length, vehicles.length);
assert.equal(selectMercedesVinType('WDB2030451A000001', vehicles.filter(v => v.engineSeries !== 'M111.955')).length, 4);
assert.equal(selectMercedesVinType('WDB2030451A000001', [...vehicles, vehicles[3]]).length, 6, 'duplicate matching reports do not silently choose');
assert.equal(selectMercedesVinType('WDB2030451A000001', vehicles.map(v => ({ ...v, powerKw: 140 }))).length, 5, 'contradictory engine characteristics remain ambiguous');
console.log('Mercedes VIN type production regression passed');

// Ambiguous primary reports survive a failed extended decode in the UI, but
// must never become one authoritative cached vehicle for downstream readers.
const cacheUpdates = [];
cache.updateMany = async (query) => { cacheUpdates.push(query); return { count: new Set(query.where.id.in).size }; };
calls = [];
const ambiguous = await lookupVehicle({ organizationId: 'test', inputType: 'vin', input: 'WDB2030421A139398', refresh: true, extended: true });
assert.ok(calls.includes('tronk-extended'), 'exercise failed extended decode');
assert.equal(ambiguous.candidates.length, mercedesReports.length);
assert.ok(ambiguous.candidates.some(candidate => candidate.vehicle.engineSeries === 'M111.955'), 'UI candidates retained');
assert.ok(cacheUpdates.length > 0, 'capture normalized cache update');
const { Prisma } = await jiti.import('@prisma/client');
assert.equal(cacheUpdates.at(-1).data.normalizedVehicleJson, Prisma.JsonNull, 'ambiguous raw cache cannot claim candidates[0] as the single identity');
assert.deepEqual(cacheUpdates.at(-1).where.id.in, [...new Set(ambiguous.cacheIds)]);
assert.deepEqual(Object.keys(cacheUpdates.at(-1).data), ['normalizedVehicleJson'], 'raw cache remains intact');
cacheUpdates.length = 0;
const unique = await lookupVehicle({ organizationId: 'test', inputType: 'vin', input: 'WDB2030451A000001', refresh: true });
assert.equal(unique.candidates.length, 1);
assert.equal(cacheUpdates.at(-1).data.normalizedVehicleJson.engineCode, 'M111.955', 'unique resolved identity remains persisted');
console.log('Vehicle cache ambiguity after failed extended decode passed');

// Dedicated engine codes without engineSeries, and other actual technical
// discriminators, must remain separate before the cache cardinality check.
const identityReport = { Brand:'BMW', Model:'X6', Generation:'E71', BodyName:'E71', EngineCode:'N54B30', Year:2012, EngineVolumeLiters:3, PowerHp:306, DriveType:'AWD', TransmissionType:'automatic' };
for (const difference of [{EngineCode:'N55B30'},{Year:2013},{DriveType:'RWD'},{EngineVolumeLiters:4},{PowerHp:400},{TransmissionType:'manual'}]) {
  tronkClient.decodeVinPrimary = async () => ({ok:true,method:'vindecode',durationMs:1,data:{decode:{Reports:[{Data:identityReport},{Data:{...identityReport,...difference}}]}}});
  cacheUpdates.length=0;
  const result=await lookupVin(true);
  assert.equal(result.candidates.length,2,`distinct technical candidate: ${JSON.stringify(difference)}`);
  assert.equal(new Set(result.candidates.map(candidate=>candidate.key)).size,2,'UI keys preserve technical alternatives');
  assert.equal(cacheUpdates.at(-1).data.normalizedVehicleJson,Prisma.JsonNull);
}
tronkClient.decodeVinPrimary = async () => ({ok:true,method:'vindecode',durationMs:1,data:{decode:{Reports:[{Data:identityReport},{Data:{...identityReport}}]}}});
cacheUpdates.length=0;
assert.equal((await lookupVin(true)).candidates.length,1,'duplicate technical identity remains unique');
assert.equal(cacheUpdates.at(-1).data.normalizedVehicleJson.engineCode,'N54B30');
console.log('Vehicle cache technical identity cardinality passed');

tronkClient.decodeVinPrimary = async () => ({ok:true,method:'vindecode',durationMs:1,data:{decode:{Reports:[{Data:identityReport},{Data:{...identityReport,EngineCode:'N55B30'}}]}}});
cache.updateMany = async () => { throw new Error('database write unavailable'); };
await assert.rejects(lookupVin(true), /Не удалось безопасно очистить неоднозначный результат/, 'ambiguous cache cleanup failure must reject lookup, not return success');
let releaseCleanup;
cache.updateMany = () => new Promise(resolve => { releaseCleanup=()=>resolve({count:1}); });
let returned=false;const pendingLookup=lookupVin(true).then(result=>{returned=true;return result;});
while(!releaseCleanup) await new Promise(resolve=>setImmediate(resolve));
await new Promise(resolve=>setImmediate(resolve));assert.equal(returned,false,'lookup waits for ambiguity cleanup');
releaseCleanup();assert.equal((await pendingLookup).candidates.length,2);
console.log('Ambiguous vehicle cache cleanup is awaited and fails closed');
cache.updateMany = async () => ({count:0});
await assert.rejects(lookupVin(true),/Не удалось безопасно очистить неоднозначный результат/,'incomplete cleanup cannot report success');
tronkClient.decodeVinPrimary = async () => ({ok:true,method:'vindecode',durationMs:1,data:{decode:{Reports:[{Data:identityReport}]}}});
cache.updateMany = async () => {throw new Error('derived cache unavailable');};
assert.equal((await lookupVin()).candidates.length,1,'unique derived-cache write remains best effort');

const { assessTronkReturnedVin } = await jiti.import('../src/lib/vehicle-identity.ts');
const requestedVin='WBAFG410X0L197055', otherVin='WBAFG410X0L197056';
assert.deepEqual(assessTronkReturnedVin({decode:{Reports:[{Data:{VIN:requestedVin}}]}},requestedVin,'vindecode'),{status:'exact',returnedVins:[requestedVin],correlationStatus:'absent',correlationVins:[]});
assert.equal(assessTronkReturnedVin({result:{VIN:otherVin}},requestedVin,'vindecode2').status,'mismatch');
assert.equal(assessTronkReturnedVin({request:{VIN:requestedVin},query:{vin:requestedVin},input:{VIN:requestedVin},decode:{Reports:[{Data:identityReport}]}},requestedVin,'vindecode').status,'absent','request echo is not returned identity proof');
assert.equal(assessTronkReturnedVin({result:{request:{VIN:requestedVin}}},requestedVin,'vindecode2').status,'absent');
assert.equal(assessTronkReturnedVin({decode:{Reports:[{Data:{VIN:requestedVin}},{Data:{VIN:otherVin}}]}},requestedVin,'vindecode').status,'mismatch','one exact and one conflicting returned VIN is unsafe');
const storedRows=[];let paidPrimary=0;
cache.create=async({data})=>{const row={...data,id:`vin-proof-${storedRows.length}`};storedRows.push(row);return row;};
cache.findFirst=async({where})=>storedRows.find(row=>row.method===where.method&&(row.status==='success'||row.errorCode==='VIN_RETURN_MISMATCH'))??null;
cache.updateMany=async({where,data})=>{const row=storedRows.find(row=>row.id===where.id);if(row)Object.assign(row,data);return{count:row?1:0};};
tronkClient.decodeVinPrimary=async()=>{paidPrimary++;return{ok:true,method:'vindecode',durationMs:1,providerRequestId:'mock-proof',data:{decode:{Reports:[{Data:{...identityReport,VIN:otherVin}}]}}};};
tronkClient.decodeVinExtended=async()=>({ok:false,method:'vindecode2',durationMs:0,code:'provider',message:'no data'});
let rejected=await lookupVehicle({organizationId:'test',inputType:'vin',input:requestedVin});
assert.equal(rejected.vehicle,null,'fresh mismatched response cannot become hinted requested identity');
const badRaw=storedRows.find(row=>row.method==='vindecode');assert.equal(badRaw.status,'error');assert.equal(badRaw.errorCode,'VIN_RETURN_MISMATCH');assert.equal(badRaw.normalizedVehicleJson,Prisma.JsonNull);assert.ok(badRaw.rawResponseEncrypted,'wrong raw evidence retained encrypted');assert.ok(!badRaw.rawResponseEncrypted.includes(otherVin));
rejected=await lookupVehicle({organizationId:'test',inputType:'vin',input:requestedVin});assert.equal(rejected.vehicle,null);assert.equal(paidPrimary,1,'mismatched error cache must not repurchase same method');
badRaw.status='success';badRaw.errorCode=null;badRaw.normalizedVehicleJson={vin:requestedVin};
await lookupVehicle({organizationId:'test',inputType:'vin',input:requestedVin});assert.equal(paidPrimary,1,'legacy success cache mismatch must not repurchase');assert.equal(badRaw.status,'error');assert.equal(badRaw.normalizedVehicleJson,Prisma.JsonNull);
for(const explicit of [requestedVin,undefined]){
 storedRows.length=0;tronkClient.decodeVinPrimary=async()=>({ok:true,method:'vindecode',durationMs:0,providerRequestId:null,data:{decode:{Reports:[{Data:{...identityReport,...(explicit?{VIN:explicit}:{})}}]}}});
 const valid=await lookupVehicle({organizationId:'test',inputType:'vin',input:requestedVin});assert.equal(valid.candidates.length,1,'exact or absent response VIN keeps legacy lookup functional');
}
console.log('TRONK returned VIN exact/mismatch/absent proof and encrypted rejected-cache reuse passed');
// A valid fallback must not relabel the rejected raw response as its identity.
storedRows.length=0;
cache.updateMany=async({where,data})=>{let count=0;for(const row of storedRows){if((where.id===row.id||where.id?.in?.includes(row.id))&&(!where.OR||row.errorCode!=='VIN_RETURN_MISMATCH')){Object.assign(row,data);count++;}}return{count};};
tronkClient.decodeVinPrimary=async()=>({ok:true,method:'vindecode',durationMs:0,providerRequestId:null,data:{decode:{Reports:[{Data:{...identityReport,VIN:otherVin}}]}}});
tronkClient.decodeVinExtended=async()=>({ok:true,method:'vindecode2',durationMs:0,providerRequestId:null,data:{result:{...identityReport,VIN:requestedVin}}});
const validFallback=await lookupVehicle({organizationId:'test',inputType:'vin',input:requestedVin});assert.equal(validFallback.candidates.length,1);
assert.equal(storedRows.find(row=>row.method==='vindecode').normalizedVehicleJson,Prisma.JsonNull,'rejected response cannot receive valid fallback identity');
assert.equal(storedRows.find(row=>row.method==='vindecode2').normalizedVehicleJson.engineCode,'N54B30');
const rejectedRow=storedRows.find(row=>row.method==='vindecode');rejectedRow.rawResponseEncrypted='unreadable';
tronkClient.decodeVinPrimary=async()=>{throw new Error('must not repurchase quarantined raw');};
assert.equal((await lookupVehicle({organizationId:'test',inputType:'vin',input:requestedVin})).candidates.length,1,'quarantined undecryptable response remains rejected without purchase');
storedRows.length=0;
tronkClient.decodeVinPrimary=async()=>({ok:false,method:'vindecode',durationMs:0,code:'provider',message:'no data'});
tronkClient.decodeVinExtended=async()=>({ok:true,method:'vindecode2',durationMs:0,providerRequestId:null,data:{result:{...identityReport,VIN:otherVin}}});
assert.equal((await lookupVehicle({organizationId:'test',inputType:'vin',input:requestedVin})).vehicle,null,'extended mismatch cannot enter merge');
assert.equal(storedRows.find(row=>row.method==='vindecode2').errorCode,'VIN_RETURN_MISMATCH');
console.log('TRONK rejected evidence isolation and extended mismatch passed');

storedRows.length=0;let primaryCalls=0,extendedCalls=0;
tronkClient.decodeVinPrimary=async()=>{primaryCalls++;return{ok:true,method:'vindecode',durationMs:0,providerRequestId:null,data:{decode:{Reports:[{Data:{...identityReport,VIN:requestedVin}},{Data:{...identityReport,EngineCode:'N55B30',VIN:requestedVin}}]}}};};
tronkClient.decodeVinExtended=async()=>{extendedCalls++;return{ok:true,method:'vindecode2',durationMs:0,providerRequestId:null,data:{result:{...identityReport,VIN:otherVin}}};};
const ambiguousWithWrongFallback=await lookupVehicle({organizationId:'test',inputType:'vin',input:requestedVin});assert.equal(ambiguousWithWrongFallback.candidates.length,2,'valid ambiguous primary remains selectable despite quarantined fallback');assert.equal(ambiguousWithWrongFallback.cacheIds.length,2,'diagnostics retain all raw evidence IDs');
assert.ok(storedRows.every(row=>row.normalizedVehicleJson===Prisma.JsonNull),'neither ambiguous nor rejected raw receives a unique derived identity');assert.equal(storedRows.find(row=>row.method==='vindecode2').status,'error');
assert.equal((await lookupVehicle({organizationId:'test',inputType:'vin',input:requestedVin})).candidates.length,2);
assert.equal(primaryCalls,1);assert.equal(extendedCalls,1,'both valid primary and quarantined extended are replayed without purchase');
console.log('Ambiguous primary plus quarantined extended keeps UI candidates and correct cleanup count');

// Both official TRONK method contracts define root vin as request correlation,
// including error responses, rather than independent returned vehicle identity.
for(const method of ['vindecode','vindecode2']){
 const payload=method==='vindecode'?{decode:{Reports:[{Data:identityReport}]}}:{result:identityReport};
 const correlation=assessTronkReturnedVin({...payload,vin:requestedVin},requestedVin,method);
 assert.equal(correlation.correlationStatus,'match');assert.equal(correlation.status,'absent');assert.deepEqual(correlation.returnedVins,[],'matching root echo is not independent VIN proof');
 const conflict=assessTronkReturnedVin({...payload,vin:otherVin},requestedVin,method);assert.equal(conflict.correlationStatus,'mismatch');assert.equal(conflict.status,'mismatch');
 assert.equal(assessTronkReturnedVin({vin:otherVin,error:true,error_msg:'not found'},requestedVin,method).status,'mismatch','wrong request binding rejected even in error envelope');
 assert.equal(assessTronkReturnedVin({vin:requestedVin,error:true},requestedVin,method).status,'absent');
}
assert.equal(assessTronkReturnedVin({vin:otherVin,result:{VIN:requestedVin}},requestedVin,'vindecode2').status,'mismatch','root conflict overrides matching identity field');
storedRows.length=0;primaryCalls=0;extendedCalls=0;
tronkClient.decodeVinPrimary=async()=>{primaryCalls++;return{ok:true,method:'vindecode',durationMs:0,providerRequestId:null,data:{vin:otherVin,decode:{Reports:[{Data:identityReport}]}}};};
tronkClient.decodeVinExtended=async()=>{extendedCalls++;return{ok:false,method:'vindecode2',durationMs:0,code:'provider',message:'no data'};};
assert.equal((await lookupVehicle({organizationId:'test',inputType:'vin',input:requestedVin})).vehicle,null);
assert.equal(storedRows.find(row=>row.method==='vindecode').errorCode,'VIN_RETURN_MISMATCH');
console.log('TRONK official root VIN correlation never becomes independent identity proof');
