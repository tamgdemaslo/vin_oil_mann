import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(root, "src") }, interopDefault: true });
const taxonomy = await jiti.import("../src/lib/sales-analytics-taxonomy.ts");
const oneOffService = await jiti.import("../src/lib/one-off-service.ts");
const analytics = await jiti.import("../src/lib/sales-performance-analytics.ts");
const salesPlans = await jiti.import("../src/lib/sales-plans.ts");

const {
  SALES_ANALYTICS_METRICS,
  classifySalesAnalyticsLine,
  salesAnalyticsMappingKey,
} = taxonomy;
const { normalizeOneOffServiceInput } = oneOffService;
const {
  calculateAttachOpportunity,
  calculateSalesPotential,
  countSalesPlanWorkingDays,
  normalizeSalesPerformancePeriod,
  summarizeSalesPerformanceLines,
} = analytics;
const { normalizeSalesPlanMonth, parseSalesPlanRowKey } = salesPlans;

function classify(input) {
  return classifySalesAnalyticsLine({
    positionName: input.name || "Позиция",
    quantity: input.quantity ?? 1,
    ...input,
  });
}

function rowKey(classification) {
  if (classification.status === "unclassified") {
    return ["unclassified", classification.kind, classification.manualSourceType, classification.manualSourceId].join(":");
  }
  if (classification.kind === "product") return `product:${classification.metricCode}`;
  return [
    "service",
    classification.metricCode,
    classification.aggregateType ?? "-",
    classification.procedure ?? "-",
    classification.configuration ?? "-",
  ].join(":");
}

let lineSequence = 0;
function line({
  demandId,
  branchId = "branch-a",
  clientId = "client-a",
  classification,
  quantity = 1,
  revenueCents = 10_000,
  costCents = classification.kind === "service" ? 0 : 6_000,
  name = "Позиция",
}) {
  lineSequence += 1;
  return {
    positionId: `position-${lineSequence}`,
    branchId,
    branchName: branchId,
    demandId,
    demandName: demandId,
    documentDate: "2026-09-02",
    storeName: "Основной склад",
    clientId,
    clientName: clientId,
    positionName: name,
    kind: classification.kind,
    quantity,
    revenueCents,
    costCents,
    grossProfitCents: costCents == null ? null : revenueCents - costCents,
    classification,
    rowKey: rowKey(classification),
  };
}

const airFilter = classify({ kind: "product", groupName: "Воздушные фильтры", quantity: 2, name: "MANN C 35 154" });
assert.equal(airFilter.metricCode, "AIR_FILTER", "product group classifies a SKU without inspecting its name");
assert.equal(airFilter.baseQuantity, 2);

const airReplacement = classify({ kind: "service", productId: "cmphdo2mc01t48zksevroqafy", name: "Любое новое имя" });
assert.equal(airReplacement.metricCode, "AIR_FILTER_REPLACEMENT", "stable service ID survives a rename");

const combined = summarizeSalesPerformanceLines([
  line({ demandId: "shipment-1", classification: airFilter, quantity: 2 }),
  line({ demandId: "shipment-1", classification: airReplacement }),
]);
assert.equal(combined.products.find((row) => row.metricCode === "AIR_FILTER")?.quantity, 2);
assert.equal(combined.products.find((row) => row.metricCode === "AIR_FILTER")?.documentsCount, 1);
assert.equal(combined.services.find((row) => row.metricCode === "AIR_FILTER_REPLACEMENT")?.operationsCount, 1);
assert.notEqual(combined.products[0].key, combined.services[0].key, "goods and services never share an aggregate");

const partial = classify({ kind: "service", productId: "cmphdnwh201sk8zksfqm75ji8", name: "Частичная замена" });
const machine = classify({ kind: "service", productId: "cmphdnvw601si8zkssrecv1st", name: "Аппаратная замена" });
assert.equal(partial.procedure, "PARTIAL");
assert.equal(machine.procedure, "MACHINE");
const transmission = summarizeSalesPerformanceLines([
  line({ demandId: "shipment-atf", classification: partial }),
  line({ demandId: "shipment-atf", classification: partial, name: "Дубль строки" }),
  line({ demandId: "shipment-atf", classification: machine }),
]);
assert.equal(transmission.services.find((row) => row.procedure === "PARTIAL")?.operationsCount, 1, "duplicate service lines count as one operation");
assert.equal(transmission.services.find((row) => row.procedure === "MACHINE")?.operationsCount, 1);

const levelCheck = classify({ kind: "service", name: "Проверка уровня масла в АКПП" });
assert.equal(levelCheck.metricCode, "DIAGNOSTIC", "level setting is not an oil-change operation");

const structuredService = normalizeOneOffServiceInput({
  analyticsMetricCode: "TRANSMISSION_FLUID_SERVICE",
  aggregateType: "CVT",
  procedure: "PARTIAL",
  configuration: "TWO_FILTERS",
});
const cvtService = classify({ kind: "service", name: "Замена внешнего фильтра вариатора", raw: { oneOffService: structuredService } });
assert.equal(cvtService.metricCode, "TRANSMISSION_FLUID_SERVICE");
assert.equal(cvtService.aggregateType, "CVT");
assert.equal(cvtService.procedure, "PARTIAL");
assert.equal(cvtService.configuration, "TWO_FILTERS");
assert.throws(() => normalizeOneOffServiceInput({ analyticsMetricCode: "" }), /Выберите аналитическую категорию/);

const oneOffAirFilter = classify({
  kind: "product",
  name: "Разовый фильтр",
  raw: { oneOffProduct: { groupCode: "AIR_FILTER", uomCode: "PCS" } },
});
assert.equal(oneOffAirFilter.metricCode, "AIR_FILTER", "one-off product uses its structured group code");

const unclassified = classify({ kind: "service", name: "Уникальная работа без mapping" });
assert.equal(unclassified.status, "unclassified");
const queue = summarizeSalesPerformanceLines([line({ demandId: "shipment-u", classification: unclassified })]);
assert.equal(queue.unclassified.length, 1);
assert.equal(queue.unclassified[0].documentsCount, 1);

const manualMappings = new Map([
  [salesAnalyticsMappingKey("CATALOG_ITEM", "service-manual"), { metricCode: "OTHER_SERVICE", matchMethod: "MANUAL", version: 3 }],
]);
assert.equal(classify({ kind: "service", productId: "service-manual", mappings: manualMappings }).metricCode, "OTHER_SERVICE");

const renamedSnapshot = classify({
  kind: "service",
  name: "Полностью переименовано",
  snapshot: {
    metricCode: "TRANSMISSION_FLUID_SERVICE",
    mappingVersion: 7,
    procedure: "MACHINE",
    aggregateType: "DCT_DSG",
    configuration: "PAN_AND_FILTER",
  },
});
assert.equal(renamedSnapshot.matchMethod, "SNAPSHOT");
assert.equal(renamedSnapshot.procedure, "MACHINE");
assert.equal(renamedSnapshot.aggregateType, "DCT_DSG");

const missingCost = summarizeSalesPerformanceLines([
  line({ demandId: "shipment-cost", classification: airFilter, costCents: null }),
]);
assert.equal(missingCost.products.find((row) => row.metricCode === "AIR_FILTER")?.grossProfitCents, null, "unknown cost never becomes zero profit input");
assert.equal(missingCost.products.find((row) => row.metricCode === "AIR_FILTER")?.missingCostLines, 1);

const oilChange = classify({ kind: "service", productId: "cmphdnx1z01sm8zksgngu23b7", name: "Замена масла" });
const attach = summarizeSalesPerformanceLines([
  line({ demandId: "oil-visit-1", classification: oilChange }),
  line({ demandId: "oil-visit-1", classification: airFilter }),
  line({ demandId: "oil-visit-2", classification: oilChange }),
  line({ demandId: "standalone-filter", classification: airFilter }),
]);
const airAttach = attach.attachRates.find((row) => row.metricCode === "AIR_FILTER");
assert.equal(airAttach.denominatorVisits, 2);
assert.equal(airAttach.attachedVisits, 1);
assert.equal(airAttach.standaloneVisits, 1);
assert.equal(airAttach.ratePercent, 50);

assert.deepEqual(calculateSalesPotential(10, 2_500, 1_900), {
  amountCents: 25_000,
  averagePerUnitCents: 2_500,
  source: "PLAN",
}, "explicit plan value has priority over the 90-day average");
assert.deepEqual(calculateSalesPotential(10, null, 1_900), {
  amountCents: 19_000,
  averagePerUnitCents: 1_900,
  source: "LAST_90_DAYS",
});
assert.deepEqual(calculateSalesPotential(10, null, null), {
  amountCents: null,
  averagePerUnitCents: null,
  source: "UNAVAILABLE",
}, "potential stays unavailable without a plan value or historical basis");
assert.deepEqual(calculateAttachOpportunity(3, 1, 50, 4_000), {
  targetAttachedVisits: 2,
  opportunityVisits: 1,
  opportunityGrossProfitCents: 4_000,
}, "attach target uses ceil on distinct eligible visits");
assert.deepEqual(calculateAttachOpportunity(3, 1, 50, null), {
  targetAttachedVisits: 2,
  opportunityVisits: 1,
  opportunityGrossProfitCents: null,
}, "attach profit is unavailable without an average gross-profit basis");
assert.deepEqual(calculateAttachOpportunity(3, 2, 50, null), {
  targetAttachedVisits: 2,
  opportunityVisits: 0,
  opportunityGrossProfitCents: 0,
}, "zero attach opportunity is zero even when no profit basis is needed");

const branchLines = [
  line({ demandId: "branch-a-sale", branchId: "branch-a", classification: airFilter }),
  line({ demandId: "branch-b-sale", branchId: "branch-b", classification: airFilter }),
];
const branchA = summarizeSalesPerformanceLines(branchLines.filter((item) => item.branchId === "branch-a"));
const branchB = summarizeSalesPerformanceLines(branchLines.filter((item) => item.branchId === "branch-b"));
const allBranches = summarizeSalesPerformanceLines(branchLines);
assert.equal(
  allBranches.products.find((row) => row.metricCode === "AIR_FILTER")?.quantity,
  (branchA.products.find((row) => row.metricCode === "AIR_FILTER")?.quantity ?? 0)
    + (branchB.products.find((row) => row.metricCode === "AIR_FILTER")?.quantity ?? 0),
  "all-branches equals the sum of branch aggregates",
);

const custom = normalizeSalesPerformancePeriod({ period: "custom", dateFrom: "2026-08-11", dateTo: "2026-08-20" });
assert.equal(custom.comparisonDateFrom, "2026-08-01");
assert.equal(custom.comparisonDateTo, "2026-08-10");
const currentMonth = normalizeSalesPerformancePeriod({ period: "current-month" });
assert.equal(currentMonth.dateFrom.slice(8), "01");
assert.equal(currentMonth.comparisonDateFrom.slice(8), "01");
assert.equal(
  (Date.parse(`${currentMonth.dateTo}T12:00:00Z`) - Date.parse(`${currentMonth.dateFrom}T12:00:00Z`)) / 86_400_000,
  (Date.parse(`${currentMonth.comparisonDateTo}T12:00:00Z`) - Date.parse(`${currentMonth.comparisonDateFrom}T12:00:00Z`)) / 86_400_000,
  "unfinished month compares the same number of elapsed days",
);

assert.equal(SALES_ANALYTICS_METRICS.filter((metric) => metric.type === "PRODUCT_CATEGORY").length, 12);
assert.equal(SALES_ANALYTICS_METRICS.filter((metric) => metric.type === "SERVICE_OPERATION").length, 12);

assert.equal(normalizeSalesPlanMonth("2026-09"), "2026-09");
assert.throws(() => normalizeSalesPlanMonth("09.2026"), /ГГГГ-ММ/);
assert.deepEqual(parseSalesPlanRowKey("product:AIR_FILTER"), {
  rowKey: "product:AIR_FILTER",
  metricCode: "AIR_FILTER",
  metricType: "PRODUCT_CATEGORY",
  aggregateType: null,
  procedure: null,
  configuration: null,
});
assert.equal(parseSalesPlanRowKey("service:TRANSMISSION_FLUID_SERVICE:CVT:PARTIAL:TWO_FILTERS").procedure, "PARTIAL");
assert.throws(() => parseSalesPlanRowKey("unclassified:service:any"), /Некорректный ключ/);
assert.deepEqual(countSalesPlanWorkingDays("2026-09", "2026-09-02", [1, 2, 3, 4, 5, 6]), {
  totalWorkingDays: 26,
  elapsedWorkingDays: 2,
  remainingWorkingDays: 24,
});
assert.deepEqual(countSalesPlanWorkingDays("2026-09", "2026-09-30", [1, 2, 3, 4, 5]), {
  totalWorkingDays: 22,
  elapsedWorkingDays: 22,
  remainingWorkingDays: 0,
});

const serviceSource = fs.readFileSync(resolve(root, "src/lib/sales-performance-analytics.ts"), "utf8");
const detailRoute = fs.readFileSync(resolve(root, "src/app/api/warehouse/analytics/sales-performance/details/route.ts"), "utf8");
const mappingRoute = fs.readFileSync(resolve(root, "src/app/api/warehouse/analytics/sales-classification/route.ts"), "utf8");
const demandWrite = fs.readFileSync(resolve(root, "src/lib/local-demand-write.ts"), "utf8");
const salesUi = fs.readFileSync(resolve(root, "src/app/warehouse/product-analytics/SalesPerformancePanel.tsx"), "utf8");
const plansRoute = fs.readFileSync(resolve(root, "src/app/api/warehouse/analytics/sales-plans/route.ts"), "utf8");
const plansService = fs.readFileSync(resolve(root, "src/lib/sales-plans.ts"), "utf8");
const plansMigration = fs.readFileSync(resolve(root, "prisma/migrations/20260902300000_branch_sales_plans/migration.sql"), "utf8");
assert.match(serviceSource, /branchId:\s*\{ in: branchIds \}/, "database query is explicitly branch scoped");
assert.match(serviceSource, /applicable:\s*true/, "only the current posted state is included");
assert.doesNotMatch(serviceSource, /shipmentRevision|\.revisions/i, "revisions are never aggregated as sales");
assert.doesNotMatch(serviceSource, /name\.includes\(/, "runtime analytics does not use fuzzy name includes");
assert.match(serviceSource, /businessGroupId:\s*context\.businessGroupId[\s\S]*mode:\s*context\.mode[\s\S]*branchIds:\s*\[\.\.\.branchIds\]\.sort\(\)/, "cache key contains the full server-authorized scope");
assert.match(serviceSource, /planVersion:\s*planContext\.versionKey/, "cache key contains the plan version");
assert.match(serviceSource, /addDays\(period\.dateTo, -89\)/, "potential uses a rolling 90-day basis");
assert.match(serviceSource, /productLine\.grossProfitCents == null/, "missing product cost is excluded rather than converted to zero");
assert.match(serviceSource, /Math\.ceil\(eligible \* rate \/ 100\)/, "attach target rounds up to a whole distinct visit");
assert.match(serviceSource, /standaloneVisits/, "standalone filter sales remain separate from attach calculations");
assert.match(detailRoute, /readableBranchIds\(access\.context\)/);
assert.match(mappingRoute, /invalidateSalesPerformanceAnalytics\(\)/);
assert.match(mappingRoute, /branchAuditLog\.create/);
assert.match(demandWrite, /freezeSalesAnalyticsSnapshots/);
assert.match(demandWrite, /invalidateSalesPerformanceAnalytics\(\)/);
assert.match(salesUi, /href=\{`\/shipment\/\$\{encodeURIComponent\(row\.shipmentId\)\}`\}/, "drill-down opens the source shipment");
assert.match(salesUi, /План \/ факт/);
assert.match(salesUi, /Возможности роста/);
assert.match(salesUi, /Потенциал до плана/);
assert.match(salesUi, /Это оценка потенциала, а не зафиксированная потеря/);
assert.doesNotMatch(salesUi, /упущенн(?:ая|ой|ые)|потерянн(?:ая|ой|ые)/i, "growth UI does not label estimates as losses");
assert.match(plansRoute, /saveSalesPlans\(access\.context/);
assert.match(plansService, /branchAuditLog\.create/);
assert.match(plansService, /runWithBranchApiTargetContext/);
assert.match(plansService, /Attach rate задаётся только для воздушного или салонного фильтра/);
assert.match(plansMigration, /CHECK \("month" ~/);

console.log("sales performance analytics tests: ok");
