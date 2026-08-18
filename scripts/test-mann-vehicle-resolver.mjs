import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": new URL("../src", import.meta.url).pathname },
});

const {
  evaluateMannCandidate,
  normalizeDecodedVehicleForTest,
} = await jiti.import("../src/lib/mann-vehicle-resolver.ts");
const {
  isValidMannYear,
  normalizeMannYearInput,
  shouldApplyMannRequest,
} = await jiti.import("../src/lib/mann-picker-state.ts");

const vehicle = (fields) => ({
  sourceMethods: ["tronk_vindecode"],
  confidence: "high",
  rawResultIds: [],
  vinStatus: "valid",
  ...fields,
});

const row = (fields) => ({
  vehicleVariantKey: fields.vehicleVariantKey ?? fields.model,
  make: fields.make,
  makeNormalized: fields.make,
  model: fields.model,
  modelNormalized: fields.model,
  vehicleText: fields.vehicleText ?? null,
  effectiveVehicleText: fields.effectiveVehicleText ?? null,
  engineCode: fields.engineCode ?? null,
  engineCodeNormalized: fields.engineCode ?? null,
  kw: fields.kw ?? null,
  hp: fields.hp ?? null,
  vehicleYears: fields.vehicleYears ?? null,
  vehicleYearFrom: fields.vehicleYearFrom ?? null,
  vehicleYearTo: fields.vehicleYearTo ?? null,
  condition: fields.condition ?? null,
});

const ford = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "FORD",
  modelRaw: "Mondeo",
  generationRaw: "V",
  year: 2014,
  engineVolumeCc: 2488,
  powerHp: 149,
  fuelType: "GASOLINE",
}));
assert.deepEqual(
  { make: ford?.canonicalMake, model: ford?.baseModel, generation: ford?.generation, year: ford?.year, volume: ford?.engineVolumeCc, hp: ford?.powerHp },
  { make: "FORD", model: "MONDEO", generation: "V", year: 2014, volume: 2488, hp: 149 },
);
const fordThird = evaluateMannCandidate(ford, row({
  make: "FORD", model: "Mondeo III (B4Y)", vehicleText: "2.5 l", vehicleYearFrom: 2000, vehicleYearTo: 2007,
}));
assert.ok(fordThird.rejected?.reasons.some((reason) => reason.includes("поколение")));
const fordFifth = evaluateMannCandidate(ford, row({
  make: "FORD", model: "Mondeo V", vehicleText: "2.5 l", hp: "149", vehicleYearFrom: 2014, vehicleYearTo: 2019,
}));
assert.ok(fordFifth.candidate, "Mondeo V remains a valid candidate");
const fordScreenshotBoundary = evaluateMannCandidate(ford, row({
  make: "FORD",
  model: "Mondeo V",
  vehicleText: "2.5(CNG)",
  engineCode: "C25HDEX",
  kw: "110",
  hp: "150",
  vehicleYears: "05/15 ->",
  vehicleYearFrom: 2015,
}));
assert.ok(fordScreenshotBoundary.candidate, "matching generation, 2.5 displacement and 150 hp retain the adjacent MANN year as confirmable");
assert.ok(fordScreenshotBoundary.candidate?.mismatchedFields.includes("год"));
assert.ok(fordScreenshotBoundary.candidate?.matchedFields.includes("объём двигателя"));
assert.ok(fordScreenshotBoundary.candidate?.matchedFields.includes("мощность"));
assert.ok(fordScreenshotBoundary.candidate?.warnings.some((warning) => warning.includes("переход модельного года")));
assert.ok(evaluateMannCandidate(ford, row({
  make: "FORD", model: "Mondeo V", vehicleText: "2.0TDCi", vehicleYearFrom: 2014, vehicleYearTo: 2019,
})).rejected?.reasons.some((reason) => reason.includes("объём")), "2.0TDCi is rejected against 2.488 l");
assert.ok(evaluateMannCandidate(ford, row({
  make: "FORD", model: "Mondeo V", vehicleText: "All models",
})).rejected?.reasons.some((reason) => reason.includes("общая применяемость")), "All models is context, not a selectable vehicle variant");

const highlander = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "TOYOTA", modelRaw: "Highlander", generationRaw: "III", year: 2017, engineVolumeCc: 3456 }));
assert.deepEqual({ model: highlander?.baseModel, generation: highlander?.generation }, { model: "HIGHLANDER", generation: "III" });
assert.ok(evaluateMannCandidate(highlander, row({ make: "TOYOTA", model: "Highlander II", vehicleYearFrom: 2007, vehicleYearTo: 2013 })).rejected);
assert.ok(evaluateMannCandidate(highlander, row({ make: "TOYOTA", model: "Highlander III", vehicleYearFrom: 2014, vehicleYearTo: 2019 })).candidate);
assert.ok(evaluateMannCandidate(highlander, row({ make: "TOYOTA", model: "Highlander III", vehicleText: "2.7", vehicleYearFrom: 2014, vehicleYearTo: 2019 })).rejected?.reasons.some((reason) => reason.includes("объём")), "2.7 is rejected against 3.456 l");

const civic = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "HONDA", modelRaw: "Civic", generationRaw: "VII", year: 2002 }));
assert.deepEqual({ model: civic?.baseModel, generation: civic?.generation, year: civic?.year }, { model: "CIVIC", generation: "VII", year: 2002 });
assert.notEqual(civic?.baseModel, "E");
assert.ok(evaluateMannCandidate(civic, row({ make: "HONDA", model: "Civic VII", vehicleYearFrom: 2000, vehicleYearTo: 2005 })).candidate);

const bmwX1 = normalizeDecodedVehicleForTest(vehicle({ makeRaw: "BMW", modelRaw: "X1(E84)", year: 2008 }));
const bmwPdfQualifier = evaluateMannCandidate(bmwX1, row({
  make: "BMW",
  model: "X1(E84)",
  vehicleText: "Exportmodellfür/Exportmodelfor(1005)",
  engineCode: "China.Sonderausstattung:/Optionalextra:(1016)",
  kw: "1",
  vehicleYears: "CodeS1AKA",
}));
assert.ok(bmwPdfQualifier.rejected?.reasons.some((reason) => reason.includes("служебное условие PDF")));
const bmwWrongBody = evaluateMannCandidate(bmwX1, row({
  make: "BMW",
  model: "X1(F48)",
  vehicleText: "2.0",
}));
assert.ok(bmwWrongBody.rejected?.reasons.some((reason) => reason.includes("код кузова")));

const haval = normalizeDecodedVehicleForTest(vehicle({
  makeRaw: "HAVAL", modelRaw: "Jolion", generationRaw: "I", year: 2020,
  engineSeries: "GW4G15K", engineVolumeCc: 1497, powerHp: 143,
}));
const havalBoundary = evaluateMannCandidate(haval, row({
  make: "HAVAL", model: "Jolion", vehicleText: "1.5T", engineCode: "GW4G15K", kw: "105", hp: "143", vehicleYearFrom: 2021,
}));
assert.ok(havalBoundary.candidate, "one-year MANN boundary with an exact engine remains confirmable");
assert.ok(havalBoundary.candidate?.mismatchedFields.includes("год"));
assert.ok(havalBoundary.candidate?.warnings.some((warning) => warning.includes("переход модельного года")));
assert.ok(evaluateMannCandidate(haval, row({
  make: "HAVAL", model: "Jolion", vehicleText: "1.5T", engineCode: "GW4G15K", kw: "105", hp: "143", vehicleYearFrom: 2022,
})).rejected?.reasons.some((reason) => reason.includes("год")), "two-year year mismatch stays a hard conflict");

assert.equal(normalizeMannYearInput("2002"), "2002");
assert.equal(isValidMannYear("2002", 2026), true);
assert.equal(isValidMannYear("201", 2026), false);
assert.equal(shouldApplyMannRequest(4, 5), false);
assert.equal(shouldApplyMannRequest(5, 5), true);

console.log("MANN vehicle resolver regression tests — passed");
