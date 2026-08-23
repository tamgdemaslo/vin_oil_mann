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

assert.equal(MANN_FLUID_MATCHER_VERSION, "mann-fluid-matcher-v2");

const single = matchFluidRequirementToMann(requirement(), [row({})]);
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

console.log("MANN fluid matcher v2 system-aware policy tests — passed");
