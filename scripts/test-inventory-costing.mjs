import assert from "node:assert/strict";
import {
  calculateAverageAfterValuedRemoval,
  calculateLineFinancials,
  calculateWeightedAverageCostCents,
  resolvePostedCost,
} from "../src/lib/inventory-costing.ts";

assert.equal(
  calculateWeightedAverageCostCents({
    oldQuantity: 2,
    oldAverageCostCents: 167_200,
    receivedQuantity: 1,
    receiptUnitCostCents: 175_600,
  }),
  170_000,
  "moving average must use quantity-weighted receipt cost"
);

let acceptanceAverage = calculateWeightedAverageCostCents({
  oldQuantity: 0,
  oldAverageCostCents: null,
  receivedQuantity: 10,
  receiptUnitCostCents: 70_000,
});
acceptanceAverage = calculateWeightedAverageCostCents({
  oldQuantity: 10,
  oldAverageCostCents: acceptanceAverage,
  receivedQuantity: 10,
  receiptUnitCostCents: 90_000,
});
assert.equal(acceptanceAverage, 80_000, "10×700 plus 10×900 produces an 800 average");
const acceptanceSale = calculateLineFinancials({
  quantity: 5,
  salePriceCents: 120_000,
  assortmentType: "product",
  snapshotCents: acceptanceAverage,
});
assert.equal(acceptanceSale.costCents, 400_000, "selling five units snapshots 5×800 COGS");
acceptanceAverage = calculateWeightedAverageCostCents({
  oldQuantity: 15,
  oldAverageCostCents: acceptanceAverage,
  receivedQuantity: 10,
  receiptUnitCostCents: 100_000,
});
assert.equal(acceptanceAverage, 88_000, "a receipt after the sale uses the real remaining quantity");

assert.equal(
  calculateWeightedAverageCostCents({
    oldQuantity: 0,
    oldAverageCostCents: null,
    receivedQuantity: 1.5,
    receiptUnitCostCents: 12_345,
  }),
  12_345,
  "first receipt establishes average cost"
);

assert.throws(
  () => calculateWeightedAverageCostCents({
    oldQuantity: 2,
    oldAverageCostCents: null,
    receivedQuantity: 1,
    receiptUnitCostCents: 10_000,
    productName: "Товар без opening cost",
  }),
  /opening cost/,
  "a positive opening balance without cost must never fall back to card price"
);

assert.deepEqual(
  resolvePostedCost({ assortmentType: "service", snapshotCents: 99_999 }),
  { unitCostCents: 0, source: "service", status: "confirmed" },
  "non-stock services always have explicit zero COGS"
);

assert.deepEqual(
  resolvePostedCost({ assortmentType: "product", snapshotCents: null }),
  { unitCostCents: null, source: "missing", status: "missing" },
  "missing product COGS stays missing"
);

assert.deepEqual(
  resolvePostedCost({ assortmentType: "nonstock_product", snapshotCents: 0 }),
  { unitCostCents: 0, source: "one_off_purchase_snapshot", status: "confirmed" },
  "an explicitly confirmed free one-off product keeps a zero purchase snapshot"
);

const fractional = calculateLineFinancials({
    quantity: 1.25,
    salePriceCents: 1_000,
    discountPercent: 10,
    assortmentType: "product",
    snapshotCents: 600,
  });
assert.deepEqual(
  { ...fractional, marginPercent: Number(fractional.marginPercent?.toFixed(6)) },
  {
    revenueCents: 1_125,
    costCents: 750,
    profitCents: 375,
    grossProfitCents: 375,
    marginPercent: 33.333333,
    costPerUnitCents: 600,
    costSource: "posted_snapshot",
    costStatus: "confirmed",
    cost: { unitCostCents: 600, source: "posted_snapshot", status: "confirmed" },
  },
  "fractional quantity and discount use one rounding rule"
);

assert.equal(
  calculateAverageAfterValuedRemoval({
    oldQuantity: 3,
    oldAverageCostCents: 1_700,
    removedQuantity: 1,
    removedUnitCostCents: 1_756,
  }),
  1_672,
  "reposting a reversed movement restores the pre-reversal average"
);

let shellAverage = calculateWeightedAverageCostCents({
  oldQuantity: 0,
  oldAverageCostCents: null,
  receivedQuantity: 2,
  receiptUnitCostCents: 500_000,
});
let shellQuantity = 2;
shellQuantity -= 1; // sale does not change the average
shellAverage = calculateWeightedAverageCostCents({
  oldQuantity: shellQuantity,
  oldAverageCostCents: shellAverage,
  receivedQuantity: 1,
  receiptUnitCostCents: 432_000,
});
shellQuantity += 1;
shellAverage = calculateWeightedAverageCostCents({
  oldQuantity: shellQuantity,
  oldAverageCostCents: shellAverage,
  receivedQuantity: 1,
  receiptUnitCostCents: 432_000,
});
assert.equal(shellAverage, 454_667, "sales between differently priced receipts keep moving average history");

assert.equal(
  calculateLineFinancials({
    quantity: 1,
    salePriceCents: 669_000,
    assortmentType: "product",
    snapshotCents: null,
  }).profitCents,
  null,
  "a current card-price change cannot alter a posted line without a snapshot"
);

assert.equal(
  calculateLineFinancials({
    quantity: 1,
    salePriceCents: 10_000,
    assortmentType: "service",
    snapshotCents: 5_000,
  }).profitCents,
  10_000,
  "all reports must ignore legacy non-zero service snapshots"
);

console.log("inventory costing tests: ok");
