#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const { FLUID_CAPACITY_PARSER_VERSION, parseFluidCapacities } = await jiti.import(
  "../src/lib/fluid-capacity-parser.ts",
);

assert.equal(FLUID_CAPACITY_PARSER_VERSION, "capacity-parser-v5");

const tolerance = parseFluidCapacities("Заправочный объём 5,6 ± 0,1 л", "ENGINE_OIL");
assert.equal(tolerance.capacities.length, 1);
assert.deepEqual(
  tolerance.capacities.map(({ qualifier, nominalLiters, toleranceLiters, minLiters, maxLiters }) => ({
    qualifier,
    nominalLiters,
    toleranceLiters,
    minLiters,
    maxLiters,
  })),
  [{ qualifier: "TOLERANCE", nominalLiters: 5.6, toleranceLiters: 0.1, minLiters: 5.5, maxLiters: 5.7 }],
);

for (const value of ["5-6 л", "5 – 6 литров", "5...6 litres", "5 … 6 litres."]) {
  const parsed = parseFluidCapacities(value);
  assert.deepEqual(parsed.capacities.map(({ qualifier, minLiters, maxLiters }) => ({ qualifier, minLiters, maxLiters })), [
    { qualifier: "RANGE", minLiters: 5, maxLiters: 6 },
  ]);
}

const contextual = parseFluidCapacities(
  "Без фильтра 4,2 л; с масляным фильтром 4.5 литра\nчастичная замена 6 л; полный объём 8,1 л",
);
assert.deepEqual(contextual.capacities.map(({ kind, nominalLiters }) => [kind, nominalLiters]), [
  ["WITHOUT_FILTER", 4.2],
  ["WITH_FILTER", 4.5],
  ["PARTIAL", 6],
  ["TOTAL", 8.1],
]);

const uncertainty = parseFluidCapacities("около 5 л; до 7,5 л");
assert.deepEqual(
  uncertainty.capacities.map(({ qualifier, minLiters, maxLiters, nominalLiters, confidence }) => ({
    qualifier,
    minLiters,
    maxLiters,
    nominalLiters,
    confidence,
  })),
  [
    { qualifier: "APPROXIMATE", minLiters: null, maxLiters: null, nominalLiters: 5, confidence: "MEDIUM" },
    { qualifier: "UP_TO", minLiters: null, maxLiters: 7.5, nominalLiters: null, confidence: "MEDIUM" },
  ],
);

for (const horsepower of ["136 л.с.", "136 лс", "136 л. с.", "136 Л.С."]) {
  const parsed = parseFluidCapacities(horsepower, "ENGINE_OIL");
  assert.equal(parsed.capacities.length, 0, horsepower);
  assert.equal(parsed.rejected.filter((item) => item.code === "HORSEPOWER_COLLISION").length, 1, horsepower);
}

const mixedHorsepower = parseFluidCapacities("Мощность 170 л.с.; заправка 4,3 л.", "ENGINE_OIL");
assert.deepEqual(mixedHorsepower.capacities.map(({ nominalLiters }) => nominalLiters), [4.3]);
assert.equal(mixedHorsepower.rejected[0]?.raw, "170 л.с.");

const serviceAbbreviationBoundary = parseFluidCapacities("2.5 л. сервисный объём", "TRANSFER_CASE");
assert.deepEqual(serviceAbbreviationBoundary.capacities.map(({ kind, nominalLiters }) => [kind, nominalLiters]), [["SERVICE", 2.5]]);
assert.equal(serviceAbbreviationBoundary.rejected.length, 0);

const withFilterBoundary = parseFluidCapacities("4.2 л. с фильтром 4.0 л. без фильтра", "ENGINE_OIL");
assert.deepEqual(withFilterBoundary.capacities.map(({ kind, nominalLiters }) => [kind, nominalLiters]), [
  ["WITH_FILTER", 4.2],
  ["WITHOUT_FILTER", 4],
]);
assert.equal(withFilterBoundary.rejected.length, 0);

const componentCodes = parseFluidCapacities("1.0 л. для 215LW 1.3 л. для 215LWS", "REAR_DIFFERENTIAL");
assert.deepEqual(componentCodes.capacities.map(({ nominalLiters }) => nominalLiters), [1, 1.3]);

const processKinds = parseFluidCapacities("5.0 л. для частичной замены 6.9 л. для полной замены 9.0 л. для аппаратной замены");
assert.deepEqual(processKinds.capacities.map(({ kind, nominalLiters }) => [kind, nominalLiters]), [
  ["PARTIAL", 5],
  ["TOTAL", 6.9],
  ["REFILL", 9],
]);
assert.equal(processKinds.needsReview, false);

const unresolvedConditional = parseFluidCapacities("10.9 л. общий объём для 2015-2018 г. 10.4 л. общий объём для 2019-2022 г.");
assert.equal(unresolvedConditional.needsReview, true);
assert.equal(unresolvedConditional.suspicious[0]?.code, "UNRESOLVED_CONDITIONAL_CAPACITY");

for (const text of [
  "3.3 л. для K7M 4.9 л. для K4M",
  "7.4 л. для B6304T2 6.8 л. для B6304T4",
  "11.6 л. для бензина 12.7 л. для дизеля",
]) {
  const parsed = parseFluidCapacities(text, "ENGINE_OIL");
  assert.equal(parsed.needsReview, true, text);
  assert.ok(parsed.suspicious.some((item) => item.code === "UNRESOLVED_CONDITIONAL_CAPACITY"), text);
}

const omittedFirstUnitConditional = parseFluidCapacities("6.5 для бензина 7.0 л. для дизеля", "ENGINE_COOLANT");
assert.equal(omittedFirstUnitConditional.needsReview, true);
assert.ok(omittedFirstUnitConditional.suspicious.some((item) => item.code === "UNRESOLVED_CONDITIONAL_CAPACITY"));

const engineDisplacementAfterCapacity = parseFluidCapacities("6.6 л. для SKYACTIV-G 2.0", "ENGINE_COOLANT");
assert.equal(engineDisplacementAfterCapacity.needsReview, false);
assert.deepEqual(engineDisplacementAfterCapacity.capacities.map(({ nominalLiters }) => nominalLiters), [6.6]);

const closeConditionalAlternatives = parseFluidCapacities("5.5 л. для моделей с МКПП 5.6 л. для моделей с АКПП", "ENGINE_COOLANT");
assert.equal(closeConditionalAlternatives.needsReview, true);
assert.ok(closeConditionalAlternatives.suspicious.some((item) => item.code === "UNRESOLVED_CONDITIONAL_CAPACITY"));

const distinctServiceContexts = parseFluidCapacities("6.1 л. сервисный объём 7.1 л. общий объём", "ENGINE_OIL");
assert.equal(distinctServiceContexts.needsReview, false);

const sourceLexicon = parseFluidCapacities("5.9 л. общий объём 2.5 л. слив 3.0 л. долив 5.5 л. объём без фильтра 5.9 л. объём c фильтром");
assert.deepEqual(sourceLexicon.capacities.map(({ kind, nominalLiters }) => [kind, nominalLiters]), [
  ["TOTAL", 5.9],
  ["PARTIAL", 2.5],
  ["REFILL", 3],
  ["WITHOUT_FILTER", 5.5],
  ["WITH_FILTER", 5.9],
]);

const suspicious = parseFluidCapacities("136 л", "ENGINE_OIL");
assert.equal(suspicious.capacities[0]?.confidence, "LOW");
assert.equal(suspicious.needsReview, true);
assert.equal(suspicious.suspicious[0]?.code, "OUTSIDE_SYSTEM_PLAUSIBILITY");

const golden = JSON.parse(await readFile(resolve(workspaceRoot, "benchmarks/fluid-capacity-golden-v2.json"), "utf8"));
assert.equal(golden.parserVersion, FLUID_CAPACITY_PARSER_VERSION);
assert.equal(golden.cases.length, 200);
assert.equal(new Set(golden.cases.map((item) => item.text)).size, 200);
for (const testCase of golden.cases) {
  const actual = parseFluidCapacities(testCase.text, testCase.systemCode);
  const stableActual = {
    capacities: actual.capacities.map((capacity) => ({
      kind: capacity.kind,
      minLiters: capacity.minLiters,
      maxLiters: capacity.maxLiters,
      nominalLiters: capacity.nominalLiters,
      toleranceLiters: capacity.toleranceLiters,
      context: capacity.context,
      confidence: capacity.confidence,
      raw: capacity.raw,
      qualifier: capacity.qualifier,
      serviceContext: capacity.serviceContext,
      filterContext: capacity.filterContext,
    })),
    rejected: actual.rejected.map(({ code, raw }) => ({ code, raw })),
    suspicious: actual.suspicious.map(({ code, raw }) => ({ code, raw })),
    needsReview: actual.needsReview,
  };
  assert.deepEqual(stableActual, testCase.expected, testCase.caseId);
}

console.log("Fluid capacity parser v5 regressions + 200-case real golden set — passed");
