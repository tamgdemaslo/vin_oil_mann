import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toServiceDateInput } from "@/lib/date-time";

export type WarehouseAnalyticsTable =
  | "top-products"
  | "margins"
  | "dead-stock"
  | "never-sold"
  | "stockouts"
  | "card-quality"
  | "abc-xyz"
  | "replenishment"
  | "new-location"
  | "categories"
  | "brands"
  | "suppliers";

export type WarehouseAnalyticsParams = {
  period?: string;
  dateFrom?: string;
  dateTo?: string;
  organizationId?: string;
  warehouseId?: string;
  category?: string;
  brand?: string;
  supplier?: string;
  entityType?: string;
  includeArchived?: boolean;
  onlyActive?: boolean;
  onlyWithStock?: boolean;
  onlyWithoutSales?: boolean;
  onlyProblems?: boolean;
  onlyMarked?: boolean;
  onlyBulkOil?: boolean;
  onlyNegativeStock?: boolean;
  onlyZeroCost?: boolean;
  productId?: string;
  limit?: number;
  offset?: number;
  sort?: string;
  direction?: "asc" | "desc";
  refresh?: boolean;
};

export type WarehouseAnalyticsKpi = {
  key: string;
  label: string;
  value: number;
  format: "count" | "money" | "percent" | "quantity";
  tone?: "neutral" | "rust" | "success" | "warning" | "danger" | "info";
  sub?: string;
};

export type WarehouseAnalyticsProductRow = {
  productId: string;
  name: string;
  article: string | null;
  code: string | null;
  category: string | null;
  categoryPath: string | null;
  brand: string | null;
  supplier: string | null;
  entityType: string;
  archived: boolean;
  uomName: string | null;
  cell: string | null;
  salePrice: number;
  buyPrice: number | null;
  currentStock: number;
  available: number;
  reserve: number;
  minimumBalance: number | null;
  stockCost: number;
  stockSaleValue: number;
  potentialStockMargin: number;
  soldQuantity: number;
  salesCount: number;
  shipmentsCount: number;
  uniqueClients: number;
  revenue: number;
  cost: number | null;
  grossProfit: number | null;
  marginPercent: number | null;
  marginPerUnit: number | null;
  averageSalePrice: number | null;
  averageBuyPrice: number | null;
  averageDiscount: number | null;
  lastSaleDate: string | null;
  daysWithoutSale: number | null;
  lastReceiptDate: string | null;
  firstReceiptDate: string | null;
  receivedQuantity: number;
  writeoffQuantity: number;
  turnover: number | null;
  stockDays: number | null;
  dailySales: number;
  zeroEvents: number;
  daysOutOfStock: number;
  shortage: number;
  stockoutStatus: string | null;
  deadStockStatus: string | null;
  abcRevenue: "A" | "B" | "C";
  abcProfit: "A" | "B" | "C";
  xyz: "X" | "Y" | "Z";
  revenueShare: number;
  profitShare: number;
  cumulativeRevenueShare: number;
  cumulativeProfitShare: number;
  variation: number | null;
  recommendedMin: number;
  recommendedMax: number;
  recommendedOrderQuantity: number;
  qualityProblems: string[];
  recommendation: string;
};

export type WarehouseAnalyticsQualityGroup = {
  key: string;
  label: string;
  description: string;
  count: number;
  severity: "warning" | "danger";
  productIds: string[];
};

export type WarehouseAnalyticsMatrixCell = {
  key: string;
  productsCount: number;
  stockCost: number;
  revenue: number;
  grossProfit: number;
  recommendation: string;
};

export type WarehouseAnalyticsGroupRow = {
  key: string;
  name: string;
  productsCount: number;
  activeProducts: number;
  productsWithStock: number;
  soldQuantity: number;
  revenue: number;
  grossProfit: number;
  marginPercent: number | null;
  salesCount: number;
  stockCost: number;
  deadStockCount: number;
  neverSoldCount: number;
  stockoutCount: number;
};

export type WarehouseAnalyticsOption = { id: string; name: string };
export type WarehouseAnalyticsValueOption = { value: string; count: number };

export type WarehouseProductAnalytics = {
  period: { key: string; label: string; dateFrom: string; dateTo: string; days: number };
  calculatedAt: string;
  cacheTtlSeconds: number;
  filters: Required<
    Pick<
      WarehouseAnalyticsParams,
      | "organizationId"
      | "warehouseId"
      | "category"
      | "brand"
      | "supplier"
      | "entityType"
      | "includeArchived"
      | "onlyActive"
      | "onlyWithStock"
      | "onlyWithoutSales"
      | "onlyProblems"
      | "onlyMarked"
      | "onlyBulkOil"
      | "onlyNegativeStock"
      | "onlyZeroCost"
    >
  >;
  options: {
    organizations: WarehouseAnalyticsOption[];
    warehouses: WarehouseAnalyticsOption[];
    categories: WarehouseAnalyticsValueOption[];
    brands: WarehouseAnalyticsValueOption[];
    suppliers: WarehouseAnalyticsValueOption[];
    entityTypes: WarehouseAnalyticsValueOption[];
  };
  summary: {
    totalProducts: number;
    activeProducts: number;
    productsWithStock: number;
    productsWithoutStock: number;
    negativeStockProducts: number;
    productsWithoutCategory: number;
    productsWithoutBuyPrice: number;
    productsWithoutSalePrice: number;
    productsWithoutSupplier: number;
    productsWithoutCell: number;
    neverSoldProducts: number;
    notSold30Days: number;
    notSold90Days: number;
    highMarginProducts: number;
    lowMarginProducts: number;
    frequentStockoutProducts: number;
    stockCost: number;
    stockSaleValue: number;
    potentialStockMargin: number;
    grossProfit: number;
    averageMarginPercent: number | null;
    salesRevenue: number;
    soldQuantity: number;
  };
  kpis: WarehouseAnalyticsKpi[];
  overview: {
    topRevenue: WarehouseAnalyticsProductRow[];
    topProfit: WarehouseAnalyticsProductRow[];
    topQuantity: WarehouseAnalyticsProductRow[];
    deadStock: WarehouseAnalyticsProductRow[];
    cardProblems: WarehouseAnalyticsProductRow[];
    stockouts: WarehouseAnalyticsProductRow[];
  };
  topProducts: WarehouseAnalyticsProductRow[];
  margins: WarehouseAnalyticsProductRow[];
  deadStock: WarehouseAnalyticsProductRow[];
  neverSold: WarehouseAnalyticsProductRow[];
  stockouts: WarehouseAnalyticsProductRow[];
  cardQuality: {
    groups: WarehouseAnalyticsQualityGroup[];
    products: WarehouseAnalyticsProductRow[];
  };
  abcXyz: {
    rows: WarehouseAnalyticsProductRow[];
    matrix: WarehouseAnalyticsMatrixCell[];
  };
  replenishment: WarehouseAnalyticsProductRow[];
  newLocation: {
    rows: WarehouseAnalyticsProductRow[];
    summary: {
      baseProducts: number;
      extendedProducts: number;
      preorderProducts: number;
      baseCost: number;
      extendedCost: number;
      expectedMargin: number;
      categoriesCount: number;
      suppliersCount: number;
    };
  };
  categories: WarehouseAnalyticsGroupRow[];
  brands: WarehouseAnalyticsGroupRow[];
  suppliers: WarehouseAnalyticsGroupRow[];
};

type ProductWithStock = Prisma.LocalProductGetPayload<{ include: { stockBalances: true } }>;
type SalesPosition = Prisma.LocalDemandPositionGetPayload<{
  include: {
    demand: { select: { id: true; documentDate: true; momentAt: true; counterpartyId: true; agentMoyskladId: true } };
    product: { select: { buyPriceCents: true; entityType: true } };
  };
}>;
type LifetimeSalePosition = Prisma.LocalDemandPositionGetPayload<{
  include: { demand: { select: { documentDate: true; momentAt: true } } };
}>;
type InventoryPosition = Prisma.LocalInventoryDocumentPositionGetPayload<{
  include: { document: { select: { type: true; documentDate: true; momentAt: true; affectsManagementProfit: true; adjustmentType: true } } };
}>;

type InternalMetric = WarehouseAnalyticsProductRow & {
  costCents: number;
  profitCents: number;
  revenueCents: number;
  knownCostRevenueCents: number;
  stockCostCents: number;
  stockSaleValueCents: number;
  potentialStockMarginCents: number;
  salesDocuments: Set<string>;
  clients: Set<string>;
  discountSum: number;
  discountRows: number;
  lifetimeSoldQuantity: number;
  lifetimeSalesCount: number;
  salesBuckets: number[];
  hasScopedStock: boolean;
};

type CacheEntry = { key: string; expiresAt: number; value: WarehouseProductAnalytics };

const ANALYTICS_CACHE_MS = 60_000;
const analyticsCache = ((globalThis as typeof globalThis & {
  __warehouseProductAnalyticsCache?: { entry: CacheEntry | null };
}).__warehouseProductAnalyticsCache ??= { entry: null });

function cleanText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function normalizeId(value: string | null | undefined): string {
  return cleanText(value);
}

function readBool(value: string | null | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

export function warehouseAnalyticsParamsFromSearchParams(searchParams: URLSearchParams): WarehouseAnalyticsParams {
  const direction = searchParams.get("direction") === "asc" ? "asc" : "desc";
  return {
    period: searchParams.get("period") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    organizationId: searchParams.get("organizationId") ?? undefined,
    warehouseId: searchParams.get("warehouseId") ?? searchParams.get("storeId") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    brand: searchParams.get("brand") ?? undefined,
    supplier: searchParams.get("supplier") ?? undefined,
    entityType: searchParams.get("entityType") ?? undefined,
    includeArchived: readBool(searchParams.get("includeArchived") ?? searchParams.get("archived")),
    onlyActive: readBool(searchParams.get("onlyActive")),
    onlyWithStock: readBool(searchParams.get("onlyWithStock")),
    onlyWithoutSales: readBool(searchParams.get("onlyWithoutSales")),
    onlyProblems: readBool(searchParams.get("onlyProblems")),
    onlyMarked: readBool(searchParams.get("onlyMarked")),
    onlyBulkOil: readBool(searchParams.get("onlyBulkOil")),
    onlyNegativeStock: readBool(searchParams.get("onlyNegativeStock")),
    onlyZeroCost: readBool(searchParams.get("onlyZeroCost")),
    limit: normalizeLimit(searchParams.get("limit")),
    offset: normalizeOffset(searchParams.get("offset")),
    sort: searchParams.get("sort") ?? undefined,
    direction,
    refresh: readBool(searchParams.get("refresh")),
  };
}

function normalizeLimit(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 100);
  return Number.isFinite(parsed) ? Math.min(500, Math.max(1, Math.trunc(parsed))) : 100;
}

function normalizeOffset(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
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

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function previousMonthRange(today: string) {
  const date = dateFromYmd(monthStart(today));
  date.setUTCMonth(date.getUTCMonth() - 1);
  const dateFrom = ymd(date);
  const last = dateFromYmd(monthStart(today));
  last.setUTCDate(0);
  return { dateFrom, dateTo: ymd(last) };
}

function daysBetween(dateFrom: string, dateTo: string): number {
  const from = dateFromYmd(dateFrom).getTime();
  const to = dateFromYmd(dateTo).getTime();
  return Math.max(1, Math.floor((to - from) / 86_400_000) + 1);
}

function normalizeDateRange(params: WarehouseAnalyticsParams) {
  const today = toServiceDateInput(new Date());
  const period = cleanText(params.period) || "30d";
  let dateFrom = params.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(params.dateFrom) ? params.dateFrom : "";
  let dateTo = params.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(params.dateTo) ? params.dateTo : "";

  if (!dateFrom || !dateTo) {
    if (period === "today") {
      dateFrom = today;
      dateTo = today;
    } else if (period === "7d") {
      dateFrom = addDays(today, -6);
      dateTo = today;
    } else if (period === "current-month") {
      dateFrom = monthStart(today);
      dateTo = today;
    } else if (period === "previous-month") {
      const previous = previousMonthRange(today);
      dateFrom = previous.dateFrom;
      dateTo = previous.dateTo;
    } else if (period === "90d") {
      dateFrom = addDays(today, -89);
      dateTo = today;
    } else if (period === "year") {
      dateFrom = addDays(today, -364);
      dateTo = today;
    } else {
      dateFrom = addDays(today, -29);
      dateTo = today;
    }
  }

  if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  const labels: Record<string, string> = {
    today: "Сегодня",
    "7d": "7 дней",
    "30d": "30 дней",
    "current-month": "Текущий месяц",
    "previous-month": "Прошлый месяц",
    "90d": "90 дней",
    year: "Год",
    custom: "Произвольный период",
  };
  return {
    key: period,
    label: labels[period] ?? "30 дней",
    dateFrom,
    dateTo,
    days: daysBetween(dateFrom, dateTo),
  };
}

function decimalToNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "object" && "toNumber" in value && typeof value.toNumber === "function") {
    const parsed = value.toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rub(cents: number | null | undefined): number | null {
  return cents == null ? null : Math.round(cents) / 100;
}

function money(value: number | null | undefined): number {
  return rub(value) ?? 0;
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function marginPercent(revenueCents: number, profitCents: number | null): number | null {
  if (profitCents == null || revenueCents <= 0) return null;
  return (profitCents / revenueCents) * 100;
}

function categoryLabel(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const parts = text.split(/[>/]/).map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? text;
}

function optionKey(value: string | null | undefined): string {
  return cleanText(value) || "Не заполнено";
}

function buildOptions(values: Array<string | null | undefined>): WarehouseAnalyticsValueOption[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = cleanText(value);
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"))
    .slice(0, 250)
    .map(([value, count]) => ({ value, count }));
}

function lineRevenueCents(position: Pick<SalesPosition, "quantity" | "priceCentsPerUnit" | "discount">): number {
  const quantity = decimalToNumber(position.quantity);
  const discount = decimalToNumber(position.discount);
  return Math.round(quantity * position.priceCentsPerUnit * (1 - discount / 100));
}

function lineCostCents(quantity: number, costPerUnit: number | null | undefined): number | null {
  return costPerUnit == null ? null : Math.round(quantity * costPerUnit);
}

function isServiceEntity(type: string | null | undefined): boolean {
  return cleanText(type).toLowerCase() === "service";
}

function isMarked(product: Pick<ProductWithStock, "markingEnabled" | "markingMode" | "markingStatus">): boolean {
  return product.markingEnabled || !["", "NOT_MARKED", "not_marked"].includes(cleanText(product.markingMode));
}

function isBulkOil(product: Pick<ProductWithStock, "name" | "groupPath" | "uomName" | "packageVolume">): boolean {
  const text = [product.name, product.groupPath, product.uomName, product.packageVolume].join(" ").toLowerCase();
  return /(масл|oil)/i.test(text) && /(разлив|литр|л\b|l\b)/i.test(text);
}

function emptyMetric(product: ProductWithStock, bucketCount: number): InternalMetric {
  let currentStock = 0;
  let available = 0;
  let reserve = 0;
  let stockCostCents = 0;
  let stockSaleValueCents = 0;
  let cell = cleanText(product.cell) || null;
  for (const balance of product.stockBalances) {
    const quantity = decimalToNumber(balance.quantity);
    currentStock += quantity;
    available += decimalToNumber(balance.available);
    reserve += decimalToNumber(balance.reserve);
    const cost = balance.buyPriceCents ?? product.buyPriceCents ?? 0;
    stockCostCents += Math.round(quantity * cost);
    stockSaleValueCents += Math.round(quantity * product.salePriceCents);
    if (!cell) cell = cleanText(balance.slotName) || null;
  }

  const buyPrice = product.buyPriceCents == null ? null : money(product.buyPriceCents);
  const salePrice = money(product.salePriceCents);
  const minimumBalance = product.minimumBalance == null ? null : decimalToNumber(product.minimumBalance);
  const category = categoryLabel(product.groupPath);
  const stockCost = money(stockCostCents);
  const stockSaleValue = money(stockSaleValueCents);

  return {
    productId: product.id,
    name: product.name,
    article: product.article ?? null,
    code: product.code ?? null,
    category,
    categoryPath: product.groupPath ?? null,
    brand: product.brand ?? null,
    supplier: product.supplierName ?? product.supplierAttribute ?? null,
    entityType: product.entityType,
    archived: product.archived,
    uomName: product.uomName ?? null,
    cell,
    salePrice,
    buyPrice,
    currentStock,
    available,
    reserve,
    minimumBalance,
    stockCost,
    stockSaleValue,
    potentialStockMargin: stockSaleValue - stockCost,
    soldQuantity: 0,
    salesCount: 0,
    shipmentsCount: 0,
    uniqueClients: 0,
    revenue: 0,
    cost: null,
    grossProfit: null,
    marginPercent: null,
    marginPerUnit: null,
    averageSalePrice: null,
    averageBuyPrice: null,
    averageDiscount: null,
    lastSaleDate: null,
    daysWithoutSale: null,
    lastReceiptDate: null,
    firstReceiptDate: null,
    receivedQuantity: 0,
    writeoffQuantity: 0,
    turnover: null,
    stockDays: null,
    dailySales: 0,
    zeroEvents: 0,
    daysOutOfStock: 0,
    shortage: 0,
    stockoutStatus: null,
    deadStockStatus: null,
    abcRevenue: "C",
    abcProfit: "C",
    xyz: "Z",
    revenueShare: 0,
    profitShare: 0,
    cumulativeRevenueShare: 0,
    cumulativeProfitShare: 0,
    variation: null,
    recommendedMin: 0,
    recommendedMax: 0,
    recommendedOrderQuantity: 0,
    qualityProblems: [],
    recommendation: "",
    costCents: 0,
    profitCents: 0,
    revenueCents: 0,
    knownCostRevenueCents: 0,
    stockCostCents,
    stockSaleValueCents,
    potentialStockMarginCents: stockSaleValueCents - stockCostCents,
    salesDocuments: new Set<string>(),
    clients: new Set<string>(),
    discountSum: 0,
    discountRows: 0,
    lifetimeSoldQuantity: 0,
    lifetimeSalesCount: 0,
    salesBuckets: Array.from({ length: bucketCount }, () => 0),
    hasScopedStock: product.stockBalances.length > 0,
  };
}

function updateLastDate(current: string | null, next: string | null | undefined): string | null {
  if (!next) return current;
  if (!current || next > current) return next;
  return current;
}

function updateFirstDate(current: string | null, next: string | null | undefined): string | null {
  if (!next) return current;
  if (!current || next < current) return next;
  return current;
}

function bucketIndex(date: string, dateFrom: string, bucketCount: number): number {
  const index = Math.floor((dateFromYmd(date).getTime() - dateFromYmd(dateFrom).getTime()) / (86_400_000 * 7));
  return Math.max(0, Math.min(bucketCount - 1, index));
}

function variation(values: number[]): number | null {
  if (values.length === 0) return null;
  const average = values.reduce((sum, item) => sum + item, 0) / values.length;
  if (average <= 0) return null;
  const variance = values.reduce((sum, item) => sum + (item - average) ** 2, 0) / values.length;
  return Math.sqrt(variance) / average;
}

function xyzFromVariation(value: number | null): "X" | "Y" | "Z" {
  if (value == null) return "Z";
  if (value <= 0.5) return "X";
  if (value <= 1) return "Y";
  return "Z";
}

function assignAbc(metrics: InternalMetric[], field: "revenueCents" | "profitCents", target: "abcRevenue" | "abcProfit") {
  const positiveRows = metrics.filter((row) => Math.max(0, row[field]) > 0).sort((a, b) => b[field] - a[field]);
  const total = positiveRows.reduce((sum, row) => sum + Math.max(0, row[field]), 0);
  let cumulative = 0;
  for (const row of positiveRows) {
    cumulative += Math.max(0, row[field]);
    const share = percent(Math.max(0, row[field]), total);
    const cumulativeShare = percent(cumulative, total);
    if (target === "abcRevenue") {
      row.revenueShare = share;
      row.cumulativeRevenueShare = cumulativeShare;
    } else {
      row.profitShare = share;
      row.cumulativeProfitShare = cumulativeShare;
    }
    row[target] = cumulativeShare <= 80 ? "A" : cumulativeShare <= 95 ? "B" : "C";
  }
}

function detectQualityProblems(row: InternalMetric): string[] {
  const problems: string[] = [];
  if (!row.category) problems.push("нет категории");
  if (!cleanText(row.brand)) problems.push("нет бренда");
  if (!cleanText(row.article) && !cleanText(row.code)) problems.push("нет артикула или кода");
  if (row.buyPrice == null || row.buyPrice <= 0) problems.push("нет закупочной цены");
  if (row.salePrice <= 0) problems.push("нет цены продажи");
  if (!cleanText(row.supplier)) problems.push("нет поставщика");
  if (!cleanText(row.cell) && row.currentStock > 0) problems.push("нет ячейки");
  if (row.minimumBalance == null) problems.push("нет минимального остатка");
  if (!cleanText(row.uomName)) problems.push("нет единицы измерения");
  if (row.currentStock < 0 || row.available < 0) problems.push("отрицательный остаток");
  if (row.buyPrice != null && row.buyPrice <= 0) problems.push("нулевая себестоимость");
  if (row.marginPercent != null && row.marginPercent < 0) problems.push("продажа в минус");
  if (!row.archived && row.currentStock <= 0 && row.lifetimeSalesCount === 0) problems.push("активный товар без продаж и остатка");
  if (row.archived && row.currentStock > 0) problems.push("архивный товар с остатком");
  return problems;
}

function deadStockStatus(row: InternalMetric): string | null {
  if (row.currentStock <= 0) return null;
  if (row.lifetimeSalesCount === 0) return "Никогда не продавался";
  const days = row.daysWithoutSale ?? 0;
  if (days >= 180) return "Мёртвый остаток";
  if (days >= 90) return "Лежит 90+ дней";
  if (days >= 60) return "Лежит 60+ дней";
  if (days >= 30) return "Лежит 30+ дней";
  return null;
}

function stockoutStatus(row: InternalMetric): string | null {
  if (row.available < 0) return "Отрицательный остаток";
  if (row.available <= 0 && row.lifetimeSalesCount > 0) return "Нужно заказать";
  if (row.minimumBalance != null && row.available < row.minimumBalance) return "Ниже минимума";
  if (row.dailySales > 0 && row.stockDays != null && row.stockDays <= 14) return "Скоро закончится";
  if (row.minimumBalance == null && row.soldQuantity > 0) return "Нет правила пополнения";
  return null;
}

function recommendation(row: InternalMetric): string {
  if (row.qualityProblems.includes("нет закупочной цены")) return "Заполнить закупочную цену, иначе маржа считается неточно.";
  if (row.stockoutStatus) return "Добавить в закупку и пересмотреть минимальный остаток.";
  if (row.deadStockStatus) return "Проверить цену, карточку и сценарий распродажи или заказа под клиента.";
  if (row.marginPercent != null && row.marginPercent < 12 && row.revenue > 0) return "Товар продаётся, но маржа ниже средней. Проверьте цену продажи или закупку.";
  if (row.abcRevenue === "A" && row.xyz === "X") return "Обязательный ассортимент: держать в наличии и не допускать дефицита.";
  return "Наблюдать по текущим правилам склада.";
}

function finalizeMetrics(metrics: InternalMetric[], period: { dateFrom: string; dateTo: string; days: number }) {
  const today = toServiceDateInput(new Date());
  for (const row of metrics) {
    row.shipmentsCount = row.salesDocuments.size;
    row.uniqueClients = row.clients.size;
    row.revenue = money(row.revenueCents);
    row.cost = row.costCents > 0 || row.soldQuantity > 0 && row.knownCostRevenueCents > 0 ? money(row.costCents) : null;
    row.grossProfit = row.knownCostRevenueCents > 0 ? money(row.profitCents) : null;
    row.marginPercent = marginPercent(row.knownCostRevenueCents, row.knownCostRevenueCents > 0 ? row.profitCents : null);
    row.marginPerUnit = row.soldQuantity > 0 && row.grossProfit != null ? row.grossProfit / row.soldQuantity : null;
    row.averageSalePrice = row.soldQuantity > 0 ? row.revenue / row.soldQuantity : null;
    row.averageBuyPrice = row.soldQuantity > 0 && row.cost != null ? row.cost / row.soldQuantity : row.buyPrice;
    row.averageDiscount = row.discountRows > 0 ? row.discountSum / row.discountRows : null;
    row.daysWithoutSale = row.lastSaleDate ? daysBetween(row.lastSaleDate, today) - 1 : null;
    row.dailySales = row.soldQuantity / period.days;
    row.turnover = row.currentStock > 0 && row.soldQuantity > 0 ? row.soldQuantity / row.currentStock : null;
    row.stockDays = row.dailySales > 0 ? row.available / row.dailySales : null;
    row.zeroEvents = row.available <= 0 && row.lifetimeSalesCount > 0 ? 1 : 0;
    row.daysOutOfStock = row.available <= 0 && row.lifetimeSalesCount > 0 ? Math.min(period.days, row.daysWithoutSale ?? period.days) : 0;
    row.shortage = Math.max(0, (row.minimumBalance ?? 0) - row.available);
    row.variation = variation(row.salesBuckets);
    row.xyz = xyzFromVariation(row.variation);
  }

  assignAbc(metrics, "revenueCents", "abcRevenue");
  assignAbc(metrics, "profitCents", "abcProfit");

  for (const row of metrics) {
    const leadDays = row.abcRevenue === "A" || row.xyz === "X" ? 14 : 7;
    const baseMin = Math.ceil(row.dailySales * leadDays);
    row.recommendedMin = Math.max(row.minimumBalance ?? 0, baseMin, row.abcRevenue === "A" && row.soldQuantity > 0 ? 1 : 0);
    row.recommendedMax = Math.max(row.recommendedMin, Math.ceil(row.recommendedMin * 1.8));
    row.recommendedOrderQuantity = Math.max(0, Math.ceil(row.recommendedMin - row.available));
    row.deadStockStatus = deadStockStatus(row);
    row.stockoutStatus = stockoutStatus(row);
    row.qualityProblems = detectQualityProblems(row);
    row.recommendation = recommendation(row);
  }
}

function productPassesPostFilters(row: InternalMetric, params: WarehouseProductAnalytics["filters"], hasScopeFilter: boolean): boolean {
  if (hasScopeFilter && !row.hasScopedStock && row.lifetimeSalesCount === 0 && row.receivedQuantity === 0 && row.writeoffQuantity === 0) return false;
  if (params.onlyActive && row.archived) return false;
  if (params.onlyWithStock && row.currentStock <= 0) return false;
  if (params.onlyWithoutSales && row.lifetimeSalesCount > 0) return false;
  if (params.onlyProblems && row.qualityProblems.length === 0 && !row.deadStockStatus && !row.stockoutStatus) return false;
  if (params.onlyNegativeStock && row.currentStock >= 0 && row.available >= 0) return false;
  if (params.onlyZeroCost && !(row.buyPrice == null || row.buyPrice <= 0 || row.qualityProblems.includes("нет закупочной цены"))) return false;
  return true;
}

function productToPublic(row: InternalMetric): WarehouseAnalyticsProductRow {
  const {
    costCents,
    profitCents,
    revenueCents,
    knownCostRevenueCents,
    stockCostCents,
    stockSaleValueCents,
    potentialStockMarginCents,
    salesDocuments,
    clients,
    discountSum,
    discountRows,
    lifetimeSoldQuantity,
    lifetimeSalesCount,
    salesBuckets,
    hasScopedStock,
    ...publicRow
  } = row;
  void costCents;
  void profitCents;
  void revenueCents;
  void knownCostRevenueCents;
  void stockCostCents;
  void stockSaleValueCents;
  void potentialStockMarginCents;
  void salesDocuments;
  void clients;
  void discountSum;
  void discountRows;
  void lifetimeSoldQuantity;
  void lifetimeSalesCount;
  void salesBuckets;
  void hasScopedStock;
  return publicRow;
}

function sortByNumber(rows: InternalMetric[], getter: (row: InternalMetric) => number | null | undefined, direction: "asc" | "desc" = "desc") {
  return [...rows].sort((a, b) => {
    const av = getter(a) ?? Number.NEGATIVE_INFINITY;
    const bv = getter(b) ?? Number.NEGATIVE_INFINITY;
    return direction === "desc" ? bv - av : av - bv;
  });
}

function qualityGroups(rows: InternalMetric[]): WarehouseAnalyticsQualityGroup[] {
  const definitions = [
    { key: "no_category", label: "Товары без категории", match: (row: InternalMetric) => !row.category, severity: "warning" as const, description: "Категория нужна для фильтров, закупок и аналитики." },
    { key: "no_brand", label: "Товары без бренда", match: (row: InternalMetric) => !cleanText(row.brand), severity: "warning" as const, description: "Без бренда сложнее искать аналоги и сравнивать поставщиков." },
    { key: "no_article", label: "Без артикула или кода", match: (row: InternalMetric) => !cleanText(row.article) && !cleanText(row.code), severity: "warning" as const, description: "Такие товары хуже ищутся в отгрузке и закупке." },
    { key: "no_buy_price", label: "Без закупочной цены", match: (row: InternalMetric) => row.buyPrice == null || row.buyPrice <= 0, severity: "danger" as const, description: "Маржа и стоимость склада могут считаться неверно." },
    { key: "no_sale_price", label: "Без цены продажи", match: (row: InternalMetric) => row.salePrice <= 0, severity: "danger" as const, description: "Товар нельзя корректно продавать и оценивать по выручке." },
    { key: "no_supplier", label: "Без поставщика", match: (row: InternalMetric) => !cleanText(row.supplier), severity: "warning" as const, description: "Закупка и рекомендации пополнения работают хуже." },
    { key: "no_cell", label: "Остаток без ячейки", match: (row: InternalMetric) => row.currentStock > 0 && !cleanText(row.cell), severity: "warning" as const, description: "Товар сложнее найти на складе." },
    { key: "negative_stock", label: "Отрицательный остаток", match: (row: InternalMetric) => row.currentStock < 0 || row.available < 0, severity: "danger" as const, description: "Нужна инвентаризация или исправление движения." },
    { key: "negative_margin", label: "Продажи в минус", match: (row: InternalMetric) => row.marginPercent != null && row.marginPercent < 0, severity: "danger" as const, description: "Себестоимость выше выручки. Проверьте цену или скидки." },
    { key: "archived_with_stock", label: "Архивные с остатком", match: (row: InternalMetric) => row.archived && row.currentStock > 0, severity: "warning" as const, description: "Архивная карточка продолжает замораживать склад." },
  ];
  return definitions
    .map((definition) => {
      const matched = rows.filter(definition.match);
      return {
        key: definition.key,
        label: definition.label,
        description: definition.description,
        count: matched.length,
        severity: definition.severity,
        productIds: matched.slice(0, 50).map((row) => row.productId),
      };
    })
    .filter((group) => group.count > 0)
    .sort((a, b) => (a.severity === b.severity ? b.count - a.count : a.severity === "danger" ? -1 : 1));
}

function buildMatrix(rows: InternalMetric[]): WarehouseAnalyticsMatrixCell[] {
  const recommendations: Record<string, string> = {
    AX: "Обязательный ассортимент: держать в наличии и контролировать дефицит.",
    AY: "Важные товары с умеренным спросом: держать минимум и следить за сезонностью.",
    AZ: "Дают вклад, но спрос неровный: закупать осторожно.",
    BX: "Средний вклад и стабильный спрос: держать по правилу минимума.",
    BY: "Средние товары: закупать по фактическому спросу.",
    BZ: "Средний вклад, нерегулярно: чаще под заказ.",
    CX: "Стабильные, но малый вклад: держать минимально.",
    CY: "Низкий вклад: проверить необходимость на складе.",
    CZ: "Кандидаты на вывод из склада или продажу под заказ.",
  };
  const cells = new Map<string, WarehouseAnalyticsMatrixCell>();
  for (const key of Object.keys(recommendations)) {
    cells.set(key, { key, productsCount: 0, stockCost: 0, revenue: 0, grossProfit: 0, recommendation: recommendations[key] });
  }
  for (const row of rows) {
    const key = `${row.abcRevenue}${row.xyz}`;
    const current = cells.get(key);
    if (!current) continue;
    current.productsCount += 1;
    current.stockCost += row.stockCost;
    current.revenue += row.revenue;
    current.grossProfit += row.grossProfit ?? 0;
  }
  return [...cells.values()];
}

function emptyGroup(key: string, name: string): WarehouseAnalyticsGroupRow {
  return {
    key,
    name,
    productsCount: 0,
    activeProducts: 0,
    productsWithStock: 0,
    soldQuantity: 0,
    revenue: 0,
    grossProfit: 0,
    marginPercent: null,
    salesCount: 0,
    stockCost: 0,
    deadStockCount: 0,
    neverSoldCount: 0,
    stockoutCount: 0,
  };
}

function groupRows(rows: InternalMetric[], keyGetter: (row: InternalMetric) => string | null | undefined): WarehouseAnalyticsGroupRow[] {
  const groups = new Map<string, WarehouseAnalyticsGroupRow & { revenueForMargin: number; profitForMargin: number }>();
  for (const row of rows) {
    const key = optionKey(keyGetter(row));
    const group = groups.get(key) ?? { ...emptyGroup(key, key), revenueForMargin: 0, profitForMargin: 0 };
    group.productsCount += 1;
    if (!row.archived) group.activeProducts += 1;
    if (row.currentStock > 0) group.productsWithStock += 1;
    group.soldQuantity += row.soldQuantity;
    group.revenue += row.revenue;
    group.grossProfit += row.grossProfit ?? 0;
    group.salesCount += row.salesCount;
    group.stockCost += row.stockCost;
    if (row.deadStockStatus) group.deadStockCount += 1;
    if (row.lifetimeSalesCount === 0) group.neverSoldCount += 1;
    if (row.stockoutStatus) group.stockoutCount += 1;
    if (row.grossProfit != null) {
      group.revenueForMargin += row.revenue;
      group.profitForMargin += row.grossProfit;
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .map(({ revenueForMargin, profitForMargin, ...group }) => ({
      ...group,
      marginPercent: revenueForMargin > 0 ? (profitForMargin / revenueForMargin) * 100 : null,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.grossProfit - a.grossProfit || a.name.localeCompare(b.name, "ru"));
}

function buildKpis(summary: WarehouseProductAnalytics["summary"]): WarehouseAnalyticsKpi[] {
  return [
    { key: "totalProducts", label: "Товаров всего", value: summary.totalProducts, format: "count", tone: "neutral" },
    { key: "activeProducts", label: "Активных", value: summary.activeProducts, format: "count", tone: "success" },
    { key: "productsWithStock", label: "С остатком", value: summary.productsWithStock, format: "count", tone: "info" },
    { key: "productsWithoutStock", label: "Без остатка", value: summary.productsWithoutStock, format: "count", tone: "neutral" },
    { key: "negativeStockProducts", label: "Минусовой остаток", value: summary.negativeStockProducts, format: "count", tone: summary.negativeStockProducts > 0 ? "danger" : "success" },
    { key: "neverSoldProducts", label: "Без продаж", value: summary.neverSoldProducts, format: "count", tone: "warning" },
    { key: "notSold90Days", label: "Не продавались 90+ дней", value: summary.notSold90Days, format: "count", tone: "warning" },
    { key: "frequentStockoutProducts", label: "Дефицит / ниже минимума", value: summary.frequentStockoutProducts, format: "count", tone: "danger" },
    { key: "stockCost", label: "Склад по себестоимости", value: summary.stockCost, format: "money", tone: "neutral" },
    { key: "stockSaleValue", label: "Склад по цене продажи", value: summary.stockSaleValue, format: "money", tone: "info" },
    { key: "potentialStockMargin", label: "Потенциальная маржа склада", value: summary.potentialStockMargin, format: "money", tone: "rust" },
    { key: "grossProfit", label: "Валовая прибыль за период", value: summary.grossProfit, format: "money", tone: "success" },
    { key: "averageMarginPercent", label: "Средняя маржинальность", value: summary.averageMarginPercent ?? 0, format: "percent", tone: "info" },
    { key: "productsWithoutBuyPrice", label: "Без закупочной цены", value: summary.productsWithoutBuyPrice, format: "count", tone: summary.productsWithoutBuyPrice > 0 ? "danger" : "success" },
    { key: "productsWithoutSalePrice", label: "Без цены продажи", value: summary.productsWithoutSalePrice, format: "count", tone: summary.productsWithoutSalePrice > 0 ? "danger" : "success" },
    { key: "productsWithoutCell", label: "Без ячейки", value: summary.productsWithoutCell, format: "count", tone: "warning" },
  ];
}

function tableRows(data: WarehouseProductAnalytics, table: WarehouseAnalyticsTable): WarehouseAnalyticsProductRow[] | WarehouseAnalyticsGroupRow[] | WarehouseAnalyticsQualityGroup[] | WarehouseAnalyticsMatrixCell[] {
  if (table === "top-products") return data.topProducts;
  if (table === "margins") return data.margins;
  if (table === "dead-stock") return data.deadStock;
  if (table === "never-sold") return data.neverSold;
  if (table === "stockouts") return data.stockouts;
  if (table === "abc-xyz") return data.abcXyz.rows;
  if (table === "replenishment") return data.replenishment;
  if (table === "new-location") return data.newLocation.rows;
  if (table === "categories") return data.categories;
  if (table === "brands") return data.brands;
  if (table === "suppliers") return data.suppliers;
  return data.cardQuality.groups;
}

export function getWarehouseAnalyticsTable(data: WarehouseProductAnalytics, table: WarehouseAnalyticsTable, params: WarehouseAnalyticsParams = {}) {
  const rows = tableRows(data, table);
  const offset = normalizeOffset(params.offset);
  const limit = normalizeLimit(params.limit);
  return {
    period: data.period,
    calculatedAt: data.calculatedAt,
    meta: { total: rows.length, limit, offset },
    rows: rows.slice(offset, offset + limit),
  };
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildWarehouseAnalyticsCsv(data: WarehouseProductAnalytics, table: WarehouseAnalyticsTable): string {
  const rows = tableRows(data, table);
  const headers = rows[0] ? Object.keys(rows[0]) : ["empty"];
  return [
    headers.map(csvCell).join(";"),
    ...rows.map((row) => headers.map((header) => csvCell((row as Record<string, unknown>)[header])).join(";")),
  ].join("\n");
}

export async function getWarehouseProductAnalytics(params: WarehouseAnalyticsParams = {}): Promise<WarehouseProductAnalytics> {
  const period = normalizeDateRange(params);
  const filters = {
    organizationId: normalizeId(params.organizationId),
    warehouseId: normalizeId(params.warehouseId),
    category: cleanText(params.category),
    brand: cleanText(params.brand),
    supplier: cleanText(params.supplier),
    entityType: cleanText(params.entityType),
    includeArchived: Boolean(params.includeArchived),
    onlyActive: Boolean(params.onlyActive),
    onlyWithStock: Boolean(params.onlyWithStock),
    onlyWithoutSales: Boolean(params.onlyWithoutSales),
    onlyProblems: Boolean(params.onlyProblems),
    onlyMarked: Boolean(params.onlyMarked),
    onlyBulkOil: Boolean(params.onlyBulkOil),
    onlyNegativeStock: Boolean(params.onlyNegativeStock),
    onlyZeroCost: Boolean(params.onlyZeroCost),
  };
  const cacheKey = JSON.stringify({ period, filters, productId: params.productId ?? "" });
  const now = Date.now();
  if (!params.refresh && analyticsCache.entry?.key === cacheKey && analyticsCache.entry.expiresAt > now) {
    return analyticsCache.entry.value;
  }

  const [organizations, storeOptions, optionProducts] = await Promise.all([
    prisma.localOrganization.findMany({ where: { isActive: true }, orderBy: [{ name: "asc" }], select: { id: true, name: true } }),
    prisma.localStore.findMany({ where: { archived: false }, orderBy: [{ name: "asc" }], select: { id: true, moyskladId: true, name: true, organizationId: true } }),
    prisma.localProduct.findMany({
      where: { entityType: { not: "service" } },
      select: { groupPath: true, brand: true, supplierName: true, supplierAttribute: true, entityType: true },
      take: 5000,
    }),
  ]);

  const warehouseFilter = filters.warehouseId;
  const scopedStores = storeOptions.filter((store) => {
    if (filters.organizationId && store.organizationId !== filters.organizationId) return false;
    if (warehouseFilter && store.id !== warehouseFilter && store.moyskladId !== warehouseFilter) return false;
    return true;
  });
  const hasScopeFilter = Boolean(filters.organizationId || filters.warehouseId);
  const scopedStoreIds = hasScopeFilter ? scopedStores.map((store) => store.id) : [];
  const stockBalanceWhere = hasScopeFilter ? { storeId: { in: scopedStoreIds } } : undefined;

  const productWhere: Prisma.LocalProductWhereInput = {
    ...(filters.includeArchived ? {} : { archived: false }),
    ...(filters.entityType ? { entityType: filters.entityType } : { entityType: { not: "service" } }),
    ...(filters.category ? { groupPath: { contains: filters.category, mode: "insensitive" } } : {}),
    ...(filters.brand ? { brand: { contains: filters.brand, mode: "insensitive" } } : {}),
    ...(filters.supplier
      ? {
          OR: [
            { supplierName: { contains: filters.supplier, mode: "insensitive" } },
            { supplierAttribute: { contains: filters.supplier, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(params.productId
      ? {
          OR: [
            { id: params.productId },
            { moyskladId: params.productId },
          ],
        }
      : {}),
  };

  const rawProducts = await prisma.localProduct.findMany({
    where: productWhere,
    include: {
      stockBalances: {
        where: stockBalanceWhere,
        orderBy: [{ syncedAt: "desc" }],
      },
    },
    orderBy: [{ name: "asc" }],
    take: params.productId ? 1 : 6000,
  });

  const productRows = rawProducts.filter((product) => {
    if (filters.onlyMarked && !isMarked(product)) return false;
    if (filters.onlyBulkOil && !isBulkOil(product)) return false;
    return true;
  });
  const productIds = productRows.map((product) => product.id);
  const bucketCount = Math.max(1, Math.ceil(period.days / 7));
  const metricMap = new Map<string, InternalMetric>();
  for (const product of productRows) metricMap.set(product.id, emptyMetric(product, bucketCount));

  const productIdWhere = productIds.length ? { productId: { in: productIds } } : { productId: "__none__" };
  const demandScope: Prisma.LocalDemandWhereInput = {
    applicable: true,
    ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
    ...(filters.warehouseId ? { storeId: { in: scopedStoreIds } } : {}),
  };
  const demandPeriodScope: Prisma.LocalDemandWhereInput = {
    ...demandScope,
    documentDate: { gte: period.dateFrom, lte: period.dateTo },
  };
  const inventoryScope: Prisma.LocalInventoryDocumentWhereInput = {
    applicable: true,
    ...(hasScopeFilter ? { storeId: { in: scopedStoreIds } } : {}),
  };
  const inventoryPeriodScope: Prisma.LocalInventoryDocumentWhereInput = {
    ...inventoryScope,
    documentDate: { gte: period.dateFrom, lte: period.dateTo },
  };

  const [sales, lifetimeSales, receipts, writeoffs] = await Promise.all([
    productIds.length
      ? prisma.localDemandPosition.findMany({
          where: {
            ...productIdWhere,
            assortmentType: { not: "service" },
            demand: { is: demandPeriodScope },
          },
          include: {
            demand: { select: { id: true, documentDate: true, momentAt: true, counterpartyId: true, agentMoyskladId: true } },
            product: { select: { buyPriceCents: true, entityType: true } },
          },
          orderBy: [{ demand: { momentAt: "desc" } }],
          take: 20_000,
        })
      : Promise.resolve([] as SalesPosition[]),
    productIds.length
      ? prisma.localDemandPosition.findMany({
          where: {
            ...productIdWhere,
            assortmentType: { not: "service" },
            demand: { is: demandScope },
          },
          include: { demand: { select: { documentDate: true, momentAt: true } } },
          orderBy: [{ demand: { momentAt: "desc" } }],
          take: 50_000,
        })
      : Promise.resolve([] as LifetimeSalePosition[]),
    productIds.length
      ? prisma.localInventoryDocumentPosition.findMany({
          where: {
            ...productIdWhere,
            document: { is: { ...inventoryScope, type: "receipt", isDeleted: false, status: { not: "cancelled" } } },
          },
          include: { document: { select: { type: true, documentDate: true, momentAt: true, affectsManagementProfit: true, adjustmentType: true } } },
          orderBy: [{ document: { momentAt: "desc" } }],
          take: 50_000,
        })
      : Promise.resolve([] as InventoryPosition[]),
    productIds.length
      ? prisma.localInventoryDocumentPosition.findMany({
          where: {
            ...productIdWhere,
            document: { is: { ...inventoryPeriodScope, type: "writeoff", isDeleted: false, status: { not: "cancelled" } } },
          },
          include: { document: { select: { type: true, documentDate: true, momentAt: true, affectsManagementProfit: true, adjustmentType: true } } },
          orderBy: [{ document: { momentAt: "desc" } }],
          take: 20_000,
        })
      : Promise.resolve([] as InventoryPosition[]),
  ]);

  for (const position of lifetimeSales) {
    if (!position.productId || isServiceEntity(position.assortmentType)) continue;
    const metric = metricMap.get(position.productId);
    if (!metric) continue;
    metric.lifetimeSalesCount += 1;
    metric.lifetimeSoldQuantity += decimalToNumber(position.quantity);
    metric.lastSaleDate = updateLastDate(metric.lastSaleDate, position.demand.documentDate);
  }

  for (const position of sales) {
    if (!position.productId || isServiceEntity(position.assortmentType) || isServiceEntity(position.product?.entityType)) continue;
    const metric = metricMap.get(position.productId);
    if (!metric) continue;
    const quantity = decimalToNumber(position.quantity);
    const revenueCents = lineRevenueCents(position);
    const costPerUnit = position.buyPriceCentsPerUnit ?? position.product?.buyPriceCents ?? null;
    const costCents = lineCostCents(quantity, costPerUnit);
    const profitCents = costCents == null ? null : revenueCents - costCents;
    metric.soldQuantity += quantity;
    metric.salesCount += 1;
    metric.salesDocuments.add(position.demand.id);
    if (position.demand.counterpartyId || position.demand.agentMoyskladId) {
      metric.clients.add(position.demand.counterpartyId ?? position.demand.agentMoyskladId ?? "");
    }
    metric.revenueCents += revenueCents;
    if (costCents == null || profitCents == null) {
      metric.qualityProblems.push("продажа без себестоимости");
    } else {
      metric.costCents += costCents;
      metric.profitCents += profitCents;
      metric.knownCostRevenueCents += revenueCents;
    }
    metric.discountSum += decimalToNumber(position.discount);
    metric.discountRows += 1;
    metric.lastSaleDate = updateLastDate(metric.lastSaleDate, position.demand.documentDate);
    metric.salesBuckets[bucketIndex(position.demand.documentDate, period.dateFrom, bucketCount)] += quantity;
  }

  for (const position of receipts) {
    if (!position.productId) continue;
    const metric = metricMap.get(position.productId);
    if (!metric) continue;
    const quantity = decimalToNumber(position.quantity);
    metric.receivedQuantity += position.document.documentDate >= period.dateFrom && position.document.documentDate <= period.dateTo ? quantity : 0;
    metric.lastReceiptDate = updateLastDate(metric.lastReceiptDate, position.document.documentDate);
    metric.firstReceiptDate = updateFirstDate(metric.firstReceiptDate, position.document.documentDate);
  }

  for (const position of writeoffs) {
    if (!position.productId) continue;
    const metric = metricMap.get(position.productId);
    if (!metric) continue;
    if (position.document.affectsManagementProfit === false || position.document.adjustmentType === "technical") continue;
    metric.writeoffQuantity += decimalToNumber(position.quantity);
  }

  const metrics = [...metricMap.values()];
  finalizeMetrics(metrics, period);
  const filteredMetrics = metrics.filter((row) => productPassesPostFilters(row, filters, hasScopeFilter));

  const totalRevenueForMargin = filteredMetrics.reduce((sum, row) => sum + (row.grossProfit == null ? 0 : row.revenue), 0);
  const totalProfitForMargin = filteredMetrics.reduce((sum, row) => sum + (row.grossProfit ?? 0), 0);
  const summary = {
    totalProducts: filteredMetrics.length,
    activeProducts: filteredMetrics.filter((row) => !row.archived).length,
    productsWithStock: filteredMetrics.filter((row) => row.currentStock > 0).length,
    productsWithoutStock: filteredMetrics.filter((row) => row.currentStock <= 0).length,
    negativeStockProducts: filteredMetrics.filter((row) => row.currentStock < 0 || row.available < 0).length,
    productsWithoutCategory: filteredMetrics.filter((row) => !row.category).length,
    productsWithoutBuyPrice: filteredMetrics.filter((row) => row.buyPrice == null || row.buyPrice <= 0).length,
    productsWithoutSalePrice: filteredMetrics.filter((row) => row.salePrice <= 0).length,
    productsWithoutSupplier: filteredMetrics.filter((row) => !cleanText(row.supplier)).length,
    productsWithoutCell: filteredMetrics.filter((row) => row.currentStock > 0 && !cleanText(row.cell)).length,
    neverSoldProducts: filteredMetrics.filter((row) => row.lifetimeSalesCount === 0).length,
    notSold30Days: filteredMetrics.filter((row) => (row.daysWithoutSale ?? 9999) >= 30 || row.lifetimeSalesCount === 0).length,
    notSold90Days: filteredMetrics.filter((row) => (row.daysWithoutSale ?? 9999) >= 90 || row.lifetimeSalesCount === 0).length,
    highMarginProducts: filteredMetrics.filter((row) => row.marginPercent != null && row.marginPercent >= 35).length,
    lowMarginProducts: filteredMetrics.filter((row) => row.revenue > 0 && row.marginPercent != null && row.marginPercent < 12).length,
    frequentStockoutProducts: filteredMetrics.filter((row) => Boolean(row.stockoutStatus)).length,
    stockCost: filteredMetrics.reduce((sum, row) => sum + row.stockCost, 0),
    stockSaleValue: filteredMetrics.reduce((sum, row) => sum + row.stockSaleValue, 0),
    potentialStockMargin: filteredMetrics.reduce((sum, row) => sum + row.potentialStockMargin, 0),
    grossProfit: totalProfitForMargin,
    averageMarginPercent: totalRevenueForMargin > 0 ? (totalProfitForMargin / totalRevenueForMargin) * 100 : null,
    salesRevenue: filteredMetrics.reduce((sum, row) => sum + row.revenue, 0),
    soldQuantity: filteredMetrics.reduce((sum, row) => sum + row.soldQuantity, 0),
  };

  const topByRevenue = sortByNumber(filteredMetrics, (row) => row.revenue);
  const topByProfit = sortByNumber(filteredMetrics, (row) => row.grossProfit ?? -999_999_999);
  const topByQuantity = sortByNumber(filteredMetrics, (row) => row.soldQuantity);
  const marginRows = [
    ...sortByNumber(filteredMetrics.filter((row) => row.revenue > 0), (row) => row.grossProfit ?? -999_999_999),
  ];
  const deadStockRows = sortByNumber(filteredMetrics.filter((row) => Boolean(row.deadStockStatus)), (row) => row.stockCost);
  const neverSoldRows = sortByNumber(filteredMetrics.filter((row) => row.lifetimeSalesCount === 0), (row) => row.stockCost);
  const stockoutRows = sortByNumber(filteredMetrics.filter((row) => Boolean(row.stockoutStatus)), (row) => row.recommendedOrderQuantity || row.shortage || row.revenue);
  const cardProblemRows = sortByNumber(filteredMetrics.filter((row) => row.qualityProblems.length > 0), (row) => row.qualityProblems.length);
  const abcRows = sortByNumber(filteredMetrics.filter((row) => row.revenue > 0 || row.currentStock > 0), (row) => row.revenue);
  const replenishmentRows = sortByNumber(
    filteredMetrics.filter((row) => row.recommendedOrderQuantity > 0 || row.stockoutStatus || (row.soldQuantity > 0 && row.minimumBalance == null)),
    (row) => row.recommendedOrderQuantity || row.shortage || row.soldQuantity
  );
  const newLocationRows = sortByNumber(
    filteredMetrics.filter((row) => row.soldQuantity > 0 || row.grossProfit != null).filter((row) => row.abcRevenue !== "C" || row.xyz !== "Z"),
    (row) => row.revenue + (row.grossProfit ?? 0) * 2
  ).slice(0, 120);

  const publicTopByRevenue = topByRevenue.slice(0, 200).map(productToPublic);
  const publicTopByProfit = topByProfit.slice(0, 200).map(productToPublic);
  const publicTopByQuantity = topByQuantity.slice(0, 200).map(productToPublic);
  const publicDeadStock = deadStockRows.slice(0, 200).map(productToPublic);
  const publicNeverSold = neverSoldRows.slice(0, 200).map(productToPublic);
  const publicStockouts = stockoutRows.slice(0, 200).map(productToPublic);
  const publicCardProblems = cardProblemRows.slice(0, 200).map(productToPublic);
  const publicAbcRows = abcRows.slice(0, 300).map(productToPublic);
  const publicReplenishment = replenishmentRows.slice(0, 200).map(productToPublic);
  const publicNewLocation = newLocationRows.map(productToPublic);

  const newLocationBase = newLocationRows.filter((row) => row.abcRevenue === "A" || (row.abcRevenue === "B" && row.xyz === "X"));
  const newLocationExtended = newLocationRows.filter((row) => !newLocationBase.includes(row) && (row.grossProfit ?? 0) > 0);
  const newLocationPreorder = newLocationRows.filter((row) => row.abcRevenue === "C" || row.xyz === "Z");
  const newLocationCategories = new Set(newLocationRows.map((row) => row.category).filter(Boolean));
  const newLocationSuppliers = new Set(newLocationRows.map((row) => row.supplier).filter(Boolean));

  const data: WarehouseProductAnalytics = {
    period,
    calculatedAt: new Date().toISOString(),
    cacheTtlSeconds: ANALYTICS_CACHE_MS / 1000,
    filters,
    options: {
      organizations: organizations.map((organization) => ({ id: organization.id, name: organization.name })),
      warehouses: storeOptions.map((store) => ({ id: store.id, name: store.name })),
      categories: buildOptions(optionProducts.map((product) => categoryLabel(product.groupPath))),
      brands: buildOptions(optionProducts.map((product) => product.brand)),
      suppliers: buildOptions(optionProducts.map((product) => product.supplierName ?? product.supplierAttribute)),
      entityTypes: buildOptions(optionProducts.map((product) => product.entityType)),
    },
    summary,
    kpis: buildKpis(summary),
    overview: {
      topRevenue: publicTopByRevenue.slice(0, 10),
      topProfit: publicTopByProfit.slice(0, 10),
      topQuantity: publicTopByQuantity.slice(0, 10),
      deadStock: publicDeadStock.slice(0, 10),
      cardProblems: publicCardProblems.slice(0, 10),
      stockouts: publicStockouts.slice(0, 10),
    },
    topProducts: publicTopByQuantity,
    margins: marginRows.slice(0, 240).map(productToPublic),
    deadStock: publicDeadStock,
    neverSold: publicNeverSold,
    stockouts: publicStockouts,
    cardQuality: {
      groups: qualityGroups(filteredMetrics),
      products: publicCardProblems,
    },
    abcXyz: {
      rows: publicAbcRows,
      matrix: buildMatrix(filteredMetrics),
    },
    replenishment: publicReplenishment,
    newLocation: {
      rows: publicNewLocation,
      summary: {
        baseProducts: newLocationBase.length,
        extendedProducts: newLocationExtended.length,
        preorderProducts: newLocationPreorder.length,
        baseCost: newLocationBase.reduce((sum, row) => sum + row.recommendedMin * (row.buyPrice ?? 0), 0),
        extendedCost: newLocationExtended.reduce((sum, row) => sum + row.recommendedMin * (row.buyPrice ?? 0), 0),
        expectedMargin: newLocationRows.reduce((sum, row) => sum + row.recommendedMin * Math.max(0, row.salePrice - (row.buyPrice ?? 0)), 0),
        categoriesCount: newLocationCategories.size,
        suppliersCount: newLocationSuppliers.size,
      },
    },
    categories: groupRows(filteredMetrics, (row) => row.category),
    brands: groupRows(filteredMetrics, (row) => row.brand),
    suppliers: groupRows(filteredMetrics, (row) => row.supplier),
  };

  analyticsCache.entry = { key: cacheKey, expiresAt: now + ANALYTICS_CACHE_MS, value: data };
  return data;
}
