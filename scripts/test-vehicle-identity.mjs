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

console.log("Vehicle identity normalization tests — passed");
