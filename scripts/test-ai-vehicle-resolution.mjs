#!/usr/bin/env node

import assert from "node:assert/strict";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { didClientRefuseVin, groupCatalogApplications, resolveVehicleVariants } = await jiti.import(
  "../src/lib/ai-agent/vehicle-resolution.ts"
);

function row(overrides = {}) {
  return {
    variantId: "variant-1",
    make: "Ford",
    model: "Mondeo",
    detail: "2.5",
    vehicleText: "Mondeo IV 2.5",
    effectiveVehicleText: "Mondeo IV 2.5",
    engineCode: "HUBA",
    kw: "162",
    hp: "220",
    vehicleYears: "2007-2015",
    vehicleYearFrom: 2007,
    vehicleYearTo: 2015,
    condition: null,
    filterType: "oil",
    filterSubtype: null,
    mannArticle: "HU719/8X",
    filterNote: null,
    sourceFile: "mann.csv",
    catalogPage: 1,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    make: "Ford",
    model: "Mondeo",
    year: 2015,
    engine: "2.5",
    power: null,
    transmission: null,
    drive: null,
    requestGoal: "rough_quote",
    ...overrides,
  };
}

const fordRows = [
  row(),
  row({ filterType: "air", mannArticle: "C24137/1" }),
  row({
    variantId: "variant-2",
    detail: "2.5(CNG)",
    vehicleText: "Mondeo V 2.5(CNG)",
    effectiveVehicleText: "Mondeo V 2.5(CNG)",
    engineCode: "C25HDEX",
    kw: "110",
    hp: "150",
    vehicleYears: "2015-",
    vehicleYearFrom: 2015,
    vehicleYearTo: null,
    mannArticle: "W7015",
  }),
  row({
    variantId: "variant-2",
    detail: "2.5(CNG)",
    vehicleText: "Mondeo V 2.5(CNG)",
    effectiveVehicleText: "Mondeo V 2.5(CNG)",
    engineCode: "C25HDEX",
    kw: "110",
    hp: "150",
    vehicleYears: "2015-",
    vehicleYearFrom: 2015,
    vehicleYearTo: null,
    filterType: "air",
    mannArticle: "C25008/1",
  }),
];

const ford = resolveVehicleVariants(input(), groupCatalogApplications(fordRows));
assert.equal(ford.variants.length, 2);
assert.equal(ford.componentConfidence.vehicleConfidence, "LOW");
assert.equal(ford.componentConfidence.oilFilterConfidence, "LOW");
assert.equal(ford.recommendedAction, "preliminary_quote_and_clarify");
assert.equal(ford.preliminaryAllowed, true);
assert.equal(ford.vinPolicy.askNow, false);
assert.match(ford.clarifyingQuestion, /220/);
assert.match(ford.clarifyingQuestion, /150/);
assert.match(ford.clarifyingQuestion, /CNG/i);
assert.doesNotMatch(ford.clarifyingQuestion, /VIN|ВИН/i);

const exact = resolveVehicleVariants(input(), groupCatalogApplications(fordRows.slice(0, 2)));
assert.equal(exact.exact, true);
assert.equal(exact.componentConfidence.vehicleConfidence, "HIGH");
assert.equal(exact.componentConfidence.oilFilterConfidence, "HIGH");
assert.equal(exact.recommendedAction, "continue");

const medium = resolveVehicleVariants(
  input({ engine: null, requestGoal: "filter_selection" }),
  groupCatalogApplications(fordRows.slice(0, 2))
);
assert.equal(medium.componentConfidence.vehicleConfidence, "MEDIUM");
assert.equal(medium.componentConfidence.partsFitmentConfidence, "HIGH");

const sameOutputRows = [
  row({ variantId: "same-1", effectiveVehicleText: "Mondeo 2.5 версия A", engineCode: "HUBA", hp: "220" }),
  row({ variantId: "same-2", effectiveVehicleText: "Mondeo 2.5 версия B", engineCode: "HUBA", hp: "220" }),
];
const sameOutput = resolveVehicleVariants(
  input({ requestGoal: "filter_selection" }),
  groupCatalogApplications(sameOutputRows)
);
assert.equal(sameOutput.componentConfidence.oilFilterConfidence, "HIGH");
assert.equal(sameOutput.componentConfidence.partsFitmentConfidence, "HIGH");
assert.equal(sameOutput.componentConfidence.vehicleConfidence, "HIGH");
assert.equal(sameOutput.recommendedAction, "continue");
assert.equal(sameOutput.clarifyingQuestion, null);
assert.equal(sameOutput.canContinueWithoutVin, true);

assert.equal(didClientRefuseVin("VIN не знаю, посчитайте без него"), true);
assert.equal(didClientRefuseVin("Давайте без ВИН"), true);
assert.equal(didClientRefuseVin("Там только один мотор 2.5"), true);
assert.equal(didClientRefuseVin("VIN: WF0EXXGBBE1234567"), false);

console.log("AI vehicle resolution tests: HIGH/MEDIUM/LOW and VIN refusal — passed");
