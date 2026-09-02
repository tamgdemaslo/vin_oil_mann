import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { calculateLineFinancials } from "../src/lib/inventory-costing.ts";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) },
});
const {
  assertNonstockProductPostingCost,
  NONSTOCK_PRODUCT_ASSORTMENT_TYPE,
  NONSTOCK_PRODUCT_PAYROLL_GROUP_NAMES,
  normalizeNonstockProductArticle,
  normalizeNonstockProductBrand,
  normalizeNonstockProductInput,
} = await jiti.import("../src/lib/one-off-product.ts");
const { sameExactProductIdentity } = await jiti.import("../src/lib/product-identity.ts");

for (const input of ["mann filter", "Mann-Filter", "MANN FILTER"]) {
  assert.equal(normalizeNonstockProductBrand(input).display, "MANN-FILTER");
}

assert.equal(normalizeNonstockProductArticle("c 27 161").display, "C 27 161");
assert.notEqual(
  normalizeNonstockProductArticle("C27161").canonical,
  normalizeNonstockProductArticle("C2716/1").canonical,
  "meaningful slash must preserve product identity",
);

const normalized = normalizeNonstockProductInput({
  groupCode: "AIR_FILTER",
  brand: "mann filter",
  article: "c 35 154",
  uomCode: "PCS",
  purchasePrice: 900,
  purchaseSourceLabel: "Соседний магазин",
});
assert.equal(normalized.name, "Воздушный фильтр MANN-FILTER C 35 154");
assert.equal(normalized.purchasePriceCents, 90_000);
assert.equal(normalized.analyticsKey, "AIR_FILTER|MANN-FILTER|C35154");
assert.equal(NONSTOCK_PRODUCT_PAYROLL_GROUP_NAMES.AIR_FILTER, "Воздушные фильтры");
assert.equal(NONSTOCK_PRODUCT_PAYROLL_GROUP_NAMES.OTHER, undefined, "ambiguous groups must require payroll allocation");

const otherA = normalizeNonstockProductInput({
  groupCode: "OTHER",
  brand: "OEM",
  article: "",
  clarification: "Крепёж бампера",
  uomCode: "PCS",
  purchasePrice: 100,
});
const otherB = normalizeNonstockProductInput({
  groupCode: "OTHER",
  brand: "OEM",
  article: "",
  clarification: "Крепёж защиты",
  uomCode: "PCS",
  purchasePrice: 100,
});
assert.notEqual(otherA.analyticsKey, otherB.analyticsKey, "clarification separates items without an article");
assert.equal(
  sameExactProductIdentity(
    { brand: "mann filter", article: "c 35 154" },
    { brand: "MANN-FILTER", article: "C 35 154" },
  ),
  true,
  "brand and own article identify an exact catalog product",
);
assert.equal(
  sameExactProductIdentity(
    { brand: "MANN-FILTER", article: "C 35 154" },
    { brand: "FILTRON", article: "AP 139/2" },
  ),
  false,
  "an OEM analogue is not an exact product",
);

assert.throws(
  () => assertNonstockProductPostingCost({ purchasePriceCents: null, explicitZeroCost: false }),
  /Укажите закупочную цену/,
);
assert.throws(
  () => assertNonstockProductPostingCost({ purchasePriceCents: 0, explicitZeroCost: false }),
  /Получено бесплатно/,
);
assert.doesNotThrow(() => assertNonstockProductPostingCost({ purchasePriceCents: 0, explicitZeroCost: true }));

const financials = calculateLineFinancials({
  quantity: 1,
  salePriceCents: 140_000,
  discountPercent: 0,
  assortmentType: NONSTOCK_PRODUCT_ASSORTMENT_TYPE,
  snapshotCents: 90_000,
});
assert.equal(financials.revenueCents, 140_000);
assert.equal(financials.costCents, 90_000);
assert.equal(financials.profitCents, 50_000);
assert.equal(financials.marginPercent, 50_000 / 140_000 * 100);
assert.deepEqual(financials.cost, {
  unitCostCents: 90_000,
  source: "one_off_purchase_snapshot",
  status: "confirmed",
});

const discounted = calculateLineFinancials({
  quantity: 2,
  salePriceCents: 140_000,
  discountPercent: 10,
  assortmentType: NONSTOCK_PRODUCT_ASSORTMENT_TYPE,
  snapshotCents: 90_000,
});
assert.equal(discounted.revenueCents, 252_000, "discount reduces revenue");
assert.equal(discounted.costCents, 180_000, "discount must not reduce COGS");

const missingCostFinancials = calculateLineFinancials({
  quantity: 1,
  salePriceCents: 140_000,
  assortmentType: NONSTOCK_PRODUCT_ASSORTMENT_TYPE,
  snapshotCents: null,
});
assert.equal(missingCostFinancials.revenueCents, 140_000);
assert.equal(missingCostFinancials.costCents, null);
assert.equal(missingCostFinancials.profitCents, null);
assert.equal(missingCostFinancials.marginPercent, null);
assert.deepEqual(
  missingCostFinancials.cost,
  { unitCostCents: null, source: "missing", status: "missing" },
  "missing one-off cost must not become zero",
);

const root = new URL("../", import.meta.url);
const demandWrite = fs.readFileSync(new URL("src/lib/local-demand-write.ts", root), "utf8");
const shipmentUi = fs.readFileSync(new URL("src/app/shipment/new/NewShipmentPageClient.tsx", root), "utf8");
const copyRoute = fs.readFileSync(new URL("src/app/api/demands/[id]/copy/route.ts", root), "utf8");
const oneOffApi = fs.readFileSync(new URL("src/app/api/demands/one-off-product/route.ts", root), "utf8");
const closingDocuments = fs.readFileSync(new URL("src/lib/closing-documents.ts", root), "utf8");
const closingPrint = fs.readFileSync(new URL("src/components/closing-documents/ClosingDocumentPrint.tsx", root), "utf8");
const finance = fs.readFileSync(new URL("src/lib/local-inventory-finance.ts", root), "utf8");
const payroll = fs.readFileSync(new URL("src/lib/payroll.ts", root), "utf8");
const demandRead = fs.readFileSync(new URL("src/lib/local-inventory-read.ts", root), "utf8");
const paymentRoute = fs.readFileSync(new URL("src/app/api/demands/[id]/payment/route.ts", root), "utf8");
const warehouseAnalytics = fs.readFileSync(new URL("src/lib/warehouse-product-analytics.ts", root), "utf8");
const nonstockBuilder = demandWrite.slice(
  demandWrite.indexOf("async function buildNonstockResolvedPosition"),
  demandWrite.indexOf("async function resolveCreatePositions"),
);

assert.match(demandWrite, /productId:\s*null,[\s\S]*assortmentType:\s*NONSTOCK_PRODUCT_ASSORTMENT_TYPE/);
assert.match(demandWrite, /supplierCounterpartyIdentityWhere\(\)/, "purchase source must be a branch supplier");
assert.match(demandWrite, /isNonstockProductType\(position\.assortmentType\)/, "posting must validate non-stock cost separately");
assert.match(demandWrite, /function isStockTrackedType[\s\S]*type === "product"[\s\S]*type === "variant"[\s\S]*type === "bundle"/);
assert.match(demandWrite, /if \(!position\.productId \|\| !isStockTrackedType\(position\.assortmentType\)\) continue/);
assert.match(nonstockBuilder, /buyPriceCentsPerUnit:\s*normalized\.purchasePriceCents/);
assert.match(nonstockBuilder, /oneOffProduct:\s*structured/);
assert.match(nonstockBuilder, /slotName:\s*null/);
assert.doesNotMatch(nonstockBuilder, /localProduct\.(?:create|upsert)|localStockBalance\.(?:create|upsert)|inventoryLedgerEntry\.create/i);
assert.match(shipmentUi, /Добавить разовый товар/);
assert.match(shipmentUi, /title="Добавить товар только в эту отгрузку без создания карточки в каталоге"/);
assert.match(shipmentUi, /nonstockProductOpen &&/);
assert.match(shipmentUi, /NONSTOCK_PRODUCT_GROUPS/);
assert.match(shipmentUi, /lineKind:\s*"nonstock_product"/);
assert.match(shipmentUi, /Такой товар уже есть в каталоге/);
assert.match(shipmentUi, /Оформить как разовую внешнюю покупку/);
assert.match(shipmentUi, /складской остаток существующей карточки изменён не будет/i);
assert.match(shipmentUi, /local:\/\/manual-service\//, "one-off service flow remains available");
assert.match(shipmentUi, /Укажите закупочную цену разового товара\. Без неё прибыль по отгрузке будет рассчитана неверно/);
assert.match(copyRoute, /one_off_price_check/);
assert.match(copyRoute, /Закупочная цена взята из предыдущей отгрузки\. Проверьте актуальность/);
assert.match(oneOffApi, /where:\s*\{\s*branchId,\s*archived:\s*false\s*\}/, "catalog lookup is branch scoped");
assert.match(oneOffApi, /sameExactProductIdentity/);
assert.doesNotMatch(oneOffApi, /oemParts/i, "OEM analogues are not used for the exact match");
assert.doesNotMatch(oneOffApi, /buyPriceCents|purchasePriceCents/, "the new lookup API does not disclose catalog cost");
assert.match(closingDocuments, /articleDisplay/);
assert.match(closingDocuments, /uomLabel/);
assert.match(closingPrint, /row\.name/);
assert.doesNotMatch(closingPrint, /purchasePrice|purchaseSource|buyPrice/, "client print does not expose purchase data");
assert.match(finance, /one_off_purchase_snapshot/);
assert.match(finance, /analyticsKey/);
assert.match(payroll, /position\.assortmentType !== "nonstock_product"/);
assert.match(demandWrite, /groupIdSnapshot:\s*payrollGroup\?\.id \?\? null/);
assert.match(payroll, /position\.groupIdSnapshot/);
assert.match(payroll, /resolveGroupPieceworkRule/);
assert.match(payroll, /calculateLineFinancials/);
assert.match(demandRead, /positions[\s\S]*JSON\.stringify\(position\.raw/);
assert.match(paymentRoute, /nonstockOilRequiresCheck/);
assert.match(warehouseAnalytics, /productId/, "warehouse product analytics remains product-card based");

console.log("one-off product tests: ok");
