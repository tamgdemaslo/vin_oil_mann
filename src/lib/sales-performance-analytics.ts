import { Prisma, type BranchSalesPlan } from "@prisma/client";
import type { BranchContext } from "@/lib/branch-context";
import { prisma } from "@/lib/db";
import { calculateLineFinancials } from "@/lib/inventory-costing";
import {
  SALES_ANALYTICS_METRICS,
  classifySalesAnalyticsLine,
  normalizeSalesAnalyticsText,
  salesAnalyticsMappingKey,
  type SalesAnalyticsClassification,
  type SalesAnalyticsMappingValue,
  type SalesAnalyticsMatchMethod,
  type SalesAnalyticsMetricDefinition,
  type SalesAnalyticsMetricType,
  type SalesAnalyticsSourceType,
  type SalesAnalyticsUnit,
  type ServiceAggregateType,
  type ServiceConfiguration,
  type ServiceProcedure,
} from "@/lib/sales-analytics-taxonomy";

const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 64;
const MAX_POSITION_ROWS = 100_000;

export type SalesPerformanceParams = {
  period?: string;
  dateFrom?: string;
  dateTo?: string;
  storeId?: string;
  metricCode?: string;
  refresh?: boolean;
};

export type SalesPerformancePeriod = {
  key: string;
  label: string;
  dateFrom: string;
  dateTo: string;
  days: number;
  comparisonDateFrom: string;
  comparisonDateTo: string;
  comparisonLabel: string;
};

export type SalesPerformanceComparison = {
  value: number;
  previousValue: number;
  delta: number;
  deltaPercent: number | null;
};

export type SalesPerformanceProductRow = {
  key: string;
  metricCode: string;
  title: string;
  unit: SalesAnalyticsUnit;
  quantity: number | null;
  rawQuantity: number;
  quantityCoveragePercent: number;
  linesCount: number;
  documentsCount: number;
  clientsCount: number;
  revenueCents: number;
  costCents: number | null;
  grossProfitCents: number | null;
  marginPercent: number | null;
  missingCostLines: number;
  comparison: {
    quantity: SalesPerformanceComparison | null;
    revenue: SalesPerformanceComparison;
    grossProfit: SalesPerformanceComparison | null;
  };
};

export type SalesPerformanceServiceRow = {
  key: string;
  metricCode: string;
  title: string;
  aggregateType: ServiceAggregateType | null;
  procedure: ServiceProcedure | null;
  configuration: ServiceConfiguration | null;
  operationsCount: number;
  linesCount: number;
  clientsCount: number;
  directRevenueCents: number;
  linkedRevenueCents: number;
  linkedCostCents: number | null;
  linkedGrossProfitCents: number | null;
  linkedMissingCostLines: number;
  comparison: {
    operations: SalesPerformanceComparison;
    directRevenue: SalesPerformanceComparison;
  };
};

export type SalesPerformanceUnclassifiedRow = {
  key: string;
  kind: "product" | "service";
  sourceType: SalesAnalyticsSourceType;
  sourceId: string;
  name: string;
  linesCount: number;
  documentsCount: number;
  rawQuantity: number;
  revenueCents: number;
  branchNames: string[];
  reason: string;
};

export type SalesPerformanceAttachRate = {
  metricCode: "AIR_FILTER" | "CABIN_FILTER";
  title: string;
  denominatorVisits: number;
  attachedVisits: number;
  standaloneVisits: number;
  ratePercent: number | null;
  previousRatePercent: number | null;
};

export type SalesPerformanceWorkingCalendar = {
  branchId: string;
  branchName: string;
  source: "BRANCH_SCHEDULE" | "DEFAULT_MONDAY_SATURDAY";
  workingWeekdays: number[];
  totalWorkingDays: number;
  elapsedWorkingDays: number;
  remainingWorkingDays: number;
};

export type SalesPerformancePotentialBasis = {
  source: "PLAN" | "LAST_90_DAYS" | "MIXED" | "UNAVAILABLE";
  averagePerUnitCents: number | null;
  periodDateFrom: string | null;
  periodDateTo: string | null;
  sampleUnits: number;
  excludedMissingCostLines: number;
};

export type SalesPerformanceAttachOpportunity = {
  rowKey: string;
  metricCode: "AIR_FILTER" | "CABIN_FILTER";
  title: string;
  eligibleVisits: number;
  attachedVisits: number;
  standaloneVisits: number;
  actualRatePercent: number | null;
  targetRatePercent: number;
  targetAttachedVisits: number;
  opportunityVisits: number;
  averageGrossProfitPerAttachedSaleCents: number | null;
  opportunityGrossProfitCents: number | null;
  grossProfitBasis: SalesPerformancePotentialBasis;
  plannedBranches: number;
  totalBranches: number;
};

export type SalesPerformancePlanFactRow = {
  rowKey: string;
  metricCode: string;
  kind: "product" | "service";
  title: string;
  unit: SalesAnalyticsUnit;
  aggregateType: ServiceAggregateType | null;
  procedure: ServiceProcedure | null;
  configuration: ServiceConfiguration | null;
  targetCount: number;
  actualCount: number | null;
  previousActualCount: number | null;
  changePercent: number | null;
  completionPercent: number | null;
  remainingToPlan: number | null;
  forecastCount: number | null;
  forecastGap: number | null;
  forecastPreliminary: boolean;
  requiredPerWorkingDay: number | null;
  actualRevenueCents: number;
  targetRevenueCents: number | null;
  forecastRevenueCents: number | null;
  actualGrossProfitCents: number | null;
  targetGrossProfitCents: number | null;
  forecastGrossProfitCents: number | null;
  targetAttachRatePercent: number | null;
  expectedRevenuePerUnitCents: number | null;
  expectedGrossProfitPerUnitCents: number | null;
  potentialRevenueCents: number | null;
  potentialGrossProfitCents: number | null;
  potentialRevenueBasis: SalesPerformancePotentialBasis;
  potentialGrossProfitBasis: SalesPerformancePotentialBasis;
  status: "completed" | "on-pace" | "risk" | "no-data";
  plannedBranches: number;
  totalBranches: number;
  note: string | null;
};

export type SalesPerformanceAnalytics = {
  period: SalesPerformancePeriod;
  calculatedAt: string;
  cacheTtlSeconds: number;
  scope: {
    mode: "branch" | "all";
    businessGroupId: string;
    branchIds: string[];
    branchNames: string[];
    canManageMappings: boolean;
    canManagePlans: boolean;
  };
  filters: { storeId: string; metricCode: string };
  summary: {
    revenueCents: number;
    productRevenueCents: number;
    serviceDirectRevenueCents: number;
    grossProfitCents: number | null;
    documentsCount: number;
    clientsCount: number;
    classifiedOperationsCount: number;
    previousRevenueCents: number;
    revenueDeltaPercent: number | null;
    productLines: number;
    classifiedProductLines: number;
    serviceLines: number;
    classifiedServiceLines: number;
    unclassifiedLines: number;
    missingCostLines: number;
    literLines: number;
    classifiedLiterLines: number;
  };
  products: SalesPerformanceProductRow[];
  services: SalesPerformanceServiceRow[];
  attachRates: SalesPerformanceAttachRate[];
  unclassified: SalesPerformanceUnclassifiedRow[];
  options: {
    productMetrics: SalesAnalyticsMetricDefinition[];
    serviceMetrics: SalesAnalyticsMetricDefinition[];
  };
  plan: {
    available: boolean;
    reason: string | null;
    month: string | null;
    canEdit: boolean;
    calendars: SalesPerformanceWorkingCalendar[];
    summary: {
      plannedRows: number;
      completedRows: number;
      onPaceRows: number;
      riskRows: number;
      plannedBranches: number;
      totalBranches: number;
      potentialRevenueCents: number | null;
      potentialGrossProfitCents: number | null;
      potentialRows: number;
      unavailableProfitRows: number;
      attachOpportunityVisits: number;
      attachOpportunityGrossProfitCents: number | null;
    };
    rows: SalesPerformancePlanFactRow[];
    attachOpportunities: SalesPerformanceAttachOpportunity[];
  };
  warnings: string[];
};

export type SalesPerformanceDetailRow = {
  positionId: string;
  shipmentId: string;
  shipmentName: string;
  documentDate: string;
  branchId: string;
  branchName: string;
  storeName: string | null;
  clientName: string | null;
  positionName: string;
  kind: "product" | "service";
  quantity: number;
  baseQuantity: number | null;
  baseUnit: SalesAnalyticsUnit | null;
  revenueCents: number;
  costCents: number | null;
  grossProfitCents: number | null;
  metricCode: string | null;
  metricTitle: string | null;
  aggregateType: ServiceAggregateType | null;
  procedure: ServiceProcedure | null;
  configuration: ServiceConfiguration | null;
  matchMethod: SalesAnalyticsMatchMethod | null;
};

type CachedAnalytics = { expiresAt: number; value: SalesPerformanceAnalytics };
const analyticsCache = ((globalThis as typeof globalThis & {
  __ecoSalesPerformanceCache?: Map<string, CachedAnalytics>;
}).__ecoSalesPerformanceCache ??= new Map<string, CachedAnalytics>());

export function invalidateSalesPerformanceAnalytics() {
  analyticsCache.clear();
}

function readBool(value: string | null): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export function salesPerformanceParamsFromSearchParams(searchParams: URLSearchParams): SalesPerformanceParams {
  return {
    period: searchParams.get("period") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    storeId: searchParams.get("storeId") ?? searchParams.get("warehouseId") ?? undefined,
    metricCode: searchParams.get("metricCode") ?? undefined,
    refresh: readBool(searchParams.get("refresh")),
  };
}

function dateFromYmd(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`);
}

function ymd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = dateFromYmd(value);
  date.setUTCDate(date.getUTCDate() + days);
  return ymd(date);
}

function daysBetween(dateFrom: string, dateTo: string): number {
  return Math.max(1, Math.floor((dateFromYmd(dateTo).getTime() - dateFromYmd(dateFrom).getTime()) / 86_400_000) + 1);
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function monthEnd(value: string): string {
  const date = dateFromYmd(monthStart(value));
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return ymd(date);
}

function shiftMonth(value: string, months: number): string {
  const date = dateFromYmd(monthStart(value));
  date.setUTCMonth(date.getUTCMonth() + months);
  return ymd(date);
}

function todayYmd(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE?.trim() || process.env.APP_TIMEZONE?.trim() || "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

export function normalizeSalesPerformancePeriod(params: SalesPerformanceParams): SalesPerformancePeriod {
  const today = todayYmd();
  const key = String(params.period ?? "current-month").trim() || "current-month";
  const validDate = (value: string | undefined) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
  let dateFrom = validDate(params.dateFrom);
  let dateTo = validDate(params.dateTo);

  if (!dateFrom || !dateTo || key !== "custom") {
    if (key === "today") {
      dateFrom = today;
      dateTo = today;
    } else if (key === "7d") {
      dateFrom = addDays(today, -6);
      dateTo = today;
    } else if (key === "30d") {
      dateFrom = addDays(today, -29);
      dateTo = today;
    } else if (key === "90d") {
      dateFrom = addDays(today, -89);
      dateTo = today;
    } else if (key === "previous-month") {
      dateFrom = shiftMonth(today, -1);
      dateTo = monthEnd(dateFrom);
    } else {
      dateFrom = monthStart(today);
      dateTo = today;
    }
  }
  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  const days = daysBetween(dateFrom, dateTo);
  let comparisonDateFrom: string;
  let comparisonDateTo: string;
  let comparisonLabel: string;
  if (key === "current-month" || key === "previous-month") {
    comparisonDateFrom = shiftMonth(dateFrom, -1);
    comparisonDateTo = addDays(comparisonDateFrom, Math.min(days, daysBetween(comparisonDateFrom, monthEnd(comparisonDateFrom))) - 1);
    comparisonLabel = `к ${comparisonDateFrom} — ${comparisonDateTo}`;
  } else {
    comparisonDateTo = addDays(dateFrom, -1);
    comparisonDateFrom = addDays(comparisonDateTo, -(days - 1));
    comparisonLabel = `к предыдущим ${days} дн.`;
  }
  const labels: Record<string, string> = {
    today: "Сегодня",
    "7d": "7 дней",
    "30d": "30 дней",
    "90d": "90 дней",
    "current-month": "Текущий месяц",
    "previous-month": "Прошлый месяц",
    custom: "Произвольный период",
  };
  return {
    key,
    label: labels[key] ?? "Текущий месяц",
    dateFrom,
    dateTo,
    days,
    comparisonDateFrom,
    comparisonDateTo,
    comparisonLabel,
  };
}

function decimal(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricType(value: string): SalesAnalyticsMetricType | null {
  return value === "PRODUCT_CATEGORY" || value === "SERVICE_OPERATION" ? value : null;
}

function metricUnit(value: string): SalesAnalyticsUnit | null {
  return value === "PCS" || value === "LITER" || value === "OPERATION" ? value : null;
}

function aggregateType(value: string | null): ServiceAggregateType | null {
  return value && ["AUTOMATIC", "CVT", "DCT_DSG", "MANUAL", "UNKNOWN"].includes(value)
    ? value as ServiceAggregateType
    : null;
}

function procedure(value: string | null): ServiceProcedure | null {
  return value && ["PARTIAL", "MACHINE", "STANDARD", "UNKNOWN"].includes(value)
    ? value as ServiceProcedure
    : null;
}

function configuration(value: string | null): ServiceConfiguration | null {
  return value && ["NO_PAN", "PAN_AND_FILTER", "TWO_FILTERS", "OTHER", "UNKNOWN"].includes(value)
    ? value as ServiceConfiguration
    : null;
}

function matchMethod(value: string): SalesAnalyticsMatchMethod {
  return ["SNAPSHOT", "SAVED_CODE", "ID", "GROUP", "STRUCTURED_RAW", "VERIFIED_LEGACY", "MANUAL"].includes(value)
    ? value as SalesAnalyticsMatchMethod
    : "MANUAL";
}

function centsComparison(value: number, previousValue: number): SalesPerformanceComparison {
  return {
    value,
    previousValue,
    delta: value - previousValue,
    deltaPercent: previousValue === 0 ? (value === 0 ? 0 : null) : ((value - previousValue) / Math.abs(previousValue)) * 100,
  };
}

function margin(revenueCents: number, grossProfitCents: number | null): number | null {
  return grossProfitCents == null || revenueCents <= 0 ? null : (grossProfitCents / revenueCents) * 100;
}

function productRowKey(metricCode: string): string {
  return `product:${metricCode}`;
}

function serviceRowKey(classification: SalesAnalyticsClassification): string {
  return [
    "service",
    classification.metricCode ?? "UNCLASSIFIED",
    classification.aggregateType ?? "-",
    classification.procedure ?? "-",
    classification.configuration ?? "-",
  ].join(":");
}

function unclassifiedRowKey(classification: SalesAnalyticsClassification): string {
  return ["unclassified", classification.kind, classification.manualSourceType, classification.manualSourceId].join(":");
}

export type SalesPerformanceLoadedLine = {
  positionId: string;
  branchId: string;
  branchName: string;
  demandId: string;
  demandName: string;
  documentDate: string;
  storeName: string | null;
  clientId: string | null;
  clientName: string | null;
  positionName: string;
  kind: "product" | "service";
  quantity: number;
  revenueCents: number;
  costCents: number | null;
  grossProfitCents: number | null;
  classification: SalesAnalyticsClassification;
  rowKey: string;
};

type LoadResult = {
  lines: SalesPerformanceLoadedLine[];
  metrics: SalesAnalyticsMetricDefinition[];
  truncated: boolean;
};

async function loadLines(
  context: BranchContext,
  branchIds: string[],
  params: SalesPerformanceParams,
  period: SalesPerformancePeriod,
): Promise<LoadResult> {
  const baselineDateFrom = addDays(period.dateTo, -89);
  const dateFrom = [period.comparisonDateFrom, period.dateFrom, baselineDateFrom].sort()[0];
  const dateTo = period.comparisonDateTo > period.dateTo ? period.comparisonDateTo : period.dateTo;
  const [metricRows, mappingRows, positions] = await Promise.all([
    prisma.salesAnalyticsMetric.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.salesAnalyticsMapping.findMany({
      where: { branchId: { in: branchIds }, businessGroupId: context.businessGroupId, active: true },
      orderBy: [{ version: "desc" }],
    }),
    prisma.localDemandPosition.findMany({
      where: {
        branchId: { in: branchIds },
        demand: {
          is: {
            applicable: true,
            documentDate: { gte: dateFrom, lte: dateTo },
            ...(params.storeId ? { storeId: params.storeId } : {}),
          },
        },
      },
      select: {
        id: true,
        branchId: true,
        demandId: true,
        productId: true,
        groupIdSnapshot: true,
        assortmentType: true,
        name: true,
        quantity: true,
        priceCentsPerUnit: true,
        discount: true,
        buyPriceCentsPerUnit: true,
        raw: true,
        analyticsMetricCode: true,
        analyticsCategoryLabel: true,
        analyticsMatchMethod: true,
        analyticsMappingVersion: true,
        serviceAggregateType: true,
        serviceProcedure: true,
        serviceConfiguration: true,
        analyticsBaseQuantity: true,
        analyticsBaseUnit: true,
        groupSnapshot: { select: { name: true } },
        product: { select: { id: true, entityType: true, groupId: true, groupPath: true, uomName: true } },
        demand: {
          select: {
            id: true,
            name: true,
            documentDate: true,
            counterpartyId: true,
            agentNameSnapshot: true,
            storeNameSnapshot: true,
          },
        },
      },
      orderBy: [{ demand: { documentDate: "desc" } }, { id: "asc" }],
      take: MAX_POSITION_ROWS + 1,
    }),
  ]);

  const metrics = metricRows.flatMap((row) => {
    const type = metricType(row.type);
    const unit = metricUnit(row.unit);
    return type && unit ? [{
      code: row.code,
      type,
      title: row.title,
      unit,
      sortOrder: row.sortOrder,
      active: row.active,
      parentCode: row.parentCode,
    }] : [];
  });
  const effectiveMetrics = metrics.length ? metrics : [...SALES_ANALYTICS_METRICS];
  const metricMap = new Map(effectiveMetrics.map((metric) => [metric.code, metric] as const));
  const mappingsByBranch = new Map<string, Map<string, SalesAnalyticsMappingValue>>();
  for (const row of mappingRows) {
    const branchMappings = mappingsByBranch.get(row.branchId) ?? new Map<string, SalesAnalyticsMappingValue>();
    const sourceType = row.sourceType as SalesAnalyticsSourceType;
    branchMappings.set(salesAnalyticsMappingKey(sourceType, row.sourceId), {
      metricCode: row.metricCode,
      matchMethod: matchMethod(row.matchMethod),
      version: row.version,
      aggregateType: aggregateType(row.aggregateType),
      procedure: procedure(row.procedure),
      configuration: configuration(row.configuration),
    });
    mappingsByBranch.set(row.branchId, branchMappings);
  }
  const branchNameById = new Map(context.branches.map((branch) => [branch.id, branch.displayName || branch.shortName || branch.name]));
  const truncated = positions.length > MAX_POSITION_ROWS;
  const lines = positions.slice(0, MAX_POSITION_ROWS).map((position): SalesPerformanceLoadedLine => {
    const kind: "product" | "service" = position.assortmentType === "service" || position.product?.entityType === "service"
      ? "service"
      : "product";
    const quantity = decimal(position.quantity);
    const financials = calculateLineFinancials({
      quantity,
      salePriceCents: position.priceCentsPerUnit,
      discountPercent: decimal(position.discount),
      assortmentType: position.assortmentType,
      snapshotCents: position.buyPriceCentsPerUnit,
    });
    const classification = classifySalesAnalyticsLine({
      kind,
      productId: position.productId,
      groupId: position.groupIdSnapshot ?? position.product?.groupId,
      groupName: position.groupSnapshot?.name ?? position.product?.groupPath,
      positionName: position.name,
      quantity,
      uomName: position.product?.uomName,
      raw: position.raw,
      snapshot: {
        metricCode: position.analyticsMetricCode,
        categoryLabel: position.analyticsCategoryLabel,
        matchMethod: position.analyticsMatchMethod,
        mappingVersion: position.analyticsMappingVersion,
        aggregateType: position.serviceAggregateType,
        procedure: position.serviceProcedure,
        configuration: position.serviceConfiguration,
        baseQuantity: position.analyticsBaseQuantity == null ? null : decimal(position.analyticsBaseQuantity),
        baseUnit: position.analyticsBaseUnit,
      },
      mappings: mappingsByBranch.get(position.branchId),
      metrics: metricMap,
    });
    const rowKey = classification.status === "unclassified"
      ? unclassifiedRowKey(classification)
      : kind === "product"
        ? productRowKey(classification.metricCode as string)
        : serviceRowKey(classification);
    return {
      positionId: position.id,
      branchId: position.branchId,
      branchName: branchNameById.get(position.branchId) ?? position.branchId,
      demandId: position.demandId,
      demandName: position.demand.name,
      documentDate: position.demand.documentDate,
      storeName: position.demand.storeNameSnapshot,
      clientId: position.demand.counterpartyId,
      clientName: position.demand.agentNameSnapshot,
      positionName: position.name,
      kind,
      quantity,
      revenueCents: financials.revenueCents,
      costCents: financials.costCents,
      grossProfitCents: financials.grossProfitCents,
      classification,
      rowKey,
    };
  });
  return { lines, metrics: effectiveMetrics, truncated };
}

type ProductAccumulator = {
  metric: SalesAnalyticsMetricDefinition;
  rawQuantity: number;
  baseQuantity: number;
  baseQuantityLines: number;
  linesCount: number;
  demandIds: Set<string>;
  clientIds: Set<string>;
  revenueCents: number;
  costCents: number;
  missingCostLines: number;
};

type ServiceAccumulator = {
  key: string;
  metric: SalesAnalyticsMetricDefinition;
  aggregateType: ServiceAggregateType | null;
  procedure: ServiceProcedure | null;
  configuration: ServiceConfiguration | null;
  operationKeys: Set<string>;
  demandIds: Set<string>;
  clientIds: Set<string>;
  linesCount: number;
  directRevenueCents: number;
  linkedRevenueCents: number;
  linkedCostCents: number;
  linkedMissingCostLines: number;
};

type UnclassifiedAccumulator = {
  key: string;
  kind: "product" | "service";
  sourceType: SalesAnalyticsSourceType;
  sourceId: string;
  name: string;
  lineCount: number;
  demandIds: Set<string>;
  rawQuantity: number;
  revenueCents: number;
  branchNames: Set<string>;
  reason: string;
};

type AggregateResult = {
  lines: SalesPerformanceLoadedLine[];
  products: Map<string, ProductAccumulator>;
  services: Map<string, ServiceAccumulator>;
  unclassified: Map<string, UnclassifiedAccumulator>;
  allDemandIds: Set<string>;
  allClientIds: Set<string>;
  productRevenueCents: number;
  serviceRevenueCents: number;
  knownGrossProfitCents: number;
  missingCostLines: number;
  productLines: number;
  classifiedProductLines: number;
  serviceLines: number;
  classifiedServiceLines: number;
  literLines: number;
  classifiedLiterLines: number;
  engineOilVisitIds: Set<string>;
  productDemandIds: Map<string, Set<string>>;
};

function serviceAcceptsProduct(serviceCode: string, productCode: string): boolean {
  if (serviceCode === "ENGINE_OIL_CHANGE") return ["ENGINE_OIL", "OIL_FILTER", "SEALS_GASKETS"].includes(productCode);
  if (serviceCode === "AIR_FILTER_REPLACEMENT") return productCode === "AIR_FILTER";
  if (serviceCode === "CABIN_FILTER_REPLACEMENT") return productCode === "CABIN_FILTER";
  if (serviceCode === "FUEL_FILTER_REPLACEMENT") return productCode === "FUEL_FILTER";
  if (["TRANSMISSION_FLUID_SERVICE", "TRANSFER_CASE_FLUID_CHANGE", "FRONT_DIFFERENTIAL_FLUID_CHANGE", "REAR_DIFFERENTIAL_FLUID_CHANGE"].includes(serviceCode)) {
    return ["TRANSMISSION_FLUID", "TRANSMISSION_FILTER", "SEALS_GASKETS"].includes(productCode);
  }
  if (serviceCode === "BRAKE_FLUID_CHANGE") return productCode === "BRAKE_FLUID";
  if (serviceCode === "COOLANT_CHANGE") return productCode === "COOLANT";
  return false;
}

function aggregateLines(lines: SalesPerformanceLoadedLine[], metrics: SalesAnalyticsMetricDefinition[]): AggregateResult {
  const metricByCode = new Map(metrics.map((metric) => [metric.code, metric] as const));
  const products = new Map<string, ProductAccumulator>();
  const services = new Map<string, ServiceAccumulator>();
  const unclassified = new Map<string, UnclassifiedAccumulator>();
  const allDemandIds = new Set<string>();
  const allClientIds = new Set<string>();
  const engineOilVisitIds = new Set<string>();
  const productDemandIds = new Map<string, Set<string>>();
  let productRevenueCents = 0;
  let serviceRevenueCents = 0;
  let knownGrossProfitCents = 0;
  let missingCostLines = 0;
  let productLines = 0;
  let classifiedProductLines = 0;
  let serviceLines = 0;
  let classifiedServiceLines = 0;
  let literLines = 0;
  let classifiedLiterLines = 0;

  for (const line of lines) {
    allDemandIds.add(line.demandId);
    if (line.clientId) allClientIds.add(line.clientId);
    if (line.kind === "product") {
      productLines += 1;
      productRevenueCents += line.revenueCents;
      if (line.grossProfitCents == null) missingCostLines += 1;
      else knownGrossProfitCents += line.grossProfitCents;
    } else {
      serviceLines += 1;
      serviceRevenueCents += line.revenueCents;
      knownGrossProfitCents += line.grossProfitCents ?? line.revenueCents;
    }

    const classification = line.classification;
    if (classification.status === "unclassified" || !classification.metricCode) {
      const current = unclassified.get(line.rowKey) ?? {
        key: line.rowKey,
        kind: line.kind,
        sourceType: classification.manualSourceType,
        sourceId: classification.manualSourceId,
        name: line.positionName,
        lineCount: 0,
        demandIds: new Set<string>(),
        rawQuantity: 0,
        revenueCents: 0,
        branchNames: new Set<string>(),
        reason: classification.reason ?? "Не классифицировано",
      };
      current.lineCount += 1;
      current.demandIds.add(line.demandId);
      current.rawQuantity += line.quantity;
      current.revenueCents += line.revenueCents;
      current.branchNames.add(line.branchName);
      unclassified.set(line.rowKey, current);
      continue;
    }

    const metric = metricByCode.get(classification.metricCode);
    if (!metric) continue;
    if (line.kind === "product") {
      classifiedProductLines += 1;
      if (metric.unit === "LITER") {
        literLines += 1;
        if (classification.baseQuantity != null) classifiedLiterLines += 1;
      }
      const key = productRowKey(metric.code);
      const current = products.get(key) ?? {
        metric,
        rawQuantity: 0,
        baseQuantity: 0,
        baseQuantityLines: 0,
        linesCount: 0,
        demandIds: new Set<string>(),
        clientIds: new Set<string>(),
        revenueCents: 0,
        costCents: 0,
        missingCostLines: 0,
      };
      current.rawQuantity += line.quantity;
      current.linesCount += 1;
      current.demandIds.add(line.demandId);
      if (line.clientId) current.clientIds.add(line.clientId);
      current.revenueCents += line.revenueCents;
      if (classification.baseQuantity != null) {
        current.baseQuantity += classification.baseQuantity;
        current.baseQuantityLines += 1;
      }
      if (line.costCents == null) current.missingCostLines += 1;
      else current.costCents += line.costCents;
      products.set(key, current);
      const demandIds = productDemandIds.get(metric.code) ?? new Set<string>();
      demandIds.add(line.demandId);
      productDemandIds.set(metric.code, demandIds);
    } else {
      classifiedServiceLines += 1;
      const key = serviceRowKey(classification);
      const current = services.get(key) ?? {
        key,
        metric,
        aggregateType: classification.aggregateType,
        procedure: classification.procedure,
        configuration: classification.configuration,
        operationKeys: new Set<string>(),
        demandIds: new Set<string>(),
        clientIds: new Set<string>(),
        linesCount: 0,
        directRevenueCents: 0,
        linkedRevenueCents: 0,
        linkedCostCents: 0,
        linkedMissingCostLines: 0,
      };
      current.linesCount += 1;
      current.directRevenueCents += line.revenueCents;
      current.demandIds.add(line.demandId);
      if (line.clientId) current.clientIds.add(line.clientId);
      current.operationKeys.add(`${line.demandId}:${key}`);
      services.set(key, current);
      if (metric.code === "ENGINE_OIL_CHANGE") engineOilVisitIds.add(line.demandId);
    }
  }

  const linesByDemand = new Map<string, SalesPerformanceLoadedLine[]>();
  for (const line of lines) {
    const demandLines = linesByDemand.get(line.demandId) ?? [];
    demandLines.push(line);
    linesByDemand.set(line.demandId, demandLines);
  }
  for (const demandLines of linesByDemand.values()) {
    const serviceKeys = [...new Set(demandLines
      .filter((line) => line.kind === "service" && line.classification.status === "classified")
      .map((line) => line.rowKey))];
    for (const productLine of demandLines.filter((line) => line.kind === "product" && line.classification.metricCode)) {
      const productCode = productLine.classification.metricCode as string;
      const eligibleKeys = serviceKeys.filter((key) => {
        const service = services.get(key);
        return service ? serviceAcceptsProduct(service.metric.code, productCode) : false;
      });
      if (eligibleKeys.length !== 1) continue;
      const service = services.get(eligibleKeys[0]);
      if (!service) continue;
      service.linkedRevenueCents += productLine.revenueCents;
      if (productLine.costCents == null) service.linkedMissingCostLines += 1;
      else service.linkedCostCents += productLine.costCents;
    }
  }

  return {
    lines,
    products,
    services,
    unclassified,
    allDemandIds,
    allClientIds,
    productRevenueCents,
    serviceRevenueCents,
    knownGrossProfitCents,
    missingCostLines,
    productLines,
    classifiedProductLines,
    serviceLines,
    classifiedServiceLines,
    literLines,
    classifiedLiterLines,
    engineOilVisitIds,
    productDemandIds,
  };
}

function productRows(
  current: AggregateResult,
  previous: AggregateResult,
  metrics: SalesAnalyticsMetricDefinition[],
): SalesPerformanceProductRow[] {
  const keys = new Set([...current.products.keys(), ...previous.products.keys()]);
  const sortByCode = new Map(metrics.map((metric) => [metric.code, metric.sortOrder] as const));
  return [...keys].map((key) => {
    const now = current.products.get(key);
    const before = previous.products.get(key);
    const source = now ?? before;
    if (!source) throw new Error("Не найдена товарная метрика");
    const grossProfitCents = now && now.missingCostLines === 0 ? now.revenueCents - now.costCents : null;
    const previousGrossProfit = before && before.missingCostLines === 0 ? before.revenueCents - before.costCents : null;
    const quantity = source.metric.unit === "LITER" && (now?.baseQuantityLines ?? 0) === 0
      ? null
      : now?.baseQuantity ?? 0;
    const previousQuantity = source.metric.unit === "LITER" && (before?.baseQuantityLines ?? 0) === 0
      ? null
      : before?.baseQuantity ?? 0;
    return {
      key,
      metricCode: source.metric.code,
      title: source.metric.title,
      unit: source.metric.unit,
      quantity,
      rawQuantity: now?.rawQuantity ?? 0,
      quantityCoveragePercent: now?.linesCount ? (now.baseQuantityLines / now.linesCount) * 100 : 0,
      linesCount: now?.linesCount ?? 0,
      documentsCount: now?.demandIds.size ?? 0,
      clientsCount: now?.clientIds.size ?? 0,
      revenueCents: now?.revenueCents ?? 0,
      costCents: grossProfitCents == null ? null : now?.costCents ?? 0,
      grossProfitCents,
      marginPercent: margin(now?.revenueCents ?? 0, grossProfitCents),
      missingCostLines: now?.missingCostLines ?? 0,
      comparison: {
        quantity: quantity == null || previousQuantity == null ? null : centsComparison(quantity, previousQuantity),
        revenue: centsComparison(now?.revenueCents ?? 0, before?.revenueCents ?? 0),
        grossProfit: grossProfitCents == null || previousGrossProfit == null
          ? null
          : centsComparison(grossProfitCents, previousGrossProfit),
      },
    };
  }).sort((left, right) => (sortByCode.get(left.metricCode) ?? 9999) - (sortByCode.get(right.metricCode) ?? 9999));
}

function serviceRows(
  current: AggregateResult,
  previous: AggregateResult,
  metrics: SalesAnalyticsMetricDefinition[],
): SalesPerformanceServiceRow[] {
  const keys = new Set([...current.services.keys(), ...previous.services.keys()]);
  const sortByCode = new Map(metrics.map((metric) => [metric.code, metric.sortOrder] as const));
  return [...keys].map((key) => {
    const now = current.services.get(key);
    const before = previous.services.get(key);
    const source = now ?? before;
    if (!source) throw new Error("Не найдена сервисная метрика");
    const linkedGrossProfitCents = now && now.linkedMissingCostLines === 0
      ? now.linkedRevenueCents - now.linkedCostCents
      : null;
    return {
      key,
      metricCode: source.metric.code,
      title: source.metric.title,
      aggregateType: source.aggregateType,
      procedure: source.procedure,
      configuration: source.configuration,
      operationsCount: now?.operationKeys.size ?? 0,
      linesCount: now?.linesCount ?? 0,
      clientsCount: now?.clientIds.size ?? 0,
      directRevenueCents: now?.directRevenueCents ?? 0,
      linkedRevenueCents: now?.linkedRevenueCents ?? 0,
      linkedCostCents: linkedGrossProfitCents == null ? null : now?.linkedCostCents ?? 0,
      linkedGrossProfitCents,
      linkedMissingCostLines: now?.linkedMissingCostLines ?? 0,
      comparison: {
        operations: centsComparison(now?.operationKeys.size ?? 0, before?.operationKeys.size ?? 0),
        directRevenue: centsComparison(now?.directRevenueCents ?? 0, before?.directRevenueCents ?? 0),
      },
    };
  }).sort((left, right) => {
    const codeOrder = (sortByCode.get(left.metricCode) ?? 9999) - (sortByCode.get(right.metricCode) ?? 9999);
    return codeOrder || String(left.procedure ?? "").localeCompare(String(right.procedure ?? ""), "ru");
  });
}

function attachRates(current: AggregateResult, previous: AggregateResult): SalesPerformanceAttachRate[] {
  return ([
    ["AIR_FILTER", "Воздушный фильтр"],
    ["CABIN_FILTER", "Салонный фильтр"],
  ] as const).map(([metricCode, title]) => {
    const nowProductVisits = current.productDemandIds.get(metricCode) ?? new Set<string>();
    const beforeProductVisits = previous.productDemandIds.get(metricCode) ?? new Set<string>();
    const attachedVisits = [...nowProductVisits].filter((demandId) => current.engineOilVisitIds.has(demandId)).length;
    const previousAttached = [...beforeProductVisits].filter((demandId) => previous.engineOilVisitIds.has(demandId)).length;
    return {
      metricCode,
      title,
      denominatorVisits: current.engineOilVisitIds.size,
      attachedVisits,
      standaloneVisits: [...nowProductVisits].filter((demandId) => !current.engineOilVisitIds.has(demandId)).length,
      ratePercent: current.engineOilVisitIds.size ? (attachedVisits / current.engineOilVisitIds.size) * 100 : null,
      previousRatePercent: previous.engineOilVisitIds.size ? (previousAttached / previous.engineOilVisitIds.size) * 100 : null,
    };
  });
}

function unclassifiedRows(current: AggregateResult): SalesPerformanceUnclassifiedRow[] {
  return [...current.unclassified.values()]
    .map((row) => ({
      key: row.key,
      kind: row.kind,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      name: row.name,
      linesCount: row.lineCount,
      documentsCount: row.demandIds.size,
      rawQuantity: row.rawQuantity,
      revenueCents: row.revenueCents,
      branchNames: [...row.branchNames].sort((a, b) => a.localeCompare(b, "ru")),
      reason: row.reason,
    }))
    .sort((left, right) => right.linesCount - left.linesCount || left.name.localeCompare(right.name, "ru"));
}

/** Pure aggregation entry point used by contract tests and future daily rollups. */
export function summarizeSalesPerformanceLines(
  lines: SalesPerformanceLoadedLine[],
  previousLines: SalesPerformanceLoadedLine[] = [],
  metrics: SalesAnalyticsMetricDefinition[] = [...SALES_ANALYTICS_METRICS],
) {
  const current = aggregateLines(lines, metrics);
  const previous = aggregateLines(previousLines, metrics);
  return {
    products: productRows(current, previous, metrics),
    services: serviceRows(current, previous, metrics),
    attachRates: attachRates(current, previous),
    unclassified: unclassifiedRows(current),
    documentsCount: current.allDemandIds.size,
    clientsCount: current.allClientIds.size,
  };
}

type SalesPlanLoadResult = {
  available: boolean;
  reason: string | null;
  month: string | null;
  plans: BranchSalesPlan[];
  calendars: SalesPerformanceWorkingCalendar[];
  versionKey: string;
};

type SalesPlanActual = {
  count: number | null;
  revenueCents: number;
  grossProfitCents: number | null;
};

type HistoricalAverage = {
  revenuePerUnitCents: number | null;
  grossProfitPerUnitCents: number | null;
  revenueSampleUnits: number;
  grossProfitSampleUnits: number;
  excludedMissingCostLines: number;
};

type HistoricalAverageCounter = {
  revenueCents: number;
  revenueUnits: number;
  grossProfitCents: number;
  grossProfitUnits: number;
  excludedMissingCostLines: number;
};

type AttachGrossProfitAverage = {
  averageCents: number | null;
  sampleVisits: number;
  excludedMissingCostVisits: number;
};

function salesPlanMonth(period: SalesPerformancePeriod): string | null {
  const fromMonth = period.dateFrom.slice(0, 7);
  const toMonth = period.dateTo.slice(0, 7);
  return fromMonth === toMonth && period.dateFrom === `${fromMonth}-01` ? fromMonth : null;
}

function isoWeekday(value: string) {
  return dateFromYmd(value).getUTCDay() || 7;
}

/** Pure working-day calculation used by plan forecasts and contract tests. */
export function countSalesPlanWorkingDays(month: string, through: string, workingWeekdays: number[]) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Некорректный месяц рабочего календаря");
  const first = `${month}-01`;
  const last = monthEnd(first);
  const cutoff = through < first ? addDays(first, -1) : through > last ? last : through;
  const allowed = new Set(workingWeekdays.filter((weekday) => weekday >= 1 && weekday <= 7));
  let totalWorkingDays = 0;
  let elapsedWorkingDays = 0;
  for (let day = first; day <= last; day = addDays(day, 1)) {
    if (!allowed.has(isoWeekday(day))) continue;
    totalWorkingDays += 1;
    if (day <= cutoff) elapsedWorkingDays += 1;
  }
  return {
    totalWorkingDays,
    elapsedWorkingDays,
    remainingWorkingDays: Math.max(0, totalWorkingDays - elapsedWorkingDays),
  };
}

async function loadSalesPlanContext(
  context: BranchContext,
  branchIds: string[],
  period: SalesPerformancePeriod,
): Promise<SalesPlanLoadResult> {
  const month = salesPlanMonth(period);
  if (!month) {
    return {
      available: false,
      reason: "План/факт доступен для периода от первого числа в пределах одного месяца",
      month: null,
      plans: [],
      calendars: [],
      versionKey: "unavailable",
    };
  }
  const [plans, workingHours] = await Promise.all([
    prisma.branchSalesPlan.findMany({
      where: { businessGroupId: context.businessGroupId, branchId: { in: branchIds }, month },
      orderBy: [{ branchId: "asc" }, { rowKey: "asc" }],
    }),
    prisma.branchBookingWorkingHour.findMany({
      where: { branchId: { in: branchIds } },
      select: { branchId: true, weekday: true, isWorking: true },
      orderBy: [{ branchId: "asc" }, { weekday: "asc" }],
    }),
  ]);
  const hoursByBranch = new Map<string, Array<{ weekday: number; isWorking: boolean }>>();
  for (const row of workingHours) {
    const values = hoursByBranch.get(row.branchId) ?? [];
    values.push(row);
    hoursByBranch.set(row.branchId, values);
  }
  const branchNameById = new Map(context.branches.map((branch) => [branch.id, branch.displayName || branch.shortName || branch.name]));
  const calendars = branchIds.map((branchId): SalesPerformanceWorkingCalendar => {
    const configured = hoursByBranch.get(branchId) ?? [];
    const workingWeekdays = configured.length
      ? configured.filter((row) => row.isWorking).map((row) => row.weekday)
      : [1, 2, 3, 4, 5, 6];
    const counts = countSalesPlanWorkingDays(month, period.dateTo, workingWeekdays);
    return {
      branchId,
      branchName: branchNameById.get(branchId) ?? branchId,
      source: configured.length ? "BRANCH_SCHEDULE" : "DEFAULT_MONDAY_SATURDAY",
      workingWeekdays,
      ...counts,
    };
  });
  return {
    available: true,
    reason: null,
    month,
    plans,
    calendars,
    versionKey: plans.map((plan) => `${plan.id}:${plan.version}:${plan.updatedAt.getTime()}`).join("|"),
  };
}

function actualsByBranchAndRow(
  lines: SalesPerformanceLoadedLine[],
  branchIds: string[],
  metrics: SalesAnalyticsMetricDefinition[],
) {
  const values = new Map<string, SalesPlanActual>();
  for (const branchId of branchIds) {
    const current = aggregateLines(lines.filter((line) => line.branchId === branchId), metrics);
    for (const [key, row] of current.products) {
      const grossProfitCents = row.missingCostLines === 0 ? row.revenueCents - row.costCents : null;
      const count = row.metric.unit === "LITER" && row.baseQuantityLines === 0 ? null : row.baseQuantity;
      values.set(`${branchId}:${key}`, { count, revenueCents: row.revenueCents, grossProfitCents });
    }
    for (const [key, row] of current.services) {
      const linkedGrossProfit = row.linkedMissingCostLines === 0 ? row.linkedRevenueCents - row.linkedCostCents : null;
      values.set(`${branchId}:${key}`, {
        count: row.operationKeys.size,
        revenueCents: row.directRevenueCents + row.linkedRevenueCents,
        grossProfitCents: linkedGrossProfit == null ? null : row.directRevenueCents + linkedGrossProfit,
      });
    }
  }
  return values;
}

function branchRowKey(branchId: string, rowKey: string) {
  return `${branchId}\u0000${rowKey}`;
}

function historicalAverages(lines: SalesPerformanceLoadedLine[]): Map<string, HistoricalAverage> {
  const counters = new Map<string, HistoricalAverageCounter>();
  const counterFor = (key: string) => {
    const current = counters.get(key) ?? {
      revenueCents: 0,
      revenueUnits: 0,
      grossProfitCents: 0,
      grossProfitUnits: 0,
      excludedMissingCostLines: 0,
    };
    counters.set(key, current);
    return current;
  };

  for (const line of lines) {
    if (line.kind !== "product" || line.classification.status !== "classified") continue;
    const units = line.classification.baseQuantity;
    if (units == null || units <= 0) continue;
    const current = counterFor(branchRowKey(line.branchId, line.rowKey));
    current.revenueCents += line.revenueCents;
    current.revenueUnits += units;
    if (line.grossProfitCents == null) current.excludedMissingCostLines += 1;
    else {
      current.grossProfitCents += line.grossProfitCents;
      current.grossProfitUnits += units;
    }
  }

  const linesByVisit = new Map<string, SalesPerformanceLoadedLine[]>();
  for (const line of lines) {
    const key = `${line.branchId}\u0000${line.demandId}`;
    const visitLines = linesByVisit.get(key) ?? [];
    visitLines.push(line);
    linesByVisit.set(key, visitLines);
  }
  for (const visitLines of linesByVisit.values()) {
    const serviceLinesByKey = new Map<string, SalesPerformanceLoadedLine[]>();
    for (const line of visitLines) {
      if (line.kind !== "service" || line.classification.status !== "classified" || !line.classification.metricCode) continue;
      const serviceLines = serviceLinesByKey.get(line.rowKey) ?? [];
      serviceLines.push(line);
      serviceLinesByKey.set(line.rowKey, serviceLines);
    }
    const serviceKeys = [...serviceLinesByKey.keys()];
    const operations = new Map<string, { revenueCents: number; grossProfitCents: number; missingCostLines: number }>();
    for (const [rowKey, serviceLines] of serviceLinesByKey) {
      const directRevenueCents = serviceLines.reduce((sum, line) => sum + line.revenueCents, 0);
      operations.set(rowKey, { revenueCents: directRevenueCents, grossProfitCents: directRevenueCents, missingCostLines: 0 });
    }
    for (const productLine of visitLines) {
      if (productLine.kind !== "product" || productLine.classification.status !== "classified" || !productLine.classification.metricCode) continue;
      const eligibleKeys = serviceKeys.filter((rowKey) => {
        const serviceLine = serviceLinesByKey.get(rowKey)?.[0];
        return serviceLine?.classification.metricCode
          ? serviceAcceptsProduct(serviceLine.classification.metricCode, productLine.classification.metricCode as string)
          : false;
      });
      if (eligibleKeys.length !== 1) continue;
      const operation = operations.get(eligibleKeys[0]);
      if (!operation) continue;
      operation.revenueCents += productLine.revenueCents;
      if (productLine.grossProfitCents == null) operation.missingCostLines += 1;
      else operation.grossProfitCents += productLine.grossProfitCents;
    }
    for (const [rowKey, operation] of operations) {
      const current = counterFor(branchRowKey(visitLines[0].branchId, rowKey));
      current.revenueCents += operation.revenueCents;
      current.revenueUnits += 1;
      if (operation.missingCostLines) current.excludedMissingCostLines += operation.missingCostLines;
      else {
        current.grossProfitCents += operation.grossProfitCents;
        current.grossProfitUnits += 1;
      }
    }
  }

  return new Map([...counters].map(([key, value]) => [key, {
    revenuePerUnitCents: value.revenueUnits > 0 ? value.revenueCents / value.revenueUnits : null,
    grossProfitPerUnitCents: value.grossProfitUnits > 0 ? value.grossProfitCents / value.grossProfitUnits : null,
    revenueSampleUnits: value.revenueUnits,
    grossProfitSampleUnits: value.grossProfitUnits,
    excludedMissingCostLines: value.excludedMissingCostLines,
  }]));
}

function historicalAttachGrossProfit(lines: SalesPerformanceLoadedLine[]): Map<string, AttachGrossProfitAverage> {
  const values = new Map<string, { grossProfitCents: number; sampleVisits: number; excludedMissingCostVisits: number }>();
  const linesByVisit = new Map<string, SalesPerformanceLoadedLine[]>();
  for (const line of lines) {
    const key = `${line.branchId}\u0000${line.demandId}`;
    const visitLines = linesByVisit.get(key) ?? [];
    visitLines.push(line);
    linesByVisit.set(key, visitLines);
  }
  for (const visitLines of linesByVisit.values()) {
    const hasEngineOilChange = visitLines.some((line) =>
      line.kind === "service"
      && line.classification.status === "classified"
      && line.classification.metricCode === "ENGINE_OIL_CHANGE"
    );
    if (!hasEngineOilChange) continue;
    for (const metricCode of ["AIR_FILTER", "CABIN_FILTER"] as const) {
      const productLines = visitLines.filter((line) =>
        line.kind === "product"
        && line.classification.status === "classified"
        && line.classification.metricCode === metricCode
      );
      if (!productLines.length) continue;
      const key = branchRowKey(visitLines[0].branchId, metricCode);
      const current = values.get(key) ?? { grossProfitCents: 0, sampleVisits: 0, excludedMissingCostVisits: 0 };
      if (productLines.some((line) => line.grossProfitCents == null)) current.excludedMissingCostVisits += 1;
      else {
        current.grossProfitCents += productLines.reduce((sum, line) => sum + (line.grossProfitCents ?? 0), 0);
        current.sampleVisits += 1;
      }
      values.set(key, current);
    }
  }
  return new Map([...values].map(([key, value]) => [key, {
    averageCents: value.sampleVisits ? value.grossProfitCents / value.sampleVisits : null,
    sampleVisits: value.sampleVisits,
    excludedMissingCostVisits: value.excludedMissingCostVisits,
  }]));
}

/** Pure formula for a quantity gap. The explicit plan value always wins over the historical average. */
export function calculateSalesPotential(
  remainingToPlan: number | null,
  explicitPerUnitCents: number | null,
  historicalPerUnitCents: number | null,
) {
  const units = remainingToPlan == null ? null : Math.max(0, remainingToPlan);
  const averagePerUnitCents = explicitPerUnitCents ?? historicalPerUnitCents;
  return {
    amountCents: units == null || averagePerUnitCents == null ? null : Math.round(units * averagePerUnitCents),
    averagePerUnitCents,
    source: explicitPerUnitCents != null
      ? "PLAN" as const
      : historicalPerUnitCents != null
        ? "LAST_90_DAYS" as const
        : "UNAVAILABLE" as const,
  };
}

/** Pure attach-rate formula. Callers supply distinct eligible and attached visit counts. */
export function calculateAttachOpportunity(
  eligibleVisits: number,
  attachedVisits: number,
  targetRatePercent: number,
  averageGrossProfitPerAttachedSaleCents: number | null,
) {
  const eligible = Math.max(0, Math.floor(eligibleVisits));
  const attached = Math.max(0, Math.floor(attachedVisits));
  const rate = Math.min(100, Math.max(0, targetRatePercent));
  const targetAttachedVisits = Math.ceil(eligible * rate / 100);
  const opportunityVisits = Math.max(targetAttachedVisits - attached, 0);
  return {
    targetAttachedVisits,
    opportunityVisits,
    opportunityGrossProfitCents: opportunityVisits === 0
      ? 0
      : averageGrossProfitPerAttachedSaleCents == null
        ? null
        : Math.round(opportunityVisits * averageGrossProfitPerAttachedSaleCents),
  };
}

function sumOptional(plans: BranchSalesPlan[], field: "targetRevenueCents" | "targetGrossProfitCents") {
  return plans.some((plan) => plan[field] != null)
    ? plans.reduce((sum, plan) => sum + (plan[field] ?? 0), 0)
    : null;
}

function weightedOptional(plans: BranchSalesPlan[], field: "targetAttachRateBasisPoints" | "expectedRevenuePerUnitCents" | "expectedGrossProfitPerUnitCents") {
  const available = plans.filter((plan) => plan[field] != null);
  if (!available.length) return null;
  const weight = available.reduce((sum, plan) => sum + Math.max(0, Number(plan.targetCount)), 0);
  if (!weight) return available.reduce((sum, plan) => sum + (plan[field] ?? 0), 0) / available.length;
  return available.reduce((sum, plan) => sum + (plan[field] ?? 0) * Math.max(0, Number(plan.targetCount)), 0) / weight;
}

function forecastAtPace(actual: number | null, calendar: SalesPerformanceWorkingCalendar) {
  if (actual == null) return null;
  if (calendar.elapsedWorkingDays <= 0) return actual === 0 ? 0 : null;
  return actual / calendar.elapsedWorkingDays * calendar.totalWorkingDays;
}

type PotentialPart = {
  remaining: number;
  explicitPerUnitCents: number | null;
  historicalPerUnitCents: number | null;
  historicalSampleUnits: number;
  excludedMissingCostLines: number;
};

function combinePotential(
  parts: PotentialPart[],
  baselineDateFrom: string,
  baselineDateTo: string,
): { amountCents: number | null; basis: SalesPerformancePotentialBasis } {
  const active = parts.filter((part) => part.remaining > 0);
  const considered = active.length ? active : parts;
  const resolved = considered.map((part) => ({ part, ...calculateSalesPotential(
    part.remaining,
    part.explicitPerUnitCents,
    part.historicalPerUnitCents,
  ) }));
  const unavailable = active.some((part) => part.explicitPerUnitCents == null && part.historicalPerUnitCents == null);
  const sources = new Set(resolved.filter((item) => item.source !== "UNAVAILABLE").map((item) => item.source));
  const source: SalesPerformancePotentialBasis["source"] = unavailable || !sources.size
    ? "UNAVAILABLE"
    : sources.size > 1
      ? "MIXED"
      : [...sources][0] as "PLAN" | "LAST_90_DAYS";
  const amountCents = unavailable
    ? null
    : active.length
      ? resolved.reduce((sum, item) => sum + (item.amountCents ?? 0), 0)
      : 0;
  const remaining = active.reduce((sum, part) => sum + part.remaining, 0);
  const fallbackAverage = resolved.find((item) => item.averagePerUnitCents != null)?.averagePerUnitCents ?? null;
  const averagePerUnitCents = amountCents == null
    ? null
    : remaining > 0
      ? amountCents / remaining
      : fallbackAverage;
  const usesHistory = source === "LAST_90_DAYS" || source === "MIXED" || source === "UNAVAILABLE";
  return {
    amountCents,
    basis: {
      source,
      averagePerUnitCents,
      periodDateFrom: usesHistory ? baselineDateFrom : null,
      periodDateTo: usesHistory ? baselineDateTo : null,
      sampleUnits: considered.reduce((sum, part) => sum + (part.historicalPerUnitCents == null ? 0 : part.historicalSampleUnits), 0),
      excludedMissingCostLines: considered.reduce((sum, part) => sum + part.excludedMissingCostLines, 0),
    },
  };
}

function buildPlanFactRows(
  planContext: SalesPlanLoadResult,
  currentLines: SalesPerformanceLoadedLine[],
  previousLines: SalesPerformanceLoadedLine[],
  baselineLines: SalesPerformanceLoadedLine[],
  baselineDateFrom: string,
  baselineDateTo: string,
  branchIds: string[],
  metrics: SalesAnalyticsMetricDefinition[],
): SalesPerformancePlanFactRow[] {
  if (!planContext.available || !planContext.plans.length) return [];
  const metricByCode = new Map(metrics.map((metric) => [metric.code, metric]));
  const calendarByBranch = new Map(planContext.calendars.map((calendar) => [calendar.branchId, calendar]));
  const actuals = actualsByBranchAndRow(currentLines, branchIds, metrics);
  const previousActuals = actualsByBranchAndRow(previousLines, branchIds, metrics);
  const baselines = historicalAverages(baselineLines);
  const grouped = new Map<string, BranchSalesPlan[]>();
  for (const plan of planContext.plans) {
    const rows = grouped.get(plan.rowKey) ?? [];
    rows.push(plan);
    grouped.set(plan.rowKey, rows);
  }
  return [...grouped.entries()].flatMap(([rowKey, plans]) => {
    const metric = metricByCode.get(plans[0].metricCode);
    if (!metric) return [];
    const branchActuals = plans.map((plan) => ({
      plan,
      actual: actuals.get(`${plan.branchId}:${rowKey}`) ?? { count: 0, revenueCents: 0, grossProfitCents: 0 },
      previous: previousActuals.get(`${plan.branchId}:${rowKey}`) ?? { count: 0, revenueCents: 0, grossProfitCents: 0 },
      baseline: baselines.get(branchRowKey(plan.branchId, rowKey)),
      calendar: calendarByBranch.get(plan.branchId),
    }));
    const hasUnknownCount = branchActuals.some((item) => item.actual.count == null);
    const hasUnknownPreviousCount = branchActuals.some((item) => item.previous.count == null);
    const actualCount = hasUnknownCount ? null : branchActuals.reduce((sum, item) => sum + (item.actual.count ?? 0), 0);
    const previousActualCount = hasUnknownPreviousCount ? null : branchActuals.reduce((sum, item) => sum + (item.previous.count ?? 0), 0);
    const targetCount = plans.reduce((sum, plan) => sum + Number(plan.targetCount), 0);
    const actualRevenueCents = branchActuals.reduce((sum, item) => sum + item.actual.revenueCents, 0);
    const actualGrossProfitCents = branchActuals.some((item) => item.actual.grossProfitCents == null)
      ? null
      : branchActuals.reduce((sum, item) => sum + (item.actual.grossProfitCents ?? 0), 0);
    const forecastCount = hasUnknownCount || branchActuals.some((item) => !item.calendar)
      ? null
      : branchActuals.reduce((sum, item) => sum + (forecastAtPace(item.actual.count, item.calendar as SalesPerformanceWorkingCalendar) ?? 0), 0);
    const forecastRevenueCents = branchActuals.some((item) => !item.calendar)
      ? null
      : Math.round(branchActuals.reduce((sum, item) => sum + (forecastAtPace(item.actual.revenueCents, item.calendar as SalesPerformanceWorkingCalendar) ?? 0), 0));
    const forecastGrossProfitCents = actualGrossProfitCents == null || branchActuals.some((item) => !item.calendar)
      ? null
      : Math.round(branchActuals.reduce((sum, item) => sum + (forecastAtPace(item.actual.grossProfitCents, item.calendar as SalesPerformanceWorkingCalendar) ?? 0), 0));
    const requiredPerWorkingDay = actualCount == null
      ? null
      : branchActuals.reduce((sum, item) => {
        if (!item.calendar) return sum;
        const gap = Math.max(0, Number(item.plan.targetCount) - (item.actual.count ?? 0));
        return sum + (item.calendar.remainingWorkingDays ? gap / item.calendar.remainingWorkingDays : gap);
      }, 0);
    const remainingToPlan = actualCount == null
      ? null
      : branchActuals.reduce((sum, item) => sum + Math.max(0, Number(item.plan.targetCount) - (item.actual.count ?? 0)), 0);
    const potentialRevenue = combinePotential(branchActuals.map((item) => ({
      remaining: item.actual.count == null ? 0 : Math.max(0, Number(item.plan.targetCount) - item.actual.count),
      explicitPerUnitCents: item.plan.expectedRevenuePerUnitCents,
      historicalPerUnitCents: item.baseline?.revenuePerUnitCents ?? null,
      historicalSampleUnits: item.baseline?.revenueSampleUnits ?? 0,
      excludedMissingCostLines: 0,
    })), baselineDateFrom, baselineDateTo);
    const potentialGrossProfit = combinePotential(branchActuals.map((item) => ({
      remaining: item.actual.count == null ? 0 : Math.max(0, Number(item.plan.targetCount) - item.actual.count),
      explicitPerUnitCents: item.plan.expectedGrossProfitPerUnitCents,
      historicalPerUnitCents: item.baseline?.grossProfitPerUnitCents ?? null,
      historicalSampleUnits: item.baseline?.grossProfitSampleUnits ?? 0,
      excludedMissingCostLines: item.baseline?.excludedMissingCostLines ?? 0,
    })), baselineDateFrom, baselineDateTo);
    const completionPercent = actualCount == null || targetCount <= 0 ? null : actualCount / targetCount * 100;
    const status: SalesPerformancePlanFactRow["status"] = actualCount == null || forecastCount == null
      ? "no-data"
      : actualCount >= targetCount
        ? "completed"
        : forecastCount >= targetCount
          ? "on-pace"
          : "risk";
    const kind: SalesPerformancePlanFactRow["kind"] = metric.type === "PRODUCT_CATEGORY" ? "product" : "service";
    return [{
      rowKey,
      metricCode: metric.code,
      kind,
      title: metric.title,
      unit: metric.unit,
      aggregateType: aggregateType(plans[0].aggregateType),
      procedure: procedure(plans[0].procedure),
      configuration: configuration(plans[0].configuration),
      targetCount,
      actualCount,
      previousActualCount,
      changePercent: actualCount == null || previousActualCount == null
        ? null
        : centsComparison(actualCount, previousActualCount).deltaPercent,
      completionPercent,
      remainingToPlan,
      forecastCount,
      forecastGap: forecastCount == null ? null : targetCount - forecastCount,
      forecastPreliminary: branchActuals.some((item) => (item.calendar?.elapsedWorkingDays ?? 0) < 3),
      requiredPerWorkingDay,
      actualRevenueCents,
      targetRevenueCents: sumOptional(plans, "targetRevenueCents"),
      forecastRevenueCents,
      actualGrossProfitCents,
      targetGrossProfitCents: sumOptional(plans, "targetGrossProfitCents"),
      forecastGrossProfitCents,
      targetAttachRatePercent: (() => {
        const value = weightedOptional(plans, "targetAttachRateBasisPoints");
        return value == null ? null : value / 100;
      })(),
      expectedRevenuePerUnitCents: weightedOptional(plans, "expectedRevenuePerUnitCents"),
      expectedGrossProfitPerUnitCents: weightedOptional(plans, "expectedGrossProfitPerUnitCents"),
      potentialRevenueCents: remainingToPlan == null ? null : potentialRevenue.amountCents,
      potentialGrossProfitCents: remainingToPlan == null ? null : potentialGrossProfit.amountCents,
      potentialRevenueBasis: potentialRevenue.basis,
      potentialGrossProfitBasis: potentialGrossProfit.basis,
      status,
      plannedBranches: plans.length,
      totalBranches: branchIds.length,
      note: plans.length === 1 ? plans[0].note : null,
    }];
  }).sort((left, right) => {
    const leftMetric = metricByCode.get(left.metricCode)?.sortOrder ?? 9999;
    const rightMetric = metricByCode.get(right.metricCode)?.sortOrder ?? 9999;
    return leftMetric - rightMetric || left.rowKey.localeCompare(right.rowKey, "ru");
  });
}

function buildAttachOpportunities(
  planContext: SalesPlanLoadResult,
  currentLines: SalesPerformanceLoadedLine[],
  baselineLines: SalesPerformanceLoadedLine[],
  baselineDateFrom: string,
  baselineDateTo: string,
  branchIds: string[],
  metrics: SalesAnalyticsMetricDefinition[],
): SalesPerformanceAttachOpportunity[] {
  if (!planContext.available) return [];
  const targetPlans = planContext.plans.filter((plan) =>
    (plan.metricCode === "AIR_FILTER" || plan.metricCode === "CABIN_FILTER")
    && plan.targetAttachRateBasisPoints != null
  );
  if (!targetPlans.length) return [];
  const currentByBranch = new Map(branchIds.map((branchId) => [
    branchId,
    aggregateLines(currentLines.filter((line) => line.branchId === branchId), metrics),
  ]));
  const historicalProfit = historicalAttachGrossProfit(baselineLines);
  return ([
    ["AIR_FILTER", "Воздушный фильтр"],
    ["CABIN_FILTER", "Салонный фильтр"],
  ] as const).flatMap(([metricCode, title]) => {
    const plans = targetPlans.filter((plan) => plan.metricCode === metricCode);
    if (!plans.length) return [];
    const branchRows = plans.map((plan) => {
      const aggregate = currentByBranch.get(plan.branchId);
      const eligibleVisits = aggregate?.engineOilVisitIds.size ?? 0;
      const productVisits = aggregate?.productDemandIds.get(metricCode) ?? new Set<string>();
      const attachedVisits = [...productVisits].filter((demandId) => aggregate?.engineOilVisitIds.has(demandId)).length;
      const standaloneVisits = [...productVisits].filter((demandId) => !aggregate?.engineOilVisitIds.has(demandId)).length;
      const targetRatePercent = (plan.targetAttachRateBasisPoints ?? 0) / 100;
      const historical = historicalProfit.get(branchRowKey(plan.branchId, metricCode));
      return {
        eligibleVisits,
        attachedVisits,
        standaloneVisits,
        targetRatePercent,
        historical,
        calculation: calculateAttachOpportunity(eligibleVisits, attachedVisits, targetRatePercent, historical?.averageCents ?? null),
      };
    });
    const eligibleVisits = branchRows.reduce((sum, row) => sum + row.eligibleVisits, 0);
    const attachedVisits = branchRows.reduce((sum, row) => sum + row.attachedVisits, 0);
    const opportunityVisits = branchRows.reduce((sum, row) => sum + row.calculation.opportunityVisits, 0);
    const hasUnavailableProfit = branchRows.some((row) => row.calculation.opportunityGrossProfitCents == null);
    const totalSampleVisits = branchRows.reduce((sum, row) => sum + (row.historical?.sampleVisits ?? 0), 0);
    const sampleGrossProfitCents = branchRows.reduce((sum, row) =>
      sum + (row.historical?.averageCents ?? 0) * (row.historical?.sampleVisits ?? 0), 0);
    const targetRatePercent = eligibleVisits
      ? branchRows.reduce((sum, row) => sum + row.targetRatePercent * row.eligibleVisits, 0) / eligibleVisits
      : branchRows.reduce((sum, row) => sum + row.targetRatePercent, 0) / branchRows.length;
    return [{
      rowKey: productRowKey(metricCode),
      metricCode,
      title,
      eligibleVisits,
      attachedVisits,
      standaloneVisits: branchRows.reduce((sum, row) => sum + row.standaloneVisits, 0),
      actualRatePercent: eligibleVisits ? attachedVisits / eligibleVisits * 100 : null,
      targetRatePercent,
      targetAttachedVisits: branchRows.reduce((sum, row) => sum + row.calculation.targetAttachedVisits, 0),
      opportunityVisits,
      averageGrossProfitPerAttachedSaleCents: totalSampleVisits ? sampleGrossProfitCents / totalSampleVisits : null,
      opportunityGrossProfitCents: hasUnavailableProfit
        ? null
        : branchRows.reduce((sum, row) => sum + (row.calculation.opportunityGrossProfitCents ?? 0), 0),
      grossProfitBasis: {
        source: hasUnavailableProfit || !totalSampleVisits ? "UNAVAILABLE" : "LAST_90_DAYS",
        averagePerUnitCents: totalSampleVisits ? sampleGrossProfitCents / totalSampleVisits : null,
        periodDateFrom: baselineDateFrom,
        periodDateTo: baselineDateTo,
        sampleUnits: totalSampleVisits,
        excludedMissingCostLines: branchRows.reduce((sum, row) => sum + (row.historical?.excludedMissingCostVisits ?? 0), 0),
      },
      plannedBranches: plans.length,
      totalBranches: branchIds.length,
    }];
  });
}

function pruneCache(now: number) {
  for (const [key, entry] of analyticsCache) if (entry.expiresAt <= now) analyticsCache.delete(key);
  while (analyticsCache.size >= CACHE_MAX_ENTRIES) {
    const first = analyticsCache.keys().next().value as string | undefined;
    if (!first) break;
    analyticsCache.delete(first);
  }
}

export async function getSalesPerformanceAnalytics(
  context: BranchContext,
  branchIds: string[],
  params: SalesPerformanceParams = {},
): Promise<SalesPerformanceAnalytics> {
  if (!branchIds.length) throw new Error("Нет доступных филиалов для аналитики");
  const period = normalizeSalesPerformancePeriod(params);
  const planContext = await loadSalesPlanContext(context, branchIds, period);
  const cacheKey = JSON.stringify({
    businessGroupId: context.businessGroupId,
    mode: context.mode,
    branchIds: [...branchIds].sort(),
    period,
    storeId: params.storeId ?? "",
    metricCode: params.metricCode ?? "",
    planVersion: planContext.versionKey,
  });
  const nowMs = Date.now();
  const cached = analyticsCache.get(cacheKey);
  if (!params.refresh && cached && cached.expiresAt > nowMs) return cached.value;

  const loaded = await loadLines(context, branchIds, params, period);
  const currentLines = loaded.lines.filter((line) => line.documentDate >= period.dateFrom && line.documentDate <= period.dateTo);
  const previousLines = loaded.lines.filter((line) => line.documentDate >= period.comparisonDateFrom && line.documentDate <= period.comparisonDateTo);
  const baselineDateFrom = addDays(period.dateTo, -89);
  const baselineLines = loaded.lines.filter((line) => line.documentDate >= baselineDateFrom && line.documentDate <= period.dateTo);
  const current = aggregateLines(currentLines, loaded.metrics);
  const previous = aggregateLines(previousLines, loaded.metrics);
  let products = productRows(current, previous, loaded.metrics);
  let services = serviceRows(current, previous, loaded.metrics);
  if (params.metricCode) {
    products = products.filter((row) => row.metricCode === params.metricCode);
    services = services.filter((row) => row.metricCode === params.metricCode);
  }
  let planRows = buildPlanFactRows(
    planContext,
    currentLines,
    previousLines,
    baselineLines,
    baselineDateFrom,
    period.dateTo,
    branchIds,
    loaded.metrics,
  );
  let attachOpportunities = buildAttachOpportunities(
    planContext,
    currentLines,
    baselineLines,
    baselineDateFrom,
    period.dateTo,
    branchIds,
    loaded.metrics,
  );
  if (params.metricCode) planRows = planRows.filter((row) => row.metricCode === params.metricCode);
  if (params.metricCode) attachOpportunities = attachOpportunities.filter((row) => row.metricCode === params.metricCode);
  const revenueCents = current.productRevenueCents + current.serviceRevenueCents;
  const previousRevenueCents = previous.productRevenueCents + previous.serviceRevenueCents;
  const warnings: string[] = [];
  if (loaded.truncated) warnings.push(`Достигнут лимит ${MAX_POSITION_ROWS.toLocaleString("ru-RU")} строк. Сократите период.`);
  if (current.missingCostLines) warnings.push(`${current.missingCostLines} товарных строк без исторической себестоимости: прибыль показана как неполная.`);
  if (current.literLines > current.classifiedLiterLines) {
    warnings.push(`${current.literLines - current.classifiedLiterLines} строк жидкостей имеют категорию, но не подтверждённый объём в литрах.`);
  }
  const fallbackCalendars = planContext.calendars.filter((calendar) => calendar.source === "DEFAULT_MONDAY_SATURDAY");
  if (fallbackCalendars.length) {
    warnings.push(`${fallbackCalendars.length} филиал(а) без настроенного календаря: прогноз использует график пн–сб.`);
  }
  const unavailableProfitRows = planRows.filter((row) => row.remainingToPlan && row.potentialGrossProfitCents == null).length;
  if (unavailableProfitRows) {
    warnings.push(`Для ${unavailableProfitRows} строк потенциал валовой прибыли скрыт: нет плановой ставки или полной 90-дневной базы себестоимости.`);
  }
  const plannedBranchCount = new Set(planContext.plans.map((plan) => plan.branchId)).size;
  const sumPlanPotential = (field: "potentialRevenueCents" | "potentialGrossProfitCents") => {
    if (!planRows.length) return null;
    if (planRows.some((row) => (row.remainingToPlan ?? 0) > 0 && row[field] == null)) return null;
    return planRows.reduce((sum, row) => sum + (row[field] ?? 0), 0);
  };
  const attachOpportunityGrossProfitCents = !attachOpportunities.length
    ? null
    : attachOpportunities.some((row) => row.opportunityVisits > 0 && row.opportunityGrossProfitCents == null)
      ? null
      : attachOpportunities.reduce((sum, row) => sum + (row.opportunityGrossProfitCents ?? 0), 0);

  const value: SalesPerformanceAnalytics = {
    period,
    calculatedAt: new Date().toISOString(),
    cacheTtlSeconds: CACHE_TTL_MS / 1000,
    scope: {
      mode: context.mode,
      businessGroupId: context.businessGroupId,
      branchIds,
      branchNames: context.branches
        .filter((branch) => branchIds.includes(branch.id))
        .map((branch) => branch.displayName || branch.shortName || branch.name),
      canManageMappings: context.mode === "branch" && (context.canManageBranches || context.user.role === "owner"),
      canManagePlans: context.mode === "branch" && (context.canManageBranches || context.user.role === "owner"),
    },
    filters: { storeId: params.storeId?.trim() ?? "", metricCode: params.metricCode?.trim() ?? "" },
    summary: {
      revenueCents,
      productRevenueCents: current.productRevenueCents,
      serviceDirectRevenueCents: current.serviceRevenueCents,
      grossProfitCents: current.missingCostLines ? null : current.knownGrossProfitCents,
      documentsCount: current.allDemandIds.size,
      clientsCount: current.allClientIds.size,
      classifiedOperationsCount: [...current.services.values()].reduce((sum, row) => sum + row.operationKeys.size, 0),
      previousRevenueCents,
      revenueDeltaPercent: centsComparison(revenueCents, previousRevenueCents).deltaPercent,
      productLines: current.productLines,
      classifiedProductLines: current.classifiedProductLines,
      serviceLines: current.serviceLines,
      classifiedServiceLines: current.classifiedServiceLines,
      unclassifiedLines: [...current.unclassified.values()].reduce((sum, row) => sum + row.lineCount, 0),
      missingCostLines: current.missingCostLines,
      literLines: current.literLines,
      classifiedLiterLines: current.classifiedLiterLines,
    },
    products,
    services,
    attachRates: attachRates(current, previous),
    unclassified: unclassifiedRows(current),
    options: {
      productMetrics: loaded.metrics.filter((metric) => metric.type === "PRODUCT_CATEGORY"),
      serviceMetrics: loaded.metrics.filter((metric) => metric.type === "SERVICE_OPERATION"),
    },
    plan: {
      available: planContext.available,
      reason: planContext.reason,
      month: planContext.month,
      canEdit: context.mode === "branch" && (context.canManageBranches || context.user.role === "owner"),
      calendars: planContext.calendars,
      summary: {
        plannedRows: planRows.length,
        completedRows: planRows.filter((row) => row.status === "completed").length,
        onPaceRows: planRows.filter((row) => row.status === "on-pace").length,
        riskRows: planRows.filter((row) => row.status === "risk").length,
        plannedBranches: plannedBranchCount,
        totalBranches: branchIds.length,
        potentialRevenueCents: sumPlanPotential("potentialRevenueCents"),
        potentialGrossProfitCents: sumPlanPotential("potentialGrossProfitCents"),
        potentialRows: planRows.filter((row) => (row.remainingToPlan ?? 0) > 0).length,
        unavailableProfitRows,
        attachOpportunityVisits: attachOpportunities.reduce((sum, row) => sum + row.opportunityVisits, 0),
        attachOpportunityGrossProfitCents,
      },
      rows: planRows,
      attachOpportunities,
    },
    warnings,
  };
  pruneCache(nowMs);
  analyticsCache.set(cacheKey, { value, expiresAt: nowMs + CACHE_TTL_MS });
  return value;
}

export async function getSalesPerformanceDetails(
  context: BranchContext,
  branchIds: string[],
  params: SalesPerformanceParams & { rowKey: string },
): Promise<{ period: SalesPerformancePeriod; rowKey: string; rows: SalesPerformanceDetailRow[]; total: number }> {
  const period = normalizeSalesPerformancePeriod(params);
  const loaded = await loadLines(context, branchIds, params, period);
  const matching = loaded.lines.filter((line) =>
    line.documentDate >= period.dateFrom
    && line.documentDate <= period.dateTo
    && line.rowKey === params.rowKey
  );
  return {
    period,
    rowKey: params.rowKey,
    total: matching.length,
    rows: matching.slice(0, 250).map((line) => ({
      positionId: line.positionId,
      shipmentId: line.demandId,
      shipmentName: line.demandName,
      documentDate: line.documentDate,
      branchId: line.branchId,
      branchName: line.branchName,
      storeName: line.storeName,
      clientName: line.clientName,
      positionName: line.positionName,
      kind: line.kind,
      quantity: line.quantity,
      baseQuantity: line.classification.baseQuantity,
      baseUnit: line.classification.baseUnit,
      revenueCents: line.revenueCents,
      costCents: line.costCents,
      grossProfitCents: line.grossProfitCents,
      metricCode: line.classification.metricCode,
      metricTitle: line.classification.metricTitle,
      aggregateType: line.classification.aggregateType,
      procedure: line.classification.procedure,
      configuration: line.classification.configuration,
      matchMethod: line.classification.matchMethod,
    })),
  };
}

function csvCell(value: unknown): string {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function buildSalesPerformanceCsv(
  data: SalesPerformanceAnalytics,
  table: "products" | "services" | "unclassified" | "plan" | "growth",
): string {
  let rows: Record<string, unknown>[];
  if (table === "plan" || table === "growth") {
    const planRows = (table === "growth" ? data.plan.rows.filter((row) => (row.remainingToPlan ?? 0) > 0) : data.plan.rows)
      .map((row) => ({
        Период: `${data.period.dateFrom} — ${data.period.dateTo}`,
        Филиал: data.scope.branchNames.join(", "),
        Код: row.metricCode,
        Категория: row.title,
        Тип: row.kind === "service" ? "Услуга" : "Товар",
        Факт: row.actualCount,
        План: row.targetCount,
        "Выполнение, %": row.completionPercent,
        "Предыдущий период": row.previousActualCount,
        "Изменение, %": row.changePercent,
        Прогноз: row.forecastCount,
        "Прогнозируемый разрыв": row.forecastGap,
        "Выручка факт, ₽": row.actualRevenueCents / 100,
        "Выручка план, ₽": row.targetRevenueCents == null ? null : row.targetRevenueCents / 100,
        "Выручка прогноз, ₽": row.forecastRevenueCents == null ? null : row.forecastRevenueCents / 100,
        "Валовая прибыль факт, ₽": row.actualGrossProfitCents == null ? null : row.actualGrossProfitCents / 100,
        "Валовая прибыль план, ₽": row.targetGrossProfitCents == null ? null : row.targetGrossProfitCents / 100,
        "Валовая прибыль прогноз, ₽": row.forecastGrossProfitCents == null ? null : row.forecastGrossProfitCents / 100,
        "Потенциал выручки, ₽": row.potentialRevenueCents == null ? null : row.potentialRevenueCents / 100,
        "Потенциал валовой прибыли, ₽": row.potentialGrossProfitCents == null ? null : row.potentialGrossProfitCents / 100,
        "База потенциала выручки": row.potentialRevenueBasis.source,
        "База потенциала прибыли": row.potentialGrossProfitBasis.source,
        "Attach rate факт, %": null,
        "Attach rate план, %": row.targetAttachRatePercent,
        "Резерв attach, визитов": null,
      }));
    const attachRows = table === "growth" ? data.plan.attachOpportunities.map((row) => ({
      Период: `${data.period.dateFrom} — ${data.period.dateTo}`,
      Филиал: data.scope.branchNames.join(", "),
      Код: row.metricCode,
      Категория: `${row.title} — attach rate`,
      Тип: "Attach opportunity",
      Факт: row.attachedVisits,
      План: row.targetAttachedVisits,
      "Выполнение, %": row.targetAttachedVisits ? row.attachedVisits / row.targetAttachedVisits * 100 : null,
      "Предыдущий период": null,
      "Изменение, %": null,
      Прогноз: null,
      "Прогнозируемый разрыв": row.opportunityVisits,
      "Выручка факт, ₽": null,
      "Выручка план, ₽": null,
      "Выручка прогноз, ₽": null,
      "Валовая прибыль факт, ₽": null,
      "Валовая прибыль план, ₽": null,
      "Валовая прибыль прогноз, ₽": null,
      "Потенциал выручки, ₽": null,
      "Потенциал валовой прибыли, ₽": row.opportunityGrossProfitCents == null ? null : row.opportunityGrossProfitCents / 100,
      "База потенциала выручки": null,
      "База потенциала прибыли": row.grossProfitBasis.source,
      "Attach rate факт, %": row.actualRatePercent,
      "Attach rate план, %": row.targetRatePercent,
      "Резерв attach, визитов": row.opportunityVisits,
    })) : [];
    rows = [...planRows, ...attachRows];
  } else if (table === "services") {
    rows = data.services.map((row) => ({
      Код: row.metricCode,
      Операция: row.title,
      Агрегат: row.aggregateType,
      Процедура: row.procedure,
      Конфигурация: row.configuration,
      Операций: row.operationsCount,
      Клиентов: row.clientsCount,
      "Прямая выручка, ₽": row.directRevenueCents / 100,
      "Связанные материалы, ₽": row.linkedRevenueCents / 100,
      "Валовая прибыль материалов, ₽": row.linkedGrossProfitCents == null ? null : row.linkedGrossProfitCents / 100,
    }));
  } else if (table === "unclassified") {
    rows = data.unclassified.map((row) => ({
      Тип: row.kind === "service" ? "Услуга" : "Товар",
      Название: row.name,
      Источник: row.sourceType,
      "ID источника": row.sourceId,
      Строк: row.linesCount,
      Документов: row.documentsCount,
      "Выручка, ₽": row.revenueCents / 100,
      Филиалы: row.branchNames.join(", "),
    }));
  } else {
    rows = data.products.map((row) => ({
      Код: row.metricCode,
      Категория: row.title,
      Количество: row.quantity,
      Единица: row.unit,
      "Покрытие количества, %": row.quantityCoveragePercent,
      Документов: row.documentsCount,
      Клиентов: row.clientsCount,
      "Выручка, ₽": row.revenueCents / 100,
      "Себестоимость, ₽": row.costCents == null ? null : row.costCents / 100,
      "Валовая прибыль, ₽": row.grossProfitCents == null ? null : row.grossProfitCents / 100,
      "Маржа, %": row.marginPercent,
    }));
  }
  const headers = rows[0] ? Object.keys(rows[0]) : ["Нет данных"];
  return `\uFEFF${[
    headers.map(csvCell).join(";"),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(";")),
  ].join("\n")}`;
}

export function normalizeManualMappingSource(sourceType: unknown, sourceId: unknown) {
  const type = String(sourceType ?? "") as SalesAnalyticsSourceType;
  if (!["CATALOG_GROUP", "CATALOG_ITEM", "LEGACY_NAME"].includes(type)) throw new Error("Недопустимый тип источника mapping");
  const rawId = String(sourceId ?? "").trim();
  const id = type === "LEGACY_NAME" ? normalizeSalesAnalyticsText(rawId) : rawId;
  if (!id) throw new Error("Не указан источник mapping");
  return { sourceType: type, sourceId: id };
}
