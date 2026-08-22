#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const { createQuoteAndTechCardPlan } = await jiti.import("../src/lib/ai-assistant/quote-and-tech-card.ts");

// This is the deterministic replay layer for the 20 field-QA VINs recorded in
// docs/ai-assistant-field-qa-2026-08-22.md.  It intentionally stores only the
// normalized technical inputs already established by the investigation; live
// catalogue stock and supplier prices remain outside this fixture because they
// are time-dependent.  The VIN is an audit label, never a branch in product
// code.
const cases = [
  ["KNAKU811DA5087039", "Kia Sorento XM", "automatic_transmission", "Hyundai/Kia ATF SP-IV", 5, 7.1, "internal_requires_disassembly"],
  ["WBA7D02080G510228", "BMW 740e", "automatic_transmission", "BMW ATF", 5, 8.0, "unknown", "hybrid"],
  ["Z6FDXXEECDEG85039", "Ford Kuga", "automatic_transmission", "Ford MERCON LV", 5, 8.5, "pan_service"],
  ["WBA5E7101FG155636", "BMW 5 Series", "automatic_transmission", "ZF LifeguardFluid 8", 7, 9.0, "integrated_with_pan"],
  ["XWEPH81BDG0002341", "Kia Sorento UM", "automatic_transmission", "Hyundai/Kia ATF SP-IV", 8, 8.3, "internal_requires_disassembly"],
  ["2HJYK16526H527754", "Honda Pilot", "automatic_transmission", "Honda ATF DW-1", 4, 8.0, "internal_requires_disassembly"],
  ["Z8UA0A1SSC0020375", "SsangYong New Actyon", "automatic_transmission", "ATF specification requires confirmation", 5, 9.5, "unknown"],
  ["JTHBH96S005045813", "Lexus GS300", "automatic_transmission", "Toyota ATF WS", 3, 8.7, "internal_requires_disassembly"],
  ["WBA2B91060V363862", "BMW 3 Series", "automatic_transmission", "BMW ATF 6", 6, 8.0, "integrated_with_pan"],
  ["WBAHB61030BC27461", "BMW 5 Series E34", "automatic_transmission", "ATF specification requires plate verification", 4, 8.0, "unknown"],
  ["TMBAG7NE3J0313297", "Skoda Octavia", "dsg", "VW G 052 182", 2, 7.0, "external_replaceable"],
  ["TMAJU81VDDJ428980", "Hyundai ix35", "automatic_transmission", "Hyundai/Kia ATF SP-IV", 5, 7.3, "internal_requires_disassembly"],
  ["WAUZZZ4B03N090638", "Audi A6 C5", "automatic_transmission", "VW G 052 162", 4, 9.0, "unknown"],
  ["XTAGFK110LY447751", "Lada Granta", "automatic_transmission", "ATF requires automatic gearbox confirmation", 3, 6.0, "unknown", "manual"],
  ["WVWZZZ1KZBW588069", "Volkswagen Golf", "automatic_transmission", "ATF requires automatic gearbox confirmation", 3, 6.0, "unknown", "manual"],
  ["KNAPH81BDG5168285", "Kia Sportage QL", "automatic_transmission", "Hyundai/Kia ATF SP-IV", 4, 6.7, "internal_requires_disassembly"],
  ["WAUZZZ4F59N058232", "Audi A6 C6", "automatic_transmission", "VW G 055 162", 4, 9.0, "unknown"],
  ["TMBLJ7NS6L8502739", "Skoda Kodiaq", "dsg", "VW DSG specification requires aggregate confirmation", 6, 7.0, "unknown"],
  ["WAUZZZ8R4FA103149", "Audi Q5 Hybrid", "automatic_transmission", "VW G 060 162 A2", 4, 8.6, "integrated_with_pan", "q5-hybrid"],
  ["JMBLYV93WJJ500289", "Mitsubishi Pajero IV", "automatic_transmission", "DiaQueen ATF SP-III", 3, 9.7, "internal_requires_disassembly"],
];

const rules = { transmissionMachineExchangeMultiplier: 1.7, literRoundingStep: 1, transmissionMinimumBillableLiters: 0 };

function normalizedPlan(plan) {
  return {
    hardBlockerCodes: plan.hardBlockers.map((blocker) => blocker.code),
    filterPolicy: plan.filterPolicy,
    options: plan.options.map((option) => ({
      code: option.code,
      technicalQuantityLiters: option.technicalQuantityLiters,
      billableQuantityLiters: option.billableQuantityLiters,
      quantityTrace: option.quantityTrace,
      servicePackage: option.servicePackage,
    })),
  };
}

for (const [vin, vehicleDisplayName, type, requiredFluidSpec, partial, total, filterAccess, mode] of cases) {
  const hybrid = mode === "hybrid" || mode === "q5-hybrid";
  const manual = mode === "manual";
  const aggregate = mode === "q5-hybrid" ? "0BW" : "verified-aggregate";
  const evidence = hybrid ? [{
    source: mode === "q5-hybrid" ? "Audi OEM" : "OEM",
    fact: `${vehicleDisplayName} ${aggregate} requires ${requiredFluidSpec}.`,
    status: "confirmed",
    url: "https://example.test/oem-source",
  }] : [{ source: "Technical source", fact: `${vehicleDisplayName}: capacity ${total} l; ${requiredFluidSpec}.`, status: "confirmed", url: "https://example.test/source" }];
  const input = {
    vehicle: {
      id: `qa:${vin}`,
      displayName: vehicleDisplayName,
      aggregateCode: aggregate,
      snapshot: { transmissionType: manual ? "MECHANICAL" : "Automatic", fuelType: hybrid ? "Hybrid" : "Petrol" },
    },
    service: {
      type,
      name: "Замена жидкости трансмиссии",
      aggregate,
      requiredFluidSpec,
      partialTechnicalQuantityLiters: partial,
      totalTechnicalQuantityLiters: total,
      filterAccess,
      procedures: ["partial", "machine"],
    },
    requestedProcedures: ["partial", "machine"],
    localCatalogChecked: true,
    evidence,
  };
  const first = createQuoteAndTechCardPlan(input, rules);
  const second = createQuoteAndTechCardPlan(input, rules);
  assert.deepEqual(normalizedPlan(first), normalizedPlan(second), `${vin}: identical normalized input must produce the same technical result`);
  assert.equal(first.options.length, 2, `${vin}: every requested procedure has an option`);
  assert.equal(first.options[0].code, "partial", `${vin}: stable option order starts with partial service`);
  assert.equal(first.options[1].code, "machine", `${vin}: stable option order retains machine service`);
  assert.equal(first.options[1].billableQuantityLiters, Math.ceil(total * 1.7), `${vin}: machine quantity uses the one canonical pipeline`);
  assert.ok(first.filterPolicy.access !== undefined, `${vin}: filter policy is always resolved or honestly unknown`);
  assert.equal(first.options.every((option) => option.servicePackage.levelAdjustment), true, `${vin}: service package owns level adjustment`);
  if (manual) assert.equal(first.hardBlockers.some((blocker) => blocker.code === "TRANSMISSION_SERVICE_MISMATCH"), true, `${vin}: manual transmission cannot receive an ATF quote`);
  if (mode === "q5-hybrid") assert.equal(first.hardBlockers.some((blocker) => /HYBRID|SAFETY_CRITICAL/u.test(blocker.code)), false, `${vin}: sourced 0BW hybrid profile remains valid`);
}

console.log(`AI quote-and-tech-card field replay — ${cases.length} VIN cases × 2 runs passed`);
