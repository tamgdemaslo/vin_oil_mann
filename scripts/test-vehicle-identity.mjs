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
assert.deepEqual(normalizePlateInput("Т 332 ЕК 39"), { original: "Т 332 ЕК 39", normalized: "T332EK39" });
assert.equal(normalizeVehicleMake("Mercedes-Benz"), "MERCEDES");
assert.equal(normalizeVehicleMake("LandRover"), "LAND ROVER");
assert.equal(normalizeEngineCode("B47 D20-A"), "B47D20-A");
assert.deepEqual(normalizeVehicleModel("BMW 5 (G30, G31, F90)", "BMW"), {
  raw: "BMW 5 (G30, G31, F90)",
  canonical: "5",
  generation: undefined,
  bodyCode: "G30",
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

console.log("Vehicle identity normalization tests — passed");
