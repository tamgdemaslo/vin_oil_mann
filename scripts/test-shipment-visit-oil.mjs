import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
});
const { deriveShipmentVisitOilSuggestion } = await jiti.import("../src/lib/shipment-visit-oil.ts");
const { pickSingleJournalOilNoteFromRawRows } = await jiti.import("../src/lib/job-order-poster-oil-note.ts");

const catalogOil = (overrides = {}) => ({
  name: "Mobil 1 ESP 5W-30",
  quantity: 4.5,
  assortmentType: "product",
  assortmentHref: "local://product/oil-1",
  uomName: "л",
  groupPath: "Масла / Моторные масла",
  ...overrides,
});

assert.deepEqual(deriveShipmentVisitOilSuggestion([]), {
  candidates: [],
  suggestedOilName: null,
  suggestedActualVolumeLiters: null,
  state: "none",
});

const oneLiterOil = deriveShipmentVisitOilSuggestion([catalogOil()]);
assert.equal(oneLiterOil.state, "single");
assert.equal(oneLiterOil.suggestedOilName, "Mobil 1 ESP 5W-30");
assert.equal(oneLiterOil.suggestedActualVolumeLiters, 4.5, "quantity is actual volume only for a liter sale unit");

const canister = deriveShipmentVisitOilSuggestion([catalogOil({ quantity: 1, uomName: "шт", packageVolume: "5 л" })]);
assert.equal(canister.suggestedActualVolumeLiters, null, "one 5-liter canister must not imply that 5 liters were filled");

const twoOils = deriveShipmentVisitOilSuggestion([
  catalogOil(),
  catalogOil({ name: "Shell Helix Ultra 0W-30", assortmentHref: "local://product/oil-2" }),
]);
assert.equal(twoOils.state, "multiple");
assert.equal(twoOils.suggestedOilName, null, "multiple oils must never select an arbitrary first item");
assert.equal(twoOils.suggestedActualVolumeLiters, null);

const filterOnly = deriveShipmentVisitOilSuggestion([catalogOil({
  name: "Масляный фильтр MANN W 712/95",
  quantity: 1,
  uomName: "шт",
  groupPath: "Фильтры / Масляные фильтры",
})]);
assert.equal(filterOnly.state, "none", "oil filters are not motor-oil candidates");

const customerOilLine = deriveShipmentVisitOilSuggestion([catalogOil({
  assortmentType: "nonstock-product",
  assortmentHref: "local://one-off-product/customer-oil",
  lineKind: "nonstock_product",
})]);
assert.equal(customerOilLine.state, "none", "customer-supplied/manual oil remains an explicit visit field");

const rawOil = (name) => ({ assortment: { name, meta: { type: "product" } } });
assert.equal(pickSingleJournalOilNoteFromRawRows([rawOil("Mobil 1 ESP 5W-30")]), "Mobil 1 ESP 5W-30");
assert.equal(
  pickSingleJournalOilNoteFromRawRows([rawOil("Mobil 1 ESP 5W-30"), rawOil("Shell Helix Ultra 0W-30")]),
  "",
  "a print fallback must also refuse an arbitrary first oil",
);

console.log("Shipment visit oil inference tests — passed");
