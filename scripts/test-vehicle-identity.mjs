import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": new URL("../src", import.meta.url).pathname },
});
const {
  normalizeEngineCode,
  normalizeFrameInput,
  normalizePlateInput,
  normalizeVehicleMake,
  normalizeVehicleModel,
  normalizeVinInput,
  toVehicle,
} = await jiti.import("../src/lib/vehicle-identity.ts");

assert.equal(normalizeVinInput(" wba5e-7101 fg155636 "), "WBA5E7101FG155636");
assert.equal(normalizeFrameInput(" zvw52-3030148 "), "ZVW523030148");
assert.deepEqual(normalizePlateInput("Т 332 ЕК 39"), { original: "Т 332 ЕК 39", normalized: "Т332ЕК39" });
assert.deepEqual(normalizePlateInput("T-744-KO-39"), { original: "T-744-KO-39", normalized: "Т744КО39" });
assert.equal(normalizeVehicleMake("Mercedes-Benz"), "MERCEDES");
assert.equal(normalizeVehicleMake("LandRover"), "LAND ROVER");
assert.equal(normalizeEngineCode("B47 D20-A"), "B47D20A");
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

console.log("Vehicle identity normalization tests — passed");
