import { prisma } from "@/lib/db";

type FinanceParams = {
  dateFrom?: string;
  dateTo?: string;
};

type MoneyRow = {
  id: string;
  documentName: string;
  documentDate: string;
  type: "sale" | "receipt" | "writeoff";
  productName: string;
  quantity: number;
  revenue: number;
  cost: number | null;
  profit: number | null;
  marginPercent: number | null;
  costSource: string;
};

export type LocalInventoryFinanceResult = {
  period: { dateFrom: string; dateTo: string };
  formulas: string[];
  summary: {
    demandsCount: number;
    receiptsCount: number;
    writeoffsCount: number;
    salesRevenue: number | null;
    knownSalesRevenue: number | null;
    salesCost: number | null;
    grossProfit: number | null;
    grossMarginPercent: number | null;
    receiptValue: number | null;
    writeoffLoss: number | null;
    operationalProfit: number | null;
    missingCostRevenue: number | null;
    missingCostLines: number;
  };
  topProducts: {
    productName: string;
    quantity: number;
    revenue: number | null;
    cost: number | null;
    profit: number | null;
    marginPercent: number | null;
    missingCostLines: number;
  }[];
  rows: MoneyRow[];
};

type FinanceCacheEntry = { key: string; expiresAt: number; value: LocalInventoryFinanceResult };
const FINANCE_CACHE_MS = 60_000;
const financeCache = ((globalThis as typeof globalThis & {
  __localInventoryFinanceCache?: { entry: FinanceCacheEntry | null };
}).__localInventoryFinanceCache ??= { entry: null });

export function invalidateLocalInventoryFinanceCache() {
  financeCache.entry = null;
}

function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return {
    dateFrom: `${year}-${month}-01`,
    dateTo: `${year}-${month}-${day}`,
  };
}

function normalizeDate(value: string | undefined, fallback: string): string {
  const raw = value?.trim();
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : fallback;
}

function decimalToNumber(value: { toNumber(): number } | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : value.toNumber();
}

function lineRevenueCents(position: { quantity: { toNumber(): number } | number; priceCentsPerUnit: number; discount?: { toNumber(): number } | number | null }) {
  const quantity = decimalToNumber(position.quantity);
  const discount = decimalToNumber(position.discount);
  return Math.round(quantity * position.priceCentsPerUnit * (1 - discount / 100));
}

function lineCostCents(quantity: number, costPerUnit: number | null | undefined): number | null {
  return costPerUnit == null ? null : Math.round(quantity * costPerUnit);
}

function marginPercent(revenue: number, profit: number | null): number | null {
  if (profit == null || revenue <= 0) return null;
  return (profit / revenue) * 100;
}

function rub(cents: number | null): number | null {
  return cents == null ? null : cents / 100;
}

function isService(type: string): boolean {
  return type === "service";
}

function addTopProduct(
  map: Map<string, { productName: string; quantity: number; revenueCents: number; costCents: number; profitCents: number; missingCostLines: number }>,
  key: string,
  productName: string,
  quantity: number,
  revenueCents: number,
  costCents: number | null,
  profitCents: number | null
) {
  const current = map.get(key) ?? {
    productName,
    quantity: 0,
    revenueCents: 0,
    costCents: 0,
    profitCents: 0,
    missingCostLines: 0,
  };
  current.quantity += quantity;
  current.revenueCents += revenueCents;
  if (costCents == null || profitCents == null) {
    current.missingCostLines += 1;
  } else {
    current.costCents += costCents;
    current.profitCents += profitCents;
  }
  map.set(key, current);
}

export async function getLocalInventoryFinance(params: FinanceParams = {}): Promise<LocalInventoryFinanceResult> {
  const defaults = defaultDateRange();
  const dateFrom = normalizeDate(params.dateFrom, defaults.dateFrom);
  const dateTo = normalizeDate(params.dateTo, defaults.dateTo);
  const cacheKey = JSON.stringify({ dateFrom, dateTo });
  const now = Date.now();
  if (financeCache.entry?.key === cacheKey && financeCache.entry.expiresAt > now) {
    return financeCache.entry.value;
  }

  const [demands, documents] = await Promise.all([
    prisma.localDemand.findMany({
      where: {
        applicable: true,
        documentDate: { gte: dateFrom, lte: dateTo },
      },
      include: {
        counterparty: true,
        store: true,
        positions: { include: { product: true }, orderBy: { id: "asc" } },
      },
      orderBy: [{ momentAt: "desc" }],
    }),
    prisma.localInventoryDocument.findMany({
      where: {
        applicable: true,
        documentDate: { gte: dateFrom, lte: dateTo },
        type: { in: ["receipt", "writeoff"] },
      },
      include: {
        counterparty: true,
        store: true,
        positions: { include: { product: true }, orderBy: { id: "asc" } },
      },
      orderBy: [{ momentAt: "desc" }],
    }),
  ]);

  let salesRevenueCents = 0;
  let knownSalesRevenueCents = 0;
  let salesCostCents = 0;
  let salesProfitCents = 0;
  let missingCostRevenueCents = 0;
  let missingCostLines = 0;
  let receiptValueCents = 0;
  let writeoffLossCents = 0;
  const rows: MoneyRow[] = [];
  const topProducts = new Map<string, { productName: string; quantity: number; revenueCents: number; costCents: number; profitCents: number; missingCostLines: number }>();

  for (const demand of demands) {
    for (const position of demand.positions) {
      const quantity = decimalToNumber(position.quantity);
      const revenueCents = lineRevenueCents(position);
      const fallbackCost = position.product?.buyPriceCents ?? null;
      const costPerUnit = position.buyPriceCentsPerUnit ?? (isService(position.assortmentType) ? 0 : fallbackCost);
      const costSource = position.buyPriceCentsPerUnit != null
        ? "себестоимость в отгрузке"
        : isService(position.assortmentType)
          ? "услуга без себестоимости"
          : fallbackCost != null
            ? "текущая закупочная цена товара"
            : "нет себестоимости";
      const costCents = lineCostCents(quantity, costPerUnit);
      const profitCents = costCents == null ? null : revenueCents - costCents;

      salesRevenueCents += revenueCents;
      if (costCents == null || profitCents == null) {
        missingCostRevenueCents += revenueCents;
        missingCostLines += 1;
      } else {
        knownSalesRevenueCents += revenueCents;
        salesCostCents += costCents;
        salesProfitCents += profitCents;
      }

      const productName = position.product?.name ?? position.name;
      addTopProduct(
        topProducts,
        position.productId ?? position.assortmentMoyskladId ?? position.name,
        productName,
        quantity,
        revenueCents,
        costCents,
        profitCents
      );
      rows.push({
        id: position.id,
        documentName: demand.name,
        documentDate: demand.documentDate,
        type: "sale",
        productName,
        quantity,
        revenue: rub(revenueCents) ?? 0,
        cost: rub(costCents),
        profit: rub(profitCents),
        marginPercent: marginPercent(revenueCents, profitCents),
        costSource,
      });
    }
  }

  for (const document of documents) {
    for (const position of document.positions) {
      const quantity = decimalToNumber(position.quantity);
      const lineValueCents = Math.round(quantity * position.priceCentsPerUnit);
      if (document.type === "receipt") {
        receiptValueCents += lineValueCents;
      } else if (document.type === "writeoff") {
        const costPerUnit = position.priceCentsPerUnit > 0 ? position.priceCentsPerUnit : position.product?.buyPriceCents ?? null;
        const lossCents = lineCostCents(quantity, costPerUnit) ?? 0;
        writeoffLossCents += lossCents;
        rows.push({
          id: position.id,
          documentName: document.name,
          documentDate: document.documentDate,
          type: "writeoff",
          productName: position.product?.name ?? position.productName,
          quantity,
          revenue: 0,
          cost: rub(lossCents),
          profit: rub(-lossCents),
          marginPercent: null,
          costSource: position.priceCentsPerUnit > 0 ? "цена учёта в списании" : "текущая закупочная цена товара",
        });
      }
    }
  }

  const operationalProfitCents = salesProfitCents - writeoffLossCents;

  const result: LocalInventoryFinanceResult = {
    period: { dateFrom, dateTo },
    formulas: [
      "Выручка строки = Количество × Цена продажи × (1 - Скидка / 100)",
      "Себестоимость строки = Количество × Закупочная цена, сохранённая в отгрузке; если её нет, берётся текущая закупочная цена товара",
      "Валовая прибыль = Выручка с известной себестоимостью - Себестоимость продаж",
      "Операционная прибыль склада = Валовая прибыль - Потери от списаний",
      "Приёмка увеличивает остаток и обновляет закупочную цену товара, но не создаёт прибыль",
    ],
    summary: {
      demandsCount: demands.length,
      receiptsCount: documents.filter((document) => document.type === "receipt").length,
      writeoffsCount: documents.filter((document) => document.type === "writeoff").length,
      salesRevenue: rub(salesRevenueCents),
      knownSalesRevenue: rub(knownSalesRevenueCents),
      salesCost: rub(salesCostCents),
      grossProfit: rub(salesProfitCents),
      grossMarginPercent: marginPercent(knownSalesRevenueCents, salesProfitCents),
      receiptValue: rub(receiptValueCents),
      writeoffLoss: rub(writeoffLossCents),
      operationalProfit: rub(operationalProfitCents),
      missingCostRevenue: rub(missingCostRevenueCents),
      missingCostLines,
    },
    topProducts: [...topProducts.values()]
      .sort((a, b) => b.profitCents - a.profitCents)
      .slice(0, 20)
      .map((row) => ({
        productName: row.productName,
        quantity: row.quantity,
        revenue: rub(row.revenueCents),
        cost: rub(row.costCents),
        profit: rub(row.profitCents),
        marginPercent: marginPercent(row.revenueCents, row.profitCents),
        missingCostLines: row.missingCostLines,
      })),
    rows: rows
      .sort((a, b) => b.documentDate.localeCompare(a.documentDate))
      .slice(0, 300),
  };
  financeCache.entry = { key: cacheKey, expiresAt: now + FINANCE_CACHE_MS, value: result };
  return result;
}
