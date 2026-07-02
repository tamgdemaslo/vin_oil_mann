import { prisma } from "@/lib/db";

type DocumentTypeFilter = "all" | "sale" | "receipt" | "writeoff";

type FinanceParams = {
  dateFrom?: string;
  dateTo?: string;
  organizationId?: string;
  storeId?: string;
  documentType?: string;
  applicableOnly?: boolean;
  includeWriteoffs?: boolean;
};

type FinanceRowStatus =
  | "ok"
  | "missing_cost"
  | "zero_price"
  | "full_discount"
  | "negative_margin"
  | "receipt"
  | "writeoff"
  | "technical_adjustment"
  | "writeoff_no_reason";

type MoneyRow = {
  id: string;
  documentId: string;
  documentName: string;
  documentDate: string;
  documentHref: string;
  applicable: boolean;
  type: "sale" | "receipt" | "writeoff";
  productId: string | null;
  productName: string;
  productArticle: string | null;
  productBrand: string | null;
  productCategory: string | null;
  storeId: string | null;
  storeName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  counterpartyName: string | null;
  quantity: number;
  unitSalePrice: number | null;
  revenue: number;
  cost: number | null;
  discountPercent: number | null;
  profit: number | null;
  marginPercent: number | null;
  currentBuyPrice: number | null;
  costSource: string;
  status: FinanceRowStatus;
  createdByName: string | null;
  writeoffReason: string | null;
  adjustmentType: string | null;
  affectsManagementProfit: boolean;
};

type FinanceIssue = {
  id: string;
  type:
    | "missing_cost"
    | "no_buy_price"
    | "zero_price"
    | "full_discount"
    | "negative_margin"
    | "writeoff_no_reason"
    | "purchase_price_variance";
  severity: "warning" | "danger";
  title: string;
  description: string;
  productId: string | null;
  productName: string | null;
  documentId: string | null;
  documentName: string | null;
  documentHref: string | null;
  date: string | null;
  amount: number | null;
};

type DailyFinance = {
  date: string;
  revenue: number;
  cost: number;
  profit: number;
  marginPercent: number | null;
  writeoffLoss: number;
  operationalProfit: number;
};

type ProductSnapshot = {
  id: string;
  name: string;
  article: string | null;
  code: string | null;
  brand: string | null;
  groupPath: string | null;
  buyPriceCents: number | null;
};

export type LocalInventoryFinanceResult = {
  period: { dateFrom: string; dateTo: string };
  calculatedAt: string;
  formulas: string[];
  summary: {
    demandsCount: number;
    receiptsCount: number;
    writeoffsCount: number;
    documentsCount: number;
    processedLines: number;
    salesRevenue: number | null;
    knownSalesRevenue: number | null;
    salesCost: number | null;
    grossProfit: number | null;
    grossMarginPercent: number | null;
    receiptValue: number | null;
    writeoffLoss: number | null;
    technicalAdjustmentValue: number | null;
    technicalAdjustmentQuantity: number;
    technicalAdjustmentsCount: number;
    expenseWriteoffsCount: number;
    operationalProfit: number | null;
    missingCostRevenue: number | null;
    missingCostLines: number;
  };
  topProducts: {
    productId: string | null;
    productName: string;
    productArticle: string | null;
    productBrand: string | null;
    productCategory: string | null;
    quantity: number;
    revenue: number | null;
    cost: number | null;
    profit: number | null;
    marginPercent: number | null;
    documentsCount: number;
    rowsCount: number;
    missingCostLines: number;
    writeoffLoss: number | null;
  }[];
  daily: DailyFinance[];
  issues: FinanceIssue[];
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

function normalizeId(value: string | undefined): string | undefined {
  const raw = value?.trim();
  return raw || undefined;
}

function normalizeDocumentType(value: string | undefined): DocumentTypeFilter {
  if (value === "sale" || value === "receipt" || value === "writeoff") return value;
  return "all";
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

function categoryLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.split(/[>/]/).map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? value;
}

function productMeta(product: ProductSnapshot | null | undefined, fallbackName: string) {
  return {
    productId: product?.id ?? null,
    productName: product?.name ?? fallbackName,
    productArticle: product?.article ?? product?.code ?? null,
    productBrand: product?.brand ?? null,
    productCategory: categoryLabel(product?.groupPath),
    currentBuyPrice: rub(product?.buyPriceCents ?? null),
  };
}

function documentHref(type: "sale" | "receipt" | "writeoff", documentId: string, applicable: boolean) {
  if (type === "sale") return applicable ? `/shipment/${documentId}` : `/shipment/${documentId}/edit`;
  const path = type === "receipt" ? "/inventory/receipts" : "/inventory/writeoffs";
  return `${path}?document=${encodeURIComponent(documentId)}&open=edit`;
}

function addTopProduct(
  map: Map<string, {
    productId: string | null;
    productName: string;
    productArticle: string | null;
    productBrand: string | null;
    productCategory: string | null;
    quantity: number;
    revenueCents: number;
    costCents: number;
    profitCents: number;
    missingCostLines: number;
    rowsCount: number;
    documents: Set<string>;
    writeoffLossCents: number;
  }>,
  key: string,
  product: ReturnType<typeof productMeta>,
  documentId: string,
  quantity: number,
  revenueCents: number,
  costCents: number | null,
  profitCents: number | null
) {
  const current = map.get(key) ?? {
    productId: product.productId,
    productName: product.productName,
    productArticle: product.productArticle,
    productBrand: product.productBrand,
    productCategory: product.productCategory,
    quantity: 0,
    revenueCents: 0,
    costCents: 0,
    profitCents: 0,
    missingCostLines: 0,
    rowsCount: 0,
    documents: new Set<string>(),
    writeoffLossCents: 0,
  };
  current.quantity += quantity;
  current.revenueCents += revenueCents;
  current.rowsCount += 1;
  current.documents.add(documentId);
  if (costCents == null || profitCents == null) {
    current.missingCostLines += 1;
  } else {
    current.costCents += costCents;
    current.profitCents += profitCents;
  }
  map.set(key, current);
}

function addDaily(
  map: Map<string, { revenueCents: number; knownRevenueCents: number; costCents: number; profitCents: number; writeoffLossCents: number }>,
  date: string,
  patch: Partial<{ revenueCents: number; knownRevenueCents: number; costCents: number; profitCents: number; writeoffLossCents: number }>
) {
  const current = map.get(date) ?? {
    revenueCents: 0,
    knownRevenueCents: 0,
    costCents: 0,
    profitCents: 0,
    writeoffLossCents: 0,
  };
  current.revenueCents += patch.revenueCents ?? 0;
  current.knownRevenueCents += patch.knownRevenueCents ?? 0;
  current.costCents += patch.costCents ?? 0;
  current.profitCents += patch.profitCents ?? 0;
  current.writeoffLossCents += patch.writeoffLossCents ?? 0;
  map.set(date, current);
}

function addIssue(issues: FinanceIssue[], issue: FinanceIssue) {
  issues.push(issue);
}

export async function getLocalInventoryFinance(params: FinanceParams = {}): Promise<LocalInventoryFinanceResult> {
  const defaults = defaultDateRange();
  const dateFrom = normalizeDate(params.dateFrom, defaults.dateFrom);
  const dateTo = normalizeDate(params.dateTo, defaults.dateTo);
  const organizationId = normalizeId(params.organizationId);
  const storeId = normalizeId(params.storeId);
  const documentType = normalizeDocumentType(params.documentType);
  const applicableOnly = params.applicableOnly !== false;
  const includeWriteoffs = params.includeWriteoffs !== false;
  const cacheKey = JSON.stringify({ dateFrom, dateTo, organizationId, storeId, documentType, applicableOnly, includeWriteoffs });
  const now = Date.now();
  if (financeCache.entry?.key === cacheKey && financeCache.entry.expiresAt > now) {
    return financeCache.entry.value;
  }

  const loadSales = documentType === "all" || documentType === "sale";
  const loadReceipts = documentType === "all" || documentType === "receipt";
  const loadWriteoffs = includeWriteoffs && (documentType === "all" || documentType === "writeoff");

  const demandWhere = {
    ...(applicableOnly ? { applicable: true } : {}),
    documentDate: { gte: dateFrom, lte: dateTo },
    ...(organizationId ? { organizationId } : {}),
    ...(storeId ? { storeId } : {}),
  };
  const documentTypes = [
    ...(loadReceipts ? ["receipt"] : []),
    ...(loadWriteoffs ? ["writeoff"] : []),
  ];
  const inventoryWhere = {
    ...(applicableOnly ? { applicable: true } : {}),
    documentDate: { gte: dateFrom, lte: dateTo },
    type: { in: documentTypes.length ? documentTypes : ["__none__"] },
    ...(storeId ? { storeId } : {}),
  };

  const [demands, documents] = await Promise.all([
    loadSales
      ? prisma.localDemand.findMany({
          where: demandWhere,
          include: {
            counterparty: true,
            store: true,
            organization: true,
            positions: { include: { product: true }, orderBy: { id: "asc" } },
          },
          orderBy: [{ momentAt: "desc" }],
        })
      : Promise.resolve([]),
    documentTypes.length
      ? prisma.localInventoryDocument.findMany({
          where: inventoryWhere,
          include: {
            counterparty: true,
            store: true,
            positions: { include: { product: true }, orderBy: { id: "asc" } },
          },
          orderBy: [{ momentAt: "desc" }],
        })
      : Promise.resolve([]),
  ]);

  let salesRevenueCents = 0;
  let knownSalesRevenueCents = 0;
  let salesCostCents = 0;
  let salesProfitCents = 0;
  let missingCostRevenueCents = 0;
  let missingCostLines = 0;
  let receiptValueCents = 0;
  let writeoffLossCents = 0;
  let technicalAdjustmentValueCents = 0;
  let technicalAdjustmentQuantity = 0;
  let processedLines = 0;
  const rows: MoneyRow[] = [];
  const issues: FinanceIssue[] = [];
  const topProducts = new Map<string, {
    productId: string | null;
    productName: string;
    productArticle: string | null;
    productBrand: string | null;
    productCategory: string | null;
    quantity: number;
    revenueCents: number;
    costCents: number;
    profitCents: number;
    missingCostLines: number;
    rowsCount: number;
    documents: Set<string>;
    writeoffLossCents: number;
  }>();
  const daily = new Map<string, { revenueCents: number; knownRevenueCents: number; costCents: number; profitCents: number; writeoffLossCents: number }>();
  const receiptPricesByProduct = new Map<string, { productName: string; prices: number[] }>();

  for (const demand of demands) {
    for (const position of demand.positions) {
      processedLines += 1;
      const quantity = decimalToNumber(position.quantity);
      const revenueCents = lineRevenueCents(position);
      const discountPercent = decimalToNumber(position.discount);
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
      const product = productMeta(position.product, position.name);
      const href = documentHref("sale", demand.id, demand.applicable);
      const status: FinanceRowStatus =
        costCents == null
          ? "missing_cost"
          : position.priceCentsPerUnit <= 0
            ? "zero_price"
            : discountPercent >= 100
              ? "full_discount"
              : profitCents != null && profitCents < 0
                ? "negative_margin"
                : "ok";

      salesRevenueCents += revenueCents;
      if (costCents == null || profitCents == null) {
        missingCostRevenueCents += revenueCents;
        missingCostLines += 1;
      } else {
        knownSalesRevenueCents += revenueCents;
        salesCostCents += costCents;
        salesProfitCents += profitCents;
      }

      addDaily(daily, demand.documentDate, {
        revenueCents,
        knownRevenueCents: costCents == null ? 0 : revenueCents,
        costCents: costCents ?? 0,
        profitCents: profitCents ?? 0,
      });
      addTopProduct(
        topProducts,
        product.productId ?? position.assortmentMoyskladId ?? position.name,
        product,
        demand.id,
        quantity,
        revenueCents,
        costCents,
        profitCents
      );

      const row: MoneyRow = {
        id: `sale:${position.id}`,
        documentId: demand.id,
        documentName: demand.name,
        documentDate: demand.documentDate,
        documentHref: href,
        applicable: demand.applicable,
        type: "sale",
        productId: product.productId,
        productName: product.productName,
        productArticle: product.productArticle,
        productBrand: product.productBrand,
        productCategory: product.productCategory,
        storeId: demand.storeId,
        storeName: demand.store?.name ?? demand.storeNameSnapshot,
        organizationId: demand.organizationId,
        organizationName: demand.organization?.name ?? demand.organizationName,
        counterpartyName: demand.counterparty?.name ?? demand.agentNameSnapshot,
        quantity,
        unitSalePrice: rub(position.priceCentsPerUnit),
        revenue: rub(revenueCents) ?? 0,
        cost: rub(costCents),
        discountPercent,
        profit: rub(profitCents),
        marginPercent: marginPercent(revenueCents, profitCents),
        currentBuyPrice: product.currentBuyPrice,
        costSource,
        status,
        createdByName: null,
        writeoffReason: null,
        adjustmentType: null,
        affectsManagementProfit: true,
      };
      rows.push(row);

      if (costCents == null) {
        addIssue(issues, {
          id: `missing-cost:${position.id}`,
          type: fallbackCost == null ? "no_buy_price" : "missing_cost",
          severity: "warning",
          title: fallbackCost == null ? "Товар без закупочной цены" : "Строка без себестоимости",
          description: "Прибыль по строке не попала в валовую прибыль, пока не будет указана себестоимость.",
          productId: product.productId,
          productName: product.productName,
          documentId: demand.id,
          documentName: demand.name,
          documentHref: href,
          date: demand.documentDate,
          amount: rub(revenueCents),
        });
      }
      if (position.priceCentsPerUnit <= 0) {
        addIssue(issues, {
          id: `zero-price:${position.id}`,
          type: "zero_price",
          severity: "danger",
          title: "Нулевая цена продажи",
          description: "Документ влияет на остатки, но не создаёт выручку. Проверьте цену строки.",
          productId: product.productId,
          productName: product.productName,
          documentId: demand.id,
          documentName: demand.name,
          documentHref: href,
          date: demand.documentDate,
          amount: 0,
        });
      }
      if (discountPercent >= 100) {
        addIssue(issues, {
          id: `full-discount:${position.id}`,
          type: "full_discount",
          severity: "warning",
          title: "Скидка 100%",
          description: "Строка полностью обнулена скидкой. Проверьте, не является ли это ошибкой.",
          productId: product.productId,
          productName: product.productName,
          documentId: demand.id,
          documentName: demand.name,
          documentHref: href,
          date: demand.documentDate,
          amount: rub(revenueCents),
        });
      }
      if (profitCents != null && profitCents < 0) {
        addIssue(issues, {
          id: `negative-margin:${position.id}`,
          type: "negative_margin",
          severity: "danger",
          title: "Отрицательная маржа",
          description: "Себестоимость выше выручки по строке. Проверьте цену продажи, скидку или закупочную цену.",
          productId: product.productId,
          productName: product.productName,
          documentId: demand.id,
          documentName: demand.name,
          documentHref: href,
          date: demand.documentDate,
          amount: rub(profitCents),
        });
      }
    }
  }

  for (const document of documents) {
    for (const position of document.positions) {
      processedLines += 1;
      const quantity = decimalToNumber(position.quantity);
      const lineValueCents = Math.round(quantity * position.priceCentsPerUnit);
      const product = productMeta(position.product, position.productName);
      const type = document.type === "receipt" ? "receipt" : "writeoff";
      const href = documentHref(type, document.id, document.applicable);
      if (document.type === "receipt") {
        receiptValueCents += lineValueCents;
        if (product.productId && position.priceCentsPerUnit > 0) {
          const current = receiptPricesByProduct.get(product.productId) ?? { productName: product.productName, prices: [] };
          current.prices.push(position.priceCentsPerUnit);
          receiptPricesByProduct.set(product.productId, current);
        }
        rows.push({
          id: `receipt:${position.id}`,
          documentId: document.id,
          documentName: document.name,
          documentDate: document.documentDate,
          documentHref: href,
          applicable: document.applicable,
          type: "receipt",
          productId: product.productId,
          productName: product.productName,
          productArticle: product.productArticle,
          productBrand: product.productBrand,
          productCategory: product.productCategory,
          storeId: document.storeId,
          storeName: document.store?.name ?? document.storeNameSnapshot,
          organizationId: null,
          organizationName: null,
          counterpartyName: document.counterparty?.name ?? document.counterpartyNameSnapshot,
          quantity,
          unitSalePrice: null,
          revenue: 0,
          cost: rub(lineValueCents),
          discountPercent: null,
          profit: null,
          marginPercent: null,
          currentBuyPrice: product.currentBuyPrice,
          costSource: "закупочная цена приёмки",
          status: "receipt",
          createdByName: document.createdByName,
          writeoffReason: null,
          adjustmentType: null,
          affectsManagementProfit: true,
        });
      } else if (document.type === "writeoff") {
        const costPerUnit = position.priceCentsPerUnit > 0 ? position.priceCentsPerUnit : position.product?.buyPriceCents ?? null;
        const lossCents = lineCostCents(quantity, costPerUnit) ?? 0;
        const isTechnicalAdjustment = document.affectsManagementProfit === false || document.adjustmentType === "technical";
        if (isTechnicalAdjustment) {
          technicalAdjustmentValueCents += lossCents;
          technicalAdjustmentQuantity += quantity;
        } else {
          writeoffLossCents += lossCents;
          const topKey = product.productId ?? position.productName;
          const topRow = topProducts.get(topKey);
          if (topRow) {
            topRow.writeoffLossCents += lossCents;
            topProducts.set(topKey, topRow);
          }
          addDaily(daily, document.documentDate, { writeoffLossCents: lossCents });
        }
        const writeoffReason = document.adjustmentReason ?? document.description;
        const noReason = !writeoffReason?.trim();
        rows.push({
          id: `writeoff:${position.id}`,
          documentId: document.id,
          documentName: document.name,
          documentDate: document.documentDate,
          documentHref: href,
          applicable: document.applicable,
          type: "writeoff",
          productId: product.productId,
          productName: product.productName,
          productArticle: product.productArticle,
          productBrand: product.productBrand,
          productCategory: product.productCategory,
          storeId: document.storeId,
          storeName: document.store?.name ?? document.storeNameSnapshot,
          organizationId: null,
          organizationName: null,
          counterpartyName: document.counterparty?.name ?? document.counterpartyNameSnapshot,
          quantity,
          unitSalePrice: null,
          revenue: 0,
          cost: rub(lossCents),
          discountPercent: null,
          profit: isTechnicalAdjustment ? 0 : rub(-lossCents),
          marginPercent: null,
          currentBuyPrice: product.currentBuyPrice,
          costSource: isTechnicalAdjustment
            ? "техническая корректировка без влияния на прибыль"
            : position.priceCentsPerUnit > 0 ? "цена учёта в списании" : "текущая закупочная цена товара",
          status: isTechnicalAdjustment ? "technical_adjustment" : noReason ? "writeoff_no_reason" : "writeoff",
          createdByName: document.createdByName,
          writeoffReason,
          adjustmentType: document.adjustmentType,
          affectsManagementProfit: !isTechnicalAdjustment,
        });
        if (!isTechnicalAdjustment && noReason) {
          addIssue(issues, {
            id: `writeoff-no-reason:${position.id}`,
            type: "writeoff_no_reason",
            severity: "warning",
            title: "Списание без причины",
            description: "У документа списания не заполнено описание причины.",
            productId: product.productId,
            productName: product.productName,
            documentId: document.id,
            documentName: document.name,
            documentHref: href,
            date: document.documentDate,
            amount: rub(lossCents),
          });
        }
      }
    }
  }

  for (const [productId, priceInfo] of receiptPricesByProduct) {
    const prices = priceInfo.prices.filter((price) => price > 0);
    if (prices.length < 2) continue;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min > 0 && max / min >= 1.2) {
      addIssue(issues, {
        id: `purchase-price-variance:${productId}`,
        type: "purchase_price_variance",
        severity: "warning",
        title: "Расхождение закупочных цен",
        description: `В приёмках по товару цена менялась с ${rub(min)?.toLocaleString("ru-RU")} ₽ до ${rub(max)?.toLocaleString("ru-RU")} ₽.`,
        productId,
        productName: priceInfo.productName,
        documentId: null,
        documentName: null,
        documentHref: null,
        date: null,
        amount: rub(max - min),
      });
    }
  }

  const operationalProfitCents = salesProfitCents - writeoffLossCents;
  const receiptDocuments = documents.filter((document) => document.type === "receipt");
  const writeoffDocuments = documents.filter((document) => document.type === "writeoff");
  const technicalAdjustmentDocuments = writeoffDocuments.filter((document) => (
    document.affectsManagementProfit === false || document.adjustmentType === "technical"
  ));
  const expenseWriteoffDocuments = writeoffDocuments.filter((document) => (
    document.affectsManagementProfit !== false && document.adjustmentType !== "technical"
  ));

  const result: LocalInventoryFinanceResult = {
    period: { dateFrom, dateTo },
    calculatedAt: new Date().toISOString(),
    formulas: [
      "Выручка = количество × цена продажи × (1 − скидка)",
      "Себестоимость = количество × закупочная цена",
      "Валовая прибыль = выручка с известной себестоимостью − себестоимость продаж",
      "Прибыль после списаний = валовая прибыль − обычные списания",
      "Технические корректировки уменьшают складской остаток, но не включаются в расходы и управленческую прибыль",
      "Если себестоимость не сохранена в отгрузке, используется текущая закупочная цена товара; если её нет, строка помечается как проблемная.",
    ],
    summary: {
      demandsCount: demands.length,
      receiptsCount: receiptDocuments.length,
      writeoffsCount: writeoffDocuments.length,
      documentsCount: demands.length + receiptDocuments.length + writeoffDocuments.length,
      processedLines,
      salesRevenue: rub(salesRevenueCents),
      knownSalesRevenue: rub(knownSalesRevenueCents),
      salesCost: rub(salesCostCents),
      grossProfit: rub(salesProfitCents),
      grossMarginPercent: marginPercent(knownSalesRevenueCents, salesProfitCents),
      receiptValue: rub(receiptValueCents),
      writeoffLoss: rub(writeoffLossCents),
      technicalAdjustmentValue: rub(technicalAdjustmentValueCents),
      technicalAdjustmentQuantity,
      technicalAdjustmentsCount: technicalAdjustmentDocuments.length,
      expenseWriteoffsCount: expenseWriteoffDocuments.length,
      operationalProfit: rub(operationalProfitCents),
      missingCostRevenue: rub(missingCostRevenueCents),
      missingCostLines,
    },
    topProducts: [...topProducts.values()]
      .sort((a, b) => b.profitCents - a.profitCents)
      .slice(0, 50)
      .map((row) => ({
        productId: row.productId,
        productName: row.productName,
        productArticle: row.productArticle,
        productBrand: row.productBrand,
        productCategory: row.productCategory,
        quantity: row.quantity,
        revenue: rub(row.revenueCents),
        cost: rub(row.costCents),
        profit: rub(row.profitCents),
        marginPercent: marginPercent(row.revenueCents, row.profitCents),
        documentsCount: row.documents.size,
        rowsCount: row.rowsCount,
        missingCostLines: row.missingCostLines,
        writeoffLoss: rub(row.writeoffLossCents),
      })),
    daily: [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, row]) => ({
        date,
        revenue: rub(row.revenueCents) ?? 0,
        cost: rub(row.costCents) ?? 0,
        profit: rub(row.profitCents) ?? 0,
        marginPercent: marginPercent(row.knownRevenueCents, row.profitCents),
        writeoffLoss: rub(row.writeoffLossCents) ?? 0,
        operationalProfit: rub(row.profitCents - row.writeoffLossCents) ?? 0,
      })),
    issues: issues.sort((a, b) => {
      const severity = a.severity === b.severity ? 0 : a.severity === "danger" ? -1 : 1;
      if (severity !== 0) return severity;
      return String(b.date ?? "").localeCompare(String(a.date ?? ""));
    }),
    rows: rows
      .sort((a, b) => b.documentDate.localeCompare(a.documentDate) || b.id.localeCompare(a.id))
      .slice(0, 800),
  };
  financeCache.entry = { key: cacheKey, expiresAt: now + FINANCE_CACHE_MS, value: result };
  return result;
}
