#!/usr/bin/env node

import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const { MANN_FLUID_MATCHER_VERSION, matchFluidRequirementToMann } = await jiti.import(
  "../src/lib/mann-fluid-matcher-v2.ts",
);

function row(overrides) {
  return {
    vehicleVariantKey: "variant-a",
    make: "TOYOTA",
    makeNormalized: "TOYOTA",
    model: "RAV4 III (A3)",
    modelNormalized: "RAV4 III A3",
    vehicleText: "2.4 gasoline 4WD (A3)",
    effectiveVehicleText: "2.4 gasoline 4WD (A3)",
    engineCode: "2AZ-FE",
    engineCodeNormalized: "2AZFE",
    kw: "125",
    hp: "170",
    vehicleYears: "01/06-12/10",
    vehicleYearFrom: 2006,
    vehicleYearTo: 2010,
    condition: null,
    ...overrides,
  };
}

function requirement(overrides = {}) {
  return {
    id: "requirement-a",
    make: "Toyota",
    makeNormalized: "TOYOTA",
    model: "RAV4 III",
    modelNormalized: "RAV4 III",
    generation: "III",
    bodyCodesJson: ["A3"],
    yearFrom: 2006,
    yearTo: 2010,
    engineCodeNormalized: "2AZ-FE",
    engineCodesJson: ["2AZ-FE"],
    engineVolumeCc: 2400,
    powerKw: 125,
    powerHp: 170,
    fuelType: "Бензин",
    driveType: "4WD",
    transmissionType: "automatic",
    componentModel: null,
    systemCode: "ENGINE_OIL",
    systemNameRaw: "Масло в двигатель",
    fillVolumeText: "4.3 л. с фильтром",
    specificationText: "API SN",
    specificationsJson: [{ type: "API", value: "API SN" }],
    ...overrides,
  };
}

assert.equal(MANN_FLUID_MATCHER_VERSION, "mann-fluid-matcher-v10");

const exactBesideFamily=matchFluidRequirementToMann(requirement(),[
  row({vehicleVariantKey:'exact-fe'}),
  row({vehicleVariantKey:'other-fse',engineCode:'2AZ-FSE',engineCodeNormalized:'2AZFSE'}),
]);
assert.equal(exactBesideFamily.status,'CONFIRMED_SINGLE');
assert.deepEqual(exactBesideFamily.targets.map(t=>t.vehicleVariantKey),['exact-fe']);
assert.ok(exactBesideFamily.topCandidates.some(c=>c.variantIds.includes('other-fse')&&!c.eligible),'Excluded alternative remains visible diagnostically');
const uncertainExact=matchFluidRequirementToMann(requirement(),[
  row({vehicleVariantKey:'exact-fe'}),row({vehicleVariantKey:'condition-fe',condition:'for special market'}),
]);
assert.equal(uncertainExact.status,'REVIEW_REQUIRED','Unknown condition on same exact engine must still block');
const familyWithoutExact=matchFluidRequirementToMann(requirement(),[
  row({vehicleVariantKey:'other-fse',engineCode:'2AZ-FSE',engineCodeNormalized:'2AZFSE'}),
]);
assert.ok(!familyWithoutExact.status.startsWith('CONFIRMED'),'Family identity alone cannot become eligible');

const { hasExactMannModelIdentity } = await jiti.import('../src/lib/mann-vehicle-resolver.ts');
for (const [source, heading, make, expected] of [
  ['Tiggo 7', 'TIGGO 5x (Tiggo 4)', 'CHERY', false],
  ['Tiggo 4 Pro', 'TIGGO 5x (Tiggo 4)', 'CHERY', false],
  ['Tiggo 4', 'TIGGO 5x (Tiggo 4)', 'CHERY', true],
  ['Tiggo 5x', 'TIGGO 5x (Tiggo 4)', 'CHERY', true],
  ['Allion II', 'Premio/Allion II (T26)', 'TOYOTA', true],
  ['Premio II', 'Premio/Allion II (T26)', 'TOYOTA', true],
  ['Voxy', 'Noah/Voxy', 'TOYOTA', true],
  ['Corolla Axio', 'Corolla X', 'TOYOTA', false],
  ['X Trail', 'X-TRAIL', 'NISSAN', true],
]) assert.equal(hasExactMannModelIdentity(source, make, row({model: heading})), expected, `${source} -> ${heading}`);

// Stored search keys are compact; identity must normalize the original name.
for (const [make, model, modelNormalized, heading] of [
  ['NISSAN', 'x trail', 'XTRAIL', 'X-Trail III (T32)'],
  ['MERCEDES', 'c class', 'CCLASS', 'C-Klasse (W203/C203/S203)'],
]) {
  const result = matchFluidRequirementToMann(requirement({make, makeNormalized: make, model, modelNormalized, generation: null, bodyCodesJson: []}),
    [row({make, makeNormalized: make, model: heading, modelNormalized: heading})]);
  assert.ok(result.topCandidates.length);
  assert.ok(result.topCandidates.every(c => c.reviewBlockers.every(b => !b.includes('точная модель'))), model);
}

for (const model of ['Tiggo 7', 'Tiggo 4 Pro']) {
  const result = matchFluidRequirementToMann(requirement({make: 'Chery', makeNormalized: 'CHERY', model, modelNormalized: model, generation: null, bodyCodesJson: []}),
    [row({make: 'CHERY', makeNormalized: 'CHERY', model: 'TIGGO 5x (Tiggo 4)', modelNormalized: 'TIGGO 5X TIGGO 4'})]);
  assert.equal(result.targets.length, 0, model);
  assert.ok(result.topCandidates.some(c => c.reviewBlockers.some(b => b.includes('точная модель'))), model);
}

const single = matchFluidRequirementToMann(requirement(), [row({})]);
for (const [model, generation, heading, expected] of [
  ['Zafira','B','Zafira B','CONFIRMED_SINGLE'],
  ['Zafira','C','Zafira B','CONFLICT'],
  ['Zafira',null,'Zafira B','REVIEW_REQUIRED'],
  ['Zafira C','B','Zafira B','CONFLICT'],
  ['Astra','H','Astra H/Astra HGTC/Twin Top','CONFIRMED_SINGLE'],
  ['Astra','J','Astra H/Astra HGTC/Twin Top','CONFLICT'],
  ['Corsa','D','Corsa-D','CONFIRMED_SINGLE'],
]) {
  const result=matchFluidRequirementToMann(requirement({make:'Opel',makeNormalized:'OPEL',model,modelNormalized:model,generation,bodyCodesJson:[]}),[row({make:'OPEL',makeNormalized:'OPEL',model:heading,modelNormalized:heading})]);
  assert.equal(result.status,expected,`${model} ${generation} -> ${heading}`);
}
const sourceIdentityConflict = matchFluidRequirementToMann(requirement({rawRequirementJson: {sourceIdentity: {reviewRequired: true}}}), [row({})]);
assert.equal(sourceIdentityConflict.status, 'REVIEW_REQUIRED');
assert.equal(sourceIdentityConflict.targets.length, 0);
assert.ok(sourceIdentityConflict.topCandidates[0].reviewBlockers.some(b => b.includes('противоречат друг другу')));
const partialRange = matchFluidRequirementToMann(requirement({ yearFrom: 2006, yearTo: 2016 }), [row({})]);
assert.equal(partialRange.status, "REVIEW_REQUIRED");
assert.ok(partialRange.topCandidates[0].reviewBlockers.some(reason => reason.includes("часть лет")));
assert.ok(!partialRange.topCandidates[0].hardConflicts.includes("год"));
assert.equal(partialRange.normalizedVehicle.year, undefined);
assert.deepEqual(partialRange.normalizedVehicle.applicabilityYears, { from: 2006, to: 2016 });
const disjointRange = matchFluidRequirementToMann(requirement({ yearFrom: 2012, yearTo: 2016 }), [row({})]);
assert.equal(disjointRange.status, "CONFLICT");
assert.ok(disjointRange.topCandidates[0].hardConflicts.includes("диапазон годов не пересекается"));
const openRange = matchFluidRequirementToMann(requirement({ yearFrom: 2006, yearTo: null }), [row({ vehicleYearFrom: 2012, vehicleYearTo: 2016 })]);
assert.equal(openRange.status, "REVIEW_REQUIRED");
assert.ok(openRange.topCandidates[0].reviewBlockers.some(reason => reason.includes("часть лет")));
const openCovered = matchFluidRequirementToMann(requirement({ yearFrom: 2006, yearTo: null }), [row({ vehicleYearFrom: 2005, vehicleYearTo: null })]);
assert.equal(openCovered.status, "CONFIRMED_SINGLE");
const invalidRange = matchFluidRequirementToMann(requirement({ yearFrom: 2016, yearTo: 2006 }), [row({})]);
assert.equal(invalidRange.status, "CONFLICT");
assert.equal(single.status, "CONFIRMED_SINGLE");
assert.deepEqual(single.targets.map((target) => target.vehicleVariantKey), ["variant-a"]);
assert.equal(single.targets[0]?.independentlyValidated, true);

const multi = matchFluidRequirementToMann(requirement(), [
  row({ vehicleVariantKey: "variant-a" }),
  row({ vehicleVariantKey: "variant-b" }),
]);
assert.equal(multi.status, "CONFIRMED_MULTI_APPLICABILITY");
assert.deepEqual(multi.targets.map((target) => target.vehicleVariantKey).sort(), ["variant-a", "variant-b"]);

const ambiguity = matchFluidRequirementToMann(requirement({ engineCodeNormalized: "2AZ", engineCodesJson: ["2AZ"] }), [
  row({ vehicleVariantKey: "variant-a", engineCode: "2AZ-FE", engineCodeNormalized: "2AZFE", kw: "125", hp: "170" }),
  row({ vehicleVariantKey: "variant-c", engineCode: "2AZ-FXE", engineCodeNormalized: "2AZFXE" }),
]);
assert.equal(ambiguity.status, "REVIEW_REQUIRED");
assert.equal(ambiguity.targets.length, 0);

const conflict = matchFluidRequirementToMann(requirement({ fuelType: "Дизель" }), [row({})]);
assert.equal(conflict.status, "CONFLICT");
assert.ok(conflict.conflictTypes.includes("топливо"));

const insufficient = matchFluidRequirementToMann(requirement({
  generation: null,
  bodyCodesJson: [],
  yearFrom: null,
  yearTo: null,
  engineCodeNormalized: null,
  engineCodesJson: [],
  engineVolumeCc: null,
  powerKw: null,
  powerHp: null,
  fuelType: null,
}), [row({})]);
assert.equal(insufficient.status, "INSUFFICIENT_SOURCE_CONTEXT");

const gap = matchFluidRequirementToMann(requirement(), []);
assert.equal(gap.status, "MANN_CATALOG_GAP");

const componentConfirmed = matchFluidRequirementToMann(requirement({
  systemCode: "CVT_TRANSMISSION",
  transmissionType: "cvt",
  componentModel: "K111",
}), [row({ vehicleText: "2.4 gasoline 4WD CVT K111 (A3)", effectiveVehicleText: "2.4 gasoline 4WD CVT K111 (A3)" })]);
assert.equal(componentConfirmed.status, "CONFIRMED_SINGLE");

const componentUnconfirmed = matchFluidRequirementToMann(requirement({
  systemCode: "CVT_TRANSMISSION",
  transmissionType: "cvt",
  componentModel: "K111",
}), [row({})]);
assert.equal(componentUnconfirmed.status, "REVIEW_REQUIRED");
assert.ok(componentUnconfirmed.topCandidates[0]?.reviewBlockers.includes("MANN variant не подтверждает тип или модель коробки"));

const conditionalComponents = matchFluidRequirementToMann(requirement({
  systemCode: "CVT_TRANSMISSION",
  transmissionType: "cvt",
  componentModel: "K111 / K111F",
  fillVolumeText: "8.9 л. для K111, 7.1 л. для K111F",
}), [row({ vehicleText: "2.4 gasoline 4WD CVT K111 (A3)", effectiveVehicleText: "2.4 gasoline 4WD CVT K111 (A3)" })]);
assert.equal(conditionalComponents.status, "REVIEW_REQUIRED");
assert.ok(conditionalComponents.topCandidates[0]?.reviewBlockers.includes("несколько component/capacity альтернатив не разделены на условия"));

const missingChassisIdentity = matchFluidRequirementToMann(requirement({ bodyCodesJson: [] }), [
  row({ model: "RAV4", modelNormalized: "RAV4", vehicleText: "2.4 gasoline", effectiveVehicleText: "2.4 gasoline" }),
]);
assert.equal(missingChassisIdentity.status, "REVIEW_REQUIRED");

const engineScopedBrakeFluid = matchFluidRequirementToMann(requirement({
  systemCode: "BRAKE_FLUID",
  systemNameRaw: "Тормозная жидкость",
  transmissionType: null,
  componentModel: null,
}), [
  row({ vehicleVariantKey: "variant-a" }),
  row({ vehicleVariantKey: "variant-b", engineCode: "1AZ-FE", engineCodeNormalized: "1AZFE", kw: "112", hp: "152" }),
]);
assert.equal(engineScopedBrakeFluid.status, "CONFIRMED_SINGLE");
assert.deepEqual(engineScopedBrakeFluid.targets.map((target) => target.vehicleVariantKey), ["variant-a"]);

const familyOnlyBrakeFluid = matchFluidRequirementToMann(requirement({
  systemCode: "BRAKE_FLUID",
  systemNameRaw: "Тормозная жидкость",
  engineCodeNormalized: "2AZ",
  engineCodesJson: ["2AZ"],
}), [row({})]);
assert.equal(familyOnlyBrakeFluid.status, "REVIEW_REQUIRED");
assert.ok(familyOnlyBrakeFluid.topCandidates[0]?.reviewBlockers.includes("для этой технической системы не подтверждён точный код двигателя"));

const broadBrakeFluidGroup = matchFluidRequirementToMann(requirement({
  systemCode: "BRAKE_FLUID",
  systemNameRaw: "Тормозная жидкость",
  engineCodesJson: ["2AZ-FE", "2AZ-FXE", "1AZ-FE", "1AZ-FSE", "3ZR-FE"],
}), [row({})]);
assert.equal(broadBrakeFluidGroup.status, "REVIEW_REQUIRED");
assert.ok(broadBrakeFluidGroup.topCandidates[0]?.reviewBlockers.includes("source requirement объединяет слишком много кодов двигателя"));

const familyOnlyAcRefrigerant = matchFluidRequirementToMann(requirement({
  systemCode: "AC_REFRIGERANT",
  systemNameRaw: "Хладагент кондиционера",
  engineCodeNormalized: "2AZ",
  engineCodesJson: ["2AZ"],
}), [row({})]);
assert.equal(familyOnlyAcRefrigerant.status, "REVIEW_REQUIRED");
assert.ok(familyOnlyAcRefrigerant.topCandidates[0]?.reviewBlockers.includes("для этой технической системы не подтверждён точный код двигателя"));

const familyOnlyFuelTank = matchFluidRequirementToMann(requirement({
  systemCode: "FUEL_TANK",
  systemNameRaw: "Топливный бак",
  engineCodeNormalized: "2AZ",
  engineCodesJson: ["2AZ"],
}), [row({})]);
assert.equal(familyOnlyFuelTank.status, "REVIEW_REQUIRED");
assert.ok(familyOnlyFuelTank.topCandidates[0]?.reviewBlockers.includes("для этой технической системы не подтверждён точный код двигателя"));

const modelLevelBrakeFluid = matchFluidRequirementToMann(requirement({
  systemCode: "BRAKE_FLUID",
  systemNameRaw: "Тормозная жидкость",
  transmissionType: null,
  componentModel: null,
  engineCodeNormalized: null,
  engineCodesJson: [],
  engineVolumeCc: null,
  powerKw: null,
  powerHp: null,
  fuelType: null,
}), [
  row({ vehicleVariantKey: "variant-a" }),
  row({ vehicleVariantKey: "variant-b", engineCode: "1AZ-FE", engineCodeNormalized: "1AZFE", kw: "112", hp: "152" }),
]);
assert.equal(modelLevelBrakeFluid.status, "CONFIRMED_MULTI_APPLICABILITY");
assert.deepEqual(modelLevelBrakeFluid.targets.map((target) => target.vehicleVariantKey).sort(), ["variant-a", "variant-b"]);

const rearDifferentialWithoutDriveEvidence = matchFluidRequirementToMann(requirement({
  systemCode: "REAR_DIFFERENTIAL",
  systemNameRaw: "Задний редуктор",
  driveType: null,
}), [row({ vehicleText: "2.4 gasoline (A3)", effectiveVehicleText: "2.4 gasoline (A3)" })]);
assert.equal(rearDifferentialWithoutDriveEvidence.status, "REVIEW_REQUIRED");
assert.ok(rearDifferentialWithoutDriveEvidence.topCandidates[0]?.reviewBlockers.includes("MANN variant не подтверждает привод или модель агрегата"));

const rearDifferentialWithDriveEvidence = matchFluidRequirementToMann(requirement({
  systemCode: "REAR_DIFFERENTIAL",
  systemNameRaw: "Задний редуктор",
  driveType: null,
}), [row({ vehicleText: "2.4 gasoline 4WD (A3)", effectiveVehicleText: "2.4 gasoline 4WD (A3)" })]);
assert.equal(rearDifferentialWithDriveEvidence.status, "CONFIRMED_SINGLE");

const unprovenPowerSteering = matchFluidRequirementToMann(requirement({
  systemCode: "POWER_STEERING",
  systemNameRaw: "Жидкость ГУР",
}), [row({})]);
assert.equal(unprovenPowerSteering.status, "REVIEW_REQUIRED");
assert.ok(unprovenPowerSteering.topCandidates[0]?.reviewBlockers.includes("MANN variant не подтверждает наличие этой гидравлической системы"));

const engineFamilyOnly = matchFluidRequirementToMann(requirement({
  engineCodeNormalized: "2AZ",
  engineCodesJson: ["2AZ"],
}), [row({})]);
assert.equal(engineFamilyOnly.status, "REVIEW_REQUIRED");
assert.ok(engineFamilyOnly.topCandidates[0]?.reviewBlockers.includes("для этой технической системы не подтверждён точный код двигателя"));

const broadEngineGroup = matchFluidRequirementToMann(requirement({
  engineCodeNormalized: "2AZ-FE",
  engineCodesJson: ["2AZ-FE", "2AZ-FXE", "1AZ-FE", "1AZ-FSE", "3ZR-FE"],
}), [row({})]);
assert.equal(broadEngineGroup.status, "REVIEW_REQUIRED");
assert.ok(broadEngineGroup.topCandidates[0]?.reviewBlockers.includes("source requirement объединяет слишком много кодов двигателя"));

const contaminatedMannRow = matchFluidRequirementToMann(requirement(), [row({
  vehicleText: "2.4 gasoline 4WD +++ For our complete catalog",
  effectiveVehicleText: "2.4 gasoline 4WD +++ For our complete catalog",
})]);
assert.equal(contaminatedMannRow.status, "REVIEW_REQUIRED");
assert.ok(contaminatedMannRow.topCandidates[0]?.reviewBlockers.includes("строка MANN содержит признаки загрязнения текстом PDF"));

const alternateEngines = requirement({engineCodeNormalized: "1AZ-FE", engineCodesJson: ["1AZ-FE", "3AZ-FE", "2AZ-FE"]});
const pollutedEngines = requirement({engineCodeNormalized:"4WD",engineCodesJson:["4WD","AWD","FWD","RWD","2AZ-FE"],driveType:null});
const cleanedEngines = matchFluidRequirementToMann(pollutedEngines,[row({})]);
assert.equal(cleanedEngines.status,"CONFIRMED_SINGLE");
assert.equal(cleanedEngines.normalizedVehicle.exactEngineCode,"2AZFE");
assert.deepEqual(cleanedEngines.normalizedVehicle.sourceExactEngineCodes,["2AZFE"]);
assert.equal(cleanedEngines.normalizedVehicle.driveType,undefined,"drive tokens in engine list do not establish vehicle drive");
assert.deepEqual(pollutedEngines.engineCodesJson,["4WD","AWD","FWD","RWD","2AZ-FE"],"raw source must remain intact");
const driveOnly = matchFluidRequirementToMann(requirement({engineCodeNormalized:"4WD",engineCodesJson:["4WD"],driveType:null}),[row({engineCode:"4WD",engineCodeNormalized:"4WD"})]);
assert.ok(!driveOnly.topCandidates.some(c=>c.matchedFields.includes("точный код двигателя")),"a drive label cannot establish an exact engine match");
const alternateMatch = matchFluidRequirementToMann(alternateEngines, [row({})]);
assert.equal(alternateMatch.status, "CONFIRMED_SINGLE", "third explicit source engine is an exact alternative");
assert.ok(alternateMatch.targets[0].matchedFields.includes("точный код двигателя"));
assert.deepEqual(alternateMatch.normalizedVehicle.sourceExactEngineCodes, ["1AZFE", "3AZFE", "2AZFE"]);
assert.equal(alternateMatch.normalizedVehicle.engineSeries, undefined, "an alternate code is not an engine series");
const wrongAlternatePower = matchFluidRequirementToMann({...alternateEngines,powerKw:200,powerHp:272},[row({})]);
assert.ok(!wrongAlternatePower.status.startsWith("CONFIRMED"), "alternate code cannot bypass conflicting power");
const absentAlternate = matchFluidRequirementToMann({...alternateEngines,engineCodesJson:["1AZ-FE","3AZ-FE"]},[row({})]);
assert.ok(!absentAlternate.status.startsWith("CONFIRMED"), "unlisted engine is not an exact alternative");
const alternateTransmission = matchFluidRequirementToMann({...alternateEngines,systemCode:"AUTOMATIC_TRANSMISSION"},[row({})]);
assert.ok(!alternateTransmission.status.startsWith("CONFIRMED"), "engine alternatives cannot confirm gearbox identity");
console.log(`MANN fluid matcher ${MANN_FLUID_MATCHER_VERSION} applicability policy tests — passed`);
