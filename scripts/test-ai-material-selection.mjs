#!/usr/bin/env node

import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve(process.cwd(), "src") } });
const {
  fluidSpecificationMatches,
  fluidSpecificationExcerpt,
  fluidSpecificationAlternatives,
  fluidSpecificationSearchTokenGroups,
  normalizeFluidSpecification,
  packageVolumeLiters,
  employeeRequestedOriginalFluidOnly,
  selectPreferredLocalFluid,
  shouldRequireOriginalFluid,
} = await jiti.import("../src/lib/ai-assistant/material-selection.ts");

const valvoline = {
  id: "valvoline-cvt",
  name: "Valvoline Light & Heavy Duty ATF / CVT, 1 л",
  salePriceCents: 199000,
  uomName: "л",
  packageVolume: "1 л",
  markingMode: "BULK_OIL_FROM_MARKED_BARREL",
  atf: "Honda ATF-Z1 (кроме CVT); Toyota\tCVTF FE; CVTF TC",
  oemAtf: null,
  searchText: "valvoline light heavy duty atf cvt toyota cvtf fe",
  availableUnits: 86.86,
};

assert.equal(normalizeFluidSpecification("Toyota Genuine CVT Fluid FE"), "toyota cvt fe");
assert.equal(fluidSpecificationMatches(valvoline, "Toyota Genuine CVT Fluid FE"), true);
assert.match(fluidSpecificationExcerpt(`${"Honda CVT; ".repeat(80)}Toyota\tCVTF FE; CVTF TC`, "Toyota Genuine CVT Fluid FE"), /Toyota\s+CVTF FE/i);
assert.equal(packageVolumeLiters(valvoline), 1);
assert.equal(employeeRequestedOriginalFluidOnly("Нужна замена жидкости в вариаторе Toyota C-HR"), false);
assert.equal(employeeRequestedOriginalFluidOnly("Поставьте только оригинальную жидкость Toyota, без аналогов"), true);
assert.equal(shouldRequireOriginalFluid({ fluidPreference: "original_only", employeeRequestedOriginalOnly: false }), false);
assert.equal(shouldRequireOriginalFluid({ fluidPreference: "original_only", employeeRequestedOriginalOnly: true }), true);

const selected = selectPreferredLocalFluid([valvoline], "Toyota Genuine CVT Fluid FE", 8);
assert.ok(selected);
assert.equal(selected.productId, "valvoline-cvt");
assert.equal(selected.quantity, 8);
assert.equal(selected.totalCents, 1_592_000);
assert.match(selected.compatibilityEvidence, /toyota\s+cvtf fe/i);

// The model can explicitly offer alternatives as "SP-IV / SP4-M".  A local
// product must be found if it states one of those alternatives; the resolver
// must not require the same catalog row to contain both names.
const hyundaiSpIv = {
  ...valvoline,
  id: "valvoline-hyundai-sp-iv",
  name: "ATF Hyundai/Kia SP-IV, 1 л",
  atf: "Hyundai/Kia ATF SP-IV; Toyota ATF WS",
  searchText: "Valvoline ATF Hyundai Kia SP-IV",
};
assert.deepEqual(fluidSpecificationAlternatives("Hyundai ATF SP-IV / SP4-M"), ["Hyundai ATF SP-IV", "SP4-M"]);
assert.deepEqual(fluidSpecificationSearchTokenGroups("Hyundai ATF SP-IV / SP4-M"), [["hyundai", "atf", "sp", "iv"], ["sp4", "m"]]);
assert.equal(fluidSpecificationMatches(hyundaiSpIv, "Hyundai ATF SP-IV / SP4-M"), true);
assert.match(fluidSpecificationExcerpt(hyundaiSpIv.atf, "Hyundai ATF SP-IV / SP4-M"), /Hyundai\/Kia ATF SP-IV/i);
assert.equal(selectPreferredLocalFluid([hyundaiSpIv], "Hyundai ATF SP-IV / SP4-M", 5)?.productId, "valvoline-hyundai-sp-iv");

const insufficient = selectPreferredLocalFluid([{ ...valvoline, availableUnits: 7.99 }], "Toyota CVTF FE", 8);
assert.equal(insufficient, null);

const fourLiterCan = {
  ...valvoline,
  id: "four-liter-can",
  name: "CVTF FE 4 л",
  salePriceCents: 800000,
  uomName: "шт",
  packageVolume: "4 л",
  markingMode: "NOT_MARKED",
  availableUnits: 2,
};
assert.equal(packageVolumeLiters(fourLiterCan), 4);
assert.equal(selectPreferredLocalFluid([fourLiterCan], "Toyota CVTF FE", 8)?.quantity, 2);

console.log("AI material selection tests — passed");
