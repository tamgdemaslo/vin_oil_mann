"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Calculator,
  Download,
  ExternalLink,
  FileSpreadsheet,
  PackageSearch,
  Printer,
  RefreshCw,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatServiceDate, formatServiceDateTime, toServiceDateInput } from "@/lib/date-time";

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

type FinanceRow = {
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

type TopProduct = {
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

type FinanceResponse = {
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
  topProducts: TopProduct[];
  daily: {
    date: string;
    revenue: number;
    cost: number;
    profit: number;
    marginPercent: number | null;
    writeoffLoss: number;
    operationalProfit: number;
  }[];
  issues: FinanceIssue[];
  rows: FinanceRow[];
};

type Option = { id: string; name: string };
type ActiveTab = "overview" | "products" | "documents" | "problems" | "writeoffs";
type ProductSortKey = "profit" | "revenue" | "margin" | "quantity" | "cost";
type SortDirection = "asc" | "desc";

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      controller?.abort();
      reject(new Error("Превышено время ожидания ответа локальной базы"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      fetch(input, { ...init, ...(controller ? { signal: controller.signal } : {}) }),
      timeout,
    ]);
  } finally {
    window.clearTimeout(timer);
  }
}

function inputDate(date: Date) {
  return toServiceDateInput(date);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function today() {
  return inputDate(new Date());
}

function monthStart() {
  const date = new Date();
  date.setDate(1);
  return inputDate(date);
}

function formatMoney(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return `${n.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function formatQty(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const formatted = formatServiceDate(value);
  return formatted === "—" ? value : formatted;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const formatted = formatServiceDateTime(value);
  return formatted === "—" ? value : formatted;
}

function productMeta(product: Pick<TopProduct, "productArticle" | "productBrand" | "productCategory">) {
  return [product.productArticle ? `арт. ${product.productArticle}` : "", product.productBrand, product.productCategory]
    .filter(Boolean)
    .join(" · ") || "без артикула / бренда / категории";
}

function typeLabel(type: FinanceRow["type"]) {
  if (type === "sale") return "Отгрузка";
  if (type === "writeoff") return "Списание";
  return "Приёмка";
}

function statusMeta(status: FinanceRowStatus) {
  if (status === "missing_cost") return { label: "Нет себестоимости", tone: "warning" };
  if (status === "zero_price") return { label: "Нулевая цена", tone: "danger" };
  if (status === "full_discount") return { label: "Скидка 100%", tone: "warning" };
  if (status === "negative_margin") return { label: "Минусовая маржа", tone: "danger" };
  if (status === "writeoff_no_reason") return { label: "Нет причины", tone: "warning" };
  if (status === "technical_adjustment") return { label: "Техническая", tone: "info" };
  if (status === "receipt") return { label: "Поступление", tone: "neutral" };
  if (status === "writeoff") return { label: "Списание", tone: "warning" };
  return { label: "Ок", tone: "success" };
}

function productValue(product: TopProduct, key: ProductSortKey) {
  if (key === "profit") return product.profit ?? 0;
  if (key === "revenue") return product.revenue ?? 0;
  if (key === "margin") return product.marginPercent ?? -999;
  if (key === "quantity") return product.quantity ?? 0;
  return product.cost ?? 0;
}

function productKey(product: Pick<TopProduct, "productId" | "productName">) {
  return product.productId ?? product.productName;
}

function productEditHref(productId: string) {
  return `/inventory/products?product=${encodeURIComponent(productId)}`;
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildExportRows(data: FinanceResponse) {
  return [
    ["Документ", "Дата", "Тип", "Товар", "Кол-во", "Цена продажи", "Выручка", "Себестоимость", "Скидка", "Прибыль", "Маржа", "Статус", "Влияние на прибыль"],
    ...data.rows.map((row) => [
      row.documentName,
      row.documentDate,
      typeLabel(row.type),
      row.productName,
      row.quantity,
      row.unitSalePrice ?? "",
      row.revenue,
      row.cost ?? "",
      row.discountPercent ?? "",
      row.profit ?? "",
      row.marginPercent ?? "",
      statusMeta(row.status).label,
      row.affectsManagementProfit ? "учтено" : "не учтено",
    ]),
  ];
}

export default function ProfitClient() {
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(today());
  const [organizationId, setOrganizationId] = useState("");
  const [storeId, setStoreId] = useState("");
  const [documentType, setDocumentType] = useState("all");
  const [applicableOnly, setApplicableOnly] = useState(true);
  const [includeWriteoffs, setIncludeWriteoffs] = useState(true);
  const [showMissingCost, setShowMissingCost] = useState(true);
  const [organizations, setOrganizations] = useState<Option[]>([]);
  const [stores, setStores] = useState<Option[]>([]);
  const [data, setData] = useState<FinanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [productSort, setProductSort] = useState<ProductSortKey>("profit");
  const [productDirection, setProductDirection] = useState<SortDirection>("desc");
  const [selectedProduct, setSelectedProduct] = useState<TopProduct | null>(null);

  const missingRows = useMemo(
    () => data?.rows.filter((row) => row.status === "missing_cost") ?? [],
    [data]
  );
  const visibleRows = useMemo(
    () => (showMissingCost ? data?.rows ?? [] : data?.rows.filter((row) => row.status !== "missing_cost") ?? []),
    [data, showMissingCost]
  );
  const writeoffRows = useMemo(
    () => data?.rows.filter((row) => row.type === "writeoff") ?? [],
    [data]
  );
  const sortedProducts = useMemo(() => {
    const rows = [...(data?.topProducts ?? [])];
    rows.sort((a, b) => {
      const diff = productValue(a, productSort) - productValue(b, productSort);
      return productDirection === "asc" ? diff : -diff;
    });
    return rows;
  }, [data, productDirection, productSort]);
  const topCategories = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of data?.topProducts ?? []) {
      const category = product.productCategory || "Без категории";
      map.set(category, (map.get(category) ?? 0) + Number(product.profit ?? 0));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [data]);
  const writeoffReasons = useMemo(() => {
    const map = new Map<string, { count: number; sum: number }>();
    for (const row of writeoffRows) {
      const reason = row.writeoffReason?.trim() || "Без причины";
      const current = map.get(reason) ?? { count: 0, sum: 0 };
      current.count += 1;
      current.sum += Number(row.cost ?? 0);
      map.set(reason, current);
    }
    return [...map.entries()].sort((a, b) => b[1].sum - a[1].sum);
  }, [writeoffRows]);
  const empty = Boolean(data && data.summary.processedLines === 0);

  async function loadOptions() {
    try {
      const [orgRes, storeRes] = await Promise.all([
        fetchWithTimeout("/api/moysklad/organizations", { cache: "no-store" }),
        fetchWithTimeout("/api/local-inventory/stores", { cache: "no-store" }),
      ]);
      const orgJson = await readJson<{ organizations?: Option[] }>(orgRes);
      const storeJson = await readJson<{ stores?: Option[] }>(storeRes);
      setOrganizations(Array.isArray(orgJson?.organizations) ? orgJson.organizations : []);
      setStores(Array.isArray(storeJson?.stores) ? storeJson.stores : []);
    } catch {
      setOrganizations([]);
      setStores([]);
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (organizationId) params.set("organizationId", organizationId);
      if (storeId) params.set("storeId", storeId);
      if (documentType !== "all") params.set("documentType", documentType);
      params.set("applicableOnly", String(applicableOnly));
      params.set("includeWriteoffs", String(includeWriteoffs));
      const res = await fetchWithTimeout(`/api/local-inventory/finance?${params.toString()}`, { cache: "no-store" }, 20000);
      const json = await readJson<FinanceResponse & { error?: string }>(res);
      if (!res.ok || !json) throw new Error(json?.error ?? "Не удалось рассчитать прибыль");
      setData(json);
      setSelectedProduct((current) => {
        if (!current) return null;
        return json.topProducts.find((product) => productKey(product) === productKey(current)) ?? null;
      });
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOptions();
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(preset: "today" | "yesterday" | "7d" | "30d" | "month" | "prevMonth") {
    const now = new Date();
    if (preset === "today") {
      const value = inputDate(now);
      setDateFrom(value);
      setDateTo(value);
      return;
    }
    if (preset === "yesterday") {
      const value = inputDate(addDays(now, -1));
      setDateFrom(value);
      setDateTo(value);
      return;
    }
    if (preset === "7d") {
      setDateFrom(inputDate(addDays(now, -6)));
      setDateTo(inputDate(now));
      return;
    }
    if (preset === "30d") {
      setDateFrom(inputDate(addDays(now, -29)));
      setDateTo(inputDate(now));
      return;
    }
    if (preset === "month") {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateFrom(inputDate(start));
      setDateTo(inputDate(now));
      return;
    }
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    setDateFrom(inputDate(start));
    setDateTo(inputDate(end));
  }

  function toggleProductSort(key: ProductSortKey) {
    if (productSort === key) {
      setProductDirection((current) => (current === "desc" ? "asc" : "desc"));
      return;
    }
    setProductSort(key);
    setProductDirection("desc");
  }

  function exportCsv() {
    if (!data) return;
    const csv = buildExportRows(data).map((row) => row.map(csvCell).join(";")).join("\n");
    downloadTextFile(`finance-profit-${data.period.dateFrom}-${data.period.dateTo}.csv`, `\ufeff${csv}`, "text/csv;charset=utf-8");
  }

  function exportExcel() {
    if (!data) return;
    const rows = buildExportRows(data)
      .map((row) => `<tr>${row.map((cell) => `<td>${String(cell ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`)
      .join("");
    downloadTextFile(
      `finance-profit-${data.period.dateFrom}-${data.period.dateTo}.xls`,
      `\ufeff<table>${rows}</table>`,
      "application/vnd.ms-excel;charset=utf-8"
    );
  }

  const primaryKpis = data ? [
    {
      label: "Выручка",
      value: formatMoney(data.summary.salesRevenue),
      sub: `${data.summary.demandsCount} отгрузок · ${formatMoney(data.summary.knownSalesRevenue)} с известной себестоимостью`,
      tone: "neutral",
    },
    {
      label: "Валовая прибыль",
      value: formatMoney(data.summary.grossProfit),
      sub: "Выручка минус себестоимость продаж",
      tone: Number(data.summary.grossProfit ?? 0) >= 0 ? "success" : "danger",
    },
    {
      label: "Маржа",
      value: formatPercent(data.summary.grossMarginPercent),
      sub: "По строкам с известной себестоимостью",
      tone: Number(data.summary.grossMarginPercent ?? 0) >= 0 ? "success" : "neutral",
    },
    {
      label: "Прибыль после списаний",
      value: formatMoney(data.summary.operationalProfit),
      sub: `Минус обычные списания ${formatMoney(data.summary.writeoffLoss)}`,
      tone: Number(data.summary.operationalProfit ?? 0) >= 0 ? "success" : "danger",
      clickable: Number(data.summary.writeoffLoss ?? 0) > 0,
      onClick: () => setActiveTab("writeoffs"),
    },
  ] : [];

  const secondaryKpis = data ? [
    {
      label: "Себестоимость",
      value: formatMoney(data.summary.salesCost),
      sub: "Стоимость проданных товаров и услуг",
      tone: "neutral",
    },
    {
      label: "Потери списаний",
      value: formatMoney(data.summary.writeoffLoss),
      sub: `${data.summary.expenseWriteoffsCount} документов как расход`,
      tone: Number(data.summary.writeoffLoss ?? 0) > 0 ? "warning" : "neutral",
      clickable: Number(data.summary.writeoffLoss ?? 0) > 0,
      onClick: () => setActiveTab("writeoffs"),
    },
    {
      label: "Технические корректировки",
      value: formatMoney(data.summary.technicalAdjustmentValue),
      sub: `${formatQty(data.summary.technicalAdjustmentQuantity)} шт. · ${data.summary.technicalAdjustmentsCount} документов справочно`,
      tone: Number(data.summary.technicalAdjustmentValue ?? 0) > 0 ? "info" : "neutral",
      clickable: Number(data.summary.technicalAdjustmentValue ?? 0) > 0,
      onClick: () => setActiveTab("writeoffs"),
    },
    {
      label: "Поступления",
      value: formatMoney(data.summary.receiptValue),
      sub: `${data.summary.receiptsCount} приёмок за период`,
      tone: "info",
    },
    {
      label: "Без себестоимости",
      value: `${data.summary.missingCostLines}`,
      sub: `${formatMoney(data.summary.missingCostRevenue)} выручки требует проверки`,
      tone: data.summary.missingCostLines > 0 ? "danger" : "success",
      clickable: data.summary.missingCostLines > 0,
      onClick: () => setActiveTab("problems"),
    },
  ] : [];

  return (
    <div className="eco-finance-dashboard">
      <header className="eco-finance-head">
        <div className="eco-finance-head__copy">
          <div className="eco-page-kicker">Финансы / Цены и прибыль</div>
          <h1 className="eco-page-title">Цены и прибыль</h1>
          <p className="eco-page-subtitle">
            Расчёт выручки, себестоимости и прибыли по локальным отгрузкам, приёмкам, списаниям и закупочным ценам.
          </p>
        </div>
        <div className="eco-finance-head__actions">
          <div className="eco-finance-period-card">
            <span>Период</span>
            <strong>{formatDate(dateFrom)} — {formatDate(dateTo)}</strong>
          </div>
          <button type="button" className="eco-btn eco-btn--primary" onClick={() => void load()} disabled={loading}>
            <Calculator className="eco-icon" aria-hidden />
            Рассчитать
          </button>
          <button type="button" className="eco-btn" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="eco-icon" aria-hidden />
            Обновить
          </button>
          <button type="button" className="eco-btn" onClick={exportCsv} disabled={!data}>
            <Download className="eco-icon" aria-hidden />
            CSV
          </button>
          <button type="button" className="eco-btn" onClick={exportExcel} disabled={!data}>
            <FileSpreadsheet className="eco-icon" aria-hidden />
            Excel
          </button>
          <button type="button" className="eco-btn eco-btn--ghost" onClick={() => window.print()} disabled={!data}>
            <Printer className="eco-icon" aria-hidden />
            Печать
          </button>
        </div>
      </header>

      <form
        className="eco-finance-filter-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <div className="eco-finance-filter-grid">
          <label>
            <span>Период с</span>
            <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </label>
          <label>
            <span>Период по</span>
            <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </label>
          <label>
            <span>Организация</span>
            <select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>
              <option value="">Все организации</option>
              {organizations.map((organization) => (
                <option key={organization.id} value={organization.id}>{organization.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Склад</span>
            <select value={storeId} onChange={(event) => setStoreId(event.target.value)}>
              <option value="">Все склады</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>{store.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Тип документа</span>
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
              <option value="all">Все документы</option>
              <option value="sale">Отгрузки</option>
              <option value="receipt">Приёмки</option>
              <option value="writeoff">Списания</option>
            </select>
          </label>
        </div>

        <div className="eco-finance-preset-row" aria-label="Быстрый выбор периода">
          <button type="button" onClick={() => applyPreset("today")}>Сегодня</button>
          <button type="button" onClick={() => applyPreset("yesterday")}>Вчера</button>
          <button type="button" onClick={() => applyPreset("7d")}>7 дней</button>
          <button type="button" onClick={() => applyPreset("30d")}>30 дней</button>
          <button type="button" onClick={() => applyPreset("month")}>Текущий месяц</button>
          <button type="button" onClick={() => applyPreset("prevMonth")}>Прошлый месяц</button>
        </div>

        <div className="eco-finance-toggle-row">
          <label>
            <input type="checkbox" checked={applicableOnly} onChange={(event) => setApplicableOnly(event.target.checked)} />
            <span>Только проведённые</span>
          </label>
          <label>
            <input type="checkbox" checked={includeWriteoffs} onChange={(event) => setIncludeWriteoffs(event.target.checked)} />
            <span>Учитывать списания</span>
          </label>
          <label>
            <input type="checkbox" checked={showMissingCost} onChange={(event) => setShowMissingCost(event.target.checked)} />
            <span>Показывать строки без себестоимости</span>
          </label>
          <button type="submit" className="eco-btn eco-btn--primary eco-finance-calculate" disabled={loading}>
            <Calculator className="eco-icon" aria-hidden />
            Рассчитать
          </button>
        </div>
      </form>

      {loading && (
        <div className="eco-finance-progress" role="status">
          <RefreshCw className="eco-icon" aria-hidden />
          Считаем выручку и себестоимость…
        </div>
      )}

      {data && (
        <div className="eco-finance-source">
          <span>Данные рассчитаны за период {formatDate(data.period.dateFrom)} — {formatDate(data.period.dateTo)}</span>
          <span>Источник: локальная база — отгрузки, позиции, закупочные цены, списания и приёмки.</span>
          <strong>Обработано: {formatQty(data.summary.processedLines)} строк · {formatQty(data.summary.documentsCount)} документов · обновлено {formatDateTime(data.calculatedAt)}</strong>
        </div>
      )}

      {error && (
        <section className="eco-finance-state eco-finance-state--error">
          <AlertTriangle aria-hidden />
          <h2>Не удалось рассчитать прибыль</h2>
          <p>Проверьте локальную базу и повторите попытку.</p>
          <button type="button" className="eco-btn eco-btn--primary" onClick={() => void load()}>Повторить</button>
          <small>{error}</small>
        </section>
      )}

      {!loading && !error && !data && (
        <section className="eco-finance-state">
          <Calculator aria-hidden />
          <h2>Выберите период и нажмите «Рассчитать»</h2>
          <p>После расчёта здесь появятся KPI, рейтинг товаров и проблемные строки.</p>
        </section>
      )}

      {loading && !data && <SkeletonDashboard />}

      {data && empty && (
        <section className="eco-finance-state">
          <PackageSearch aria-hidden />
          <h2>За выбранный период нет данных</h2>
          <p>Измените период или проверьте проведённые отгрузки, приёмки и списания.</p>
        </section>
      )}

      {data && !empty && (
        <>
          <section className="eco-finance-kpi-grid eco-finance-kpi-grid--primary">
            {primaryKpis.map((card) => (
              <KpiCard key={card.label} {...card} />
            ))}
          </section>
          <section className="eco-finance-kpi-grid">
            {secondaryKpis.map((card) => (
              <KpiCard key={card.label} {...card} />
            ))}
          </section>

          {data.summary.missingCostLines > 0 && (
            <section className="eco-finance-warning">
              <AlertTriangle aria-hidden />
              <div>
                <strong>В расчёте есть строки без себестоимости</strong>
                <p>Проверьте закупочные цены, чтобы прибыль была точной. Сейчас прибыль может быть завышена.</p>
              </div>
              <button type="button" className="eco-btn eco-btn--primary" onClick={() => setActiveTab("problems")}>
                Показать строки
              </button>
              <Link className="eco-btn" href="/inventory/products">Открыть товары</Link>
            </section>
          )}

          <nav className="eco-finance-tabs" aria-label="Разделы отчёта">
            {[
              ["overview", "Обзор"],
              ["products", "Товары"],
              ["documents", "Документы"],
              ["problems", `Проблемы${data.issues.length ? ` · ${data.issues.length}` : ""}`],
              ["writeoffs", "Списания"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={activeTab === id ? "is-active" : ""}
                onClick={() => setActiveTab(id as ActiveTab)}
              >
                {label}
              </button>
            ))}
          </nav>

          {activeTab === "overview" && (
            <div className="eco-finance-overview">
              <section className="eco-finance-panel eco-finance-panel--chart">
                <div className="eco-finance-section-head">
                  <div>
                    <h2>Динамика выручки и прибыли</h2>
                    <p>Столбцы показывают выручку и прибыль по дням, линия — маржу.</p>
                  </div>
                  <BarChart3 aria-hidden />
                </div>
                <FinanceChart data={data.daily} />
              </section>

              <section className="eco-finance-panel">
                <div className="eco-finance-section-head">
                  <div>
                    <h2>Топ категорий по прибыли</h2>
                    <p>Где формируется основной финансовый результат.</p>
                  </div>
                </div>
                <div className="eco-finance-category-list">
                  {topCategories.map(([category, profit]) => (
                    <div key={category}>
                      <span>{category}</span>
                      <strong>{formatMoney(profit)}</strong>
                    </div>
                  ))}
                </div>
              </section>

              <ProductsTable
                title="Товары по прибыли"
                subtitle="Товары и услуги с наибольшей прибылью за выбранный период."
                products={sortedProducts.slice(0, 8)}
                productSort={productSort}
                direction={productDirection}
                onSort={toggleProductSort}
                onOpen={setSelectedProduct}
              />

              <RowsTable
                title="Детализация расчёта"
                subtitle="Последние операции, которые попали в расчёт."
                rows={visibleRows.slice(0, 12)}
              />

              <details className="eco-finance-formulas">
                <summary>Как считается прибыль</summary>
                <div>
                  <p>
                    Формулы нужны для проверки логики, но основной экран показывает управленческую картину: выручку,
                    себестоимость, прибыль, списания и проблемные строки.
                  </p>
                  {data.formulas.map((formula) => (
                    <code key={formula}>{formula}</code>
                  ))}
                </div>
              </details>
            </div>
          )}

          {activeTab === "products" && (
            <ProductsTable
              title="Товары по прибыли"
              subtitle="Товары и услуги с наибольшей прибылью за выбранный период."
              products={sortedProducts}
              productSort={productSort}
              direction={productDirection}
              onSort={toggleProductSort}
              onOpen={setSelectedProduct}
            />
          )}

          {activeTab === "documents" && (
            <RowsTable
              title="Детализация расчёта"
              subtitle="Отгрузки, приёмки и списания с ценой продажи, себестоимостью, скидкой и статусом."
              rows={visibleRows}
            />
          )}

          {activeTab === "problems" && (
            <ProblemsPanel issues={data.issues} missingRows={missingRows} />
          )}

          {activeTab === "writeoffs" && (
            <WriteoffsPanel rows={writeoffRows} reasons={writeoffReasons} />
          )}
        </>
      )}

      {selectedProduct && data && (
        <ProductDrawer
          product={selectedProduct}
          rows={data.rows.filter((row) => (
            selectedProduct.productId
              ? row.productId === selectedProduct.productId
              : row.productName === selectedProduct.productName
          ))}
          onClose={() => setSelectedProduct(null)}
        />
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone,
  clickable,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  tone: string;
  clickable?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
      {clickable && <em>Открыть детализацию</em>}
    </>
  );

  if (clickable) {
    return (
      <button type="button" className={`eco-finance-kpi is-${tone} is-clickable`} onClick={onClick}>
        {body}
      </button>
    );
  }
  return <article className={`eco-finance-kpi is-${tone}`}>{body}</article>;
}

function SortButton({
  label,
  sortKey,
  current,
  direction,
  onSort,
}: {
  label: string;
  sortKey: ProductSortKey;
  current: ProductSortKey;
  direction: SortDirection;
  onSort: (key: ProductSortKey) => void;
}) {
  const active = current === sortKey;
  return (
    <button type="button" className={active ? "is-active" : ""} onClick={() => onSort(sortKey)}>
      {label}
      {active && (direction === "desc" ? <ArrowDown aria-hidden /> : <ArrowUp aria-hidden />)}
    </button>
  );
}

function ProductsTable({
  title,
  subtitle,
  products,
  productSort,
  direction,
  onSort,
  onOpen,
}: {
  title: string;
  subtitle: string;
  products: TopProduct[];
  productSort: ProductSortKey;
  direction: SortDirection;
  onSort: (key: ProductSortKey) => void;
  onOpen: (product: TopProduct) => void;
}) {
  return (
    <section className="eco-finance-panel eco-finance-panel--wide">
      <div className="eco-finance-section-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="eco-finance-sort-row">
        <SortButton label="По прибыли" sortKey="profit" current={productSort} direction={direction} onSort={onSort} />
        <SortButton label="По выручке" sortKey="revenue" current={productSort} direction={direction} onSort={onSort} />
        <SortButton label="По марже" sortKey="margin" current={productSort} direction={direction} onSort={onSort} />
        <SortButton label="По количеству" sortKey="quantity" current={productSort} direction={direction} onSort={onSort} />
        <SortButton label="По себестоимости" sortKey="cost" current={productSort} direction={direction} onSort={onSort} />
      </div>

      <div className="eco-finance-table-wrap">
        <table className="eco-finance-table">
          <thead>
            <tr>
              <th>Товар</th>
              <th className="is-number">Кол-во</th>
              <th className="is-number">Выручка</th>
              <th className="is-number">Себестоимость</th>
              <th className="is-number">Прибыль</th>
              <th className="is-number">Маржа</th>
              <th className="is-number">Документов</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={productKey(product)} className={product.missingCostLines > 0 ? "is-warning" : ""}>
                <td>
                  {product.productId ? (
                    <Link
                      href={productEditHref(product.productId)}
                      className="eco-finance-product-link"
                      title="Открыть карточку товара"
                    >
                      <strong>{product.productName}</strong>
                      <span>{productMeta(product)}</span>
                    </Link>
                  ) : (
                    <div className="eco-finance-product-link is-static">
                      <strong>{product.productName}</strong>
                      <span>{productMeta(product)}</span>
                    </div>
                  )}
                </td>
                <td className="is-number">{formatQty(product.quantity)}</td>
                <td className="is-number">{formatMoney(product.revenue)}</td>
                <td className="is-number">{formatMoney(product.cost)}</td>
                <td className={`is-number is-profit ${Number(product.profit ?? 0) < 0 ? "is-danger" : ""}`}>{formatMoney(product.profit)}</td>
                <td className="is-number">{formatPercent(product.marginPercent)}</td>
                <td className="is-number">{product.documentsCount}</td>
                <td>
                  <button type="button" className="eco-btn eco-btn--sm" onClick={() => onOpen(product)}>Отгрузки</button>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={8} className="eco-finance-empty-cell">Нет товаров за выбранный период.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="eco-finance-mobile-cards">
        {products.map((product) => (
          <article key={productKey(product)} className={product.missingCostLines > 0 ? "is-warning" : ""}>
            <div>
              {product.productId ? (
                <Link href={productEditHref(product.productId)} className="eco-finance-product-link" title="Открыть карточку товара">
                  <strong>{product.productName}</strong>
                </Link>
              ) : (
                <strong>{product.productName}</strong>
              )}
              <span>{productMeta(product)}</span>
            </div>
            <dl>
              <div><dt>Выручка</dt><dd>{formatMoney(product.revenue)}</dd></div>
              <div><dt>Прибыль</dt><dd>{formatMoney(product.profit)}</dd></div>
              <div><dt>Маржа</dt><dd>{formatPercent(product.marginPercent)}</dd></div>
            </dl>
            <div className="eco-finance-card-actions">
              {product.productId && (
                <Link className="eco-btn eco-btn--primary" href={productEditHref(product.productId)}>
                  Карточка товара
                </Link>
              )}
              <button type="button" className="eco-btn" onClick={() => onOpen(product)}>Отгрузки</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function RowsTable({ title, subtitle, rows }: { title: string; subtitle: string; rows: FinanceRow[] }) {
  return (
    <section className="eco-finance-panel eco-finance-panel--wide">
      <div className="eco-finance-section-head">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="eco-finance-table-wrap">
        <table className="eco-finance-table eco-finance-table--rows">
          <thead>
            <tr>
              <th>Документ</th>
              <th>Дата</th>
              <th>Товар</th>
              <th className="is-number">Кол-во</th>
              <th className="is-number">Цена продажи</th>
              <th className="is-number">Себестоимость</th>
              <th className="is-number">Скидка</th>
              <th className="is-number">Прибыль</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const status = statusMeta(row.status);
              return (
                <tr key={row.id} className={status.tone === "warning" ? "is-warning" : status.tone === "danger" ? "is-danger" : ""}>
                  <td>
                    <Link href={row.documentHref} className="eco-finance-doc-link">
                      <strong>{row.documentName}</strong>
                      <span>{typeLabel(row.type)} · {row.applicable ? "проведён" : "черновик"}</span>
                    </Link>
                  </td>
                  <td>{formatDate(row.documentDate)}</td>
                  <td>
                    {row.productId ? (
                      <Link href={productEditHref(row.productId)} className="eco-finance-product-link" title="Открыть карточку товара">
                        <strong>{row.productName}</strong>
                      </Link>
                    ) : (
                      <strong>{row.productName}</strong>
                    )}
                    <span>{[row.productArticle ? `арт. ${row.productArticle}` : "", row.productBrand].filter(Boolean).join(" · ") || row.costSource}</span>
                  </td>
                  <td className="is-number">{formatQty(row.quantity)}</td>
                  <td className="is-number">{row.unitSalePrice == null ? "—" : formatMoney(row.unitSalePrice)}</td>
                  <td className="is-number">{row.cost == null ? "—" : formatMoney(row.cost)}</td>
                  <td className="is-number">{row.discountPercent == null ? "—" : formatPercent(row.discountPercent)}</td>
                  <td className={`is-number is-profit ${Number(row.profit ?? 0) < 0 ? "is-danger" : ""}`}>{row.profit == null ? "—" : formatMoney(row.profit)}</td>
                  <td>
                    <span className={`eco-finance-status is-${status.tone}`}>{status.label}</span>
                    {row.status === "missing_cost" && row.productId && (
                      <Link href={productEditHref(row.productId)} className="eco-finance-row-action">
                        Исправить себестоимость
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="eco-finance-empty-cell">Нет строк для отображения.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="eco-finance-mobile-cards">
        {rows.map((row) => {
          const status = statusMeta(row.status);
          return (
            <article key={row.id} className={status.tone === "warning" ? "is-warning" : status.tone === "danger" ? "is-danger" : ""}>
              <div>
                {row.productId ? (
                  <Link href={productEditHref(row.productId)} className="eco-finance-product-link" title="Открыть карточку товара">
                    <strong>{row.productName}</strong>
                  </Link>
                ) : (
                  <strong>{row.productName}</strong>
                )}
                <span>{row.documentName} · {formatDate(row.documentDate)}</span>
              </div>
              <dl>
                <div><dt>Выручка</dt><dd>{formatMoney(row.revenue)}</dd></div>
                <div><dt>Прибыль</dt><dd>{row.profit == null ? "—" : formatMoney(row.profit)}</dd></div>
                <div><dt>Статус</dt><dd>{status.label}</dd></div>
              </dl>
              <Link className="eco-btn" href={row.documentHref}>Открыть документ</Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProblemsPanel({ issues, missingRows }: { issues: FinanceIssue[]; missingRows: FinanceRow[] }) {
  return (
    <section className="eco-finance-panel eco-finance-panel--wide">
      <div className="eco-finance-section-head">
        <div>
          <h2>Проблемы расчёта</h2>
          <p>Строки без себестоимости, нулевые цены, скидки 100%, отрицательная маржа и списания без причины.</p>
        </div>
      </div>

      {issues.length === 0 && (
        <div className="eco-finance-state eco-finance-state--inline">
          <PackageSearch aria-hidden />
          <h3>Критичных проблем не найдено</h3>
          <p>В текущей выборке нет строк без себестоимости, нулевых цен и отрицательной маржи.</p>
        </div>
      )}

      {issues.length > 0 && (
        <div className="eco-finance-issue-list">
          {issues.map((issue) => (
            <article key={issue.id} className={`is-${issue.severity}`}>
              <AlertTriangle aria-hidden />
              <div>
                <strong>{issue.title}</strong>
                <p>{issue.description}</p>
                <span>
                  {[issue.productName, issue.documentName, issue.date ? formatDate(issue.date) : ""].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="eco-finance-issue-actions">
                {issue.amount != null && <b>{formatMoney(issue.amount)}</b>}
                {issue.documentHref && <Link className="eco-btn eco-btn--sm" href={issue.documentHref}>Документ</Link>}
                {issue.productId && <Link className="eco-btn eco-btn--sm" href={productEditHref(issue.productId)}>Товар</Link>}
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="eco-finance-missing-block">
        <div className="eco-finance-section-head">
          <div>
            <h3>Строки без себестоимости</h3>
            <p>Проверьте текущую закупочную цену товара или откройте документ.</p>
          </div>
        </div>
        <div className="eco-finance-table-wrap">
          <table className="eco-finance-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>Документ</th>
                <th>Дата</th>
                <th className="is-number">Цена продажи</th>
                <th className="is-number">Кол-во</th>
                <th className="is-number">Текущая закупочная цена</th>
                <th>Действие</th>
              </tr>
            </thead>
            <tbody>
              {missingRows.map((row) => (
                <tr key={row.id} className="is-warning">
                  <td>
                    {row.productId ? (
                      <Link href={productEditHref(row.productId)} className="eco-finance-product-link" title="Открыть карточку товара">
                        <strong>{row.productName}</strong>
                      </Link>
                    ) : (
                      <strong>{row.productName}</strong>
                    )}
                    <span>{row.productArticle ? `арт. ${row.productArticle}` : "без артикула"}</span>
                  </td>
                  <td><Link className="eco-finance-doc-link" href={row.documentHref}>{row.documentName}</Link></td>
                  <td>{formatDate(row.documentDate)}</td>
                  <td className="is-number">{formatMoney(row.unitSalePrice)}</td>
                  <td className="is-number">{formatQty(row.quantity)}</td>
                  <td className="is-number">{row.currentBuyPrice == null ? "—" : formatMoney(row.currentBuyPrice)}</td>
                  <td>
                    {row.productId
                      ? <Link className="eco-btn eco-btn--sm eco-btn--primary" href={productEditHref(row.productId)}>Исправить закупочную цену</Link>
                      : <Link className="eco-btn eco-btn--sm" href={row.documentHref}>Открыть документ</Link>}
                  </td>
                </tr>
              ))}
              {missingRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="eco-finance-empty-cell">Строк без себестоимости нет.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function WriteoffsPanel({
  rows,
  reasons,
}: {
  rows: FinanceRow[];
  reasons: Array<[string, { count: number; sum: number }]>;
}) {
  const technicalRows = rows.filter((row) => row.status === "technical_adjustment" || row.affectsManagementProfit === false);
  const expenseRows = rows.filter((row) => row.status !== "technical_adjustment" && row.affectsManagementProfit !== false);
  const total = expenseRows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0);
  const technicalTotal = technicalRows.reduce((sum, row) => sum + Number(row.cost ?? 0), 0);
  const quantity = rows.reduce((sum, row) => sum + Number(row.quantity ?? 0), 0);
  const docs = new Set(rows.map((row) => row.documentId)).size;

  return (
    <section className="eco-finance-panel eco-finance-panel--wide">
      <div className="eco-finance-section-head">
        <div>
          <h2>Списания</h2>
          <p>Обычные списания влияют на прибыль, технические корректировки показаны справочно.</p>
        </div>
      </div>
      <div className="eco-finance-writeoff-summary">
        <article><span>Обычные списания</span><strong>{formatMoney(total)}</strong></article>
        <article><span>Технически скорректировано</span><strong>{formatMoney(technicalTotal)}</strong></article>
        <article><span>Списано позиций</span><strong>{formatQty(quantity)}</strong></article>
        <article><span>Документы списания</span><strong>{docs}</strong></article>
      </div>

      <div className="eco-finance-reason-list">
        {reasons.map(([reason, item]) => (
          <div key={reason}>
            <span>{reason}</span>
            <strong>{formatMoney(item.sum)}</strong>
            <em>{item.count} строк</em>
          </div>
        ))}
      </div>

      <RowsTable
        title="Документы и строки списаний"
        subtitle="Из чего состоят обычные списания и технические корректировки."
        rows={rows}
      />
    </section>
  );
}

function FinanceChart({ data }: { data: FinanceResponse["daily"] }) {
  const width = 860;
  const height = 260;
  const padding = 34;
  const maxValue = Math.max(1, ...data.flatMap((row) => [row.revenue, Math.abs(row.profit), row.writeoffLoss]));
  const slot = data.length > 0 ? (width - padding * 2) / data.length : 0;
  const barWidth = Math.max(8, Math.min(22, slot * 0.28));
  const points = data
    .map((row, index) => {
      const x = padding + slot * index + slot / 2;
      const margin = Math.max(0, Math.min(100, row.marginPercent ?? 0));
      const y = height - padding - (margin / 100) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");

  if (data.length === 0) {
    return <div className="eco-finance-chart-empty">Нет дневных данных для графика.</div>;
  }

  return (
    <div className="eco-finance-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="График выручки, прибыли и маржи по дням">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} />
        {data.map((row, index) => {
          const x = padding + slot * index + slot / 2;
          const revenueHeight = (row.revenue / maxValue) * (height - padding * 2);
          const profitHeight = (Math.max(0, row.profit) / maxValue) * (height - padding * 2);
          return (
            <g key={row.date}>
              <rect className="is-revenue" x={x - barWidth - 2} y={height - padding - revenueHeight} width={barWidth} height={revenueHeight} rx="3" />
              <rect className="is-profit" x={x + 2} y={height - padding - profitHeight} width={barWidth} height={profitHeight} rx="3" />
              <text x={x} y={height - 8} textAnchor="middle">{row.date.slice(8, 10)}</text>
            </g>
          );
        })}
        {points && <polyline className="is-margin" points={points} />}
      </svg>
      <div className="eco-finance-chart-legend">
        <span className="is-revenue">Выручка</span>
        <span className="is-profit">Прибыль</span>
        <span className="is-margin">Маржа</span>
      </div>
    </div>
  );
}

function ProductDrawer({
  product,
  rows,
  onClose,
}: {
  product: TopProduct;
  rows: FinanceRow[];
  onClose: () => void;
}) {
  const salesRows = rows.filter((row) => row.type === "sale");
  const receiptRows = rows.filter((row) => row.type === "receipt");
  const missingRows = rows.filter((row) => row.status === "missing_cost");
  const documents = [...new Map(rows.map((row) => [row.documentId, row])).values()].slice(0, 12);

  return (
    <div className="eco-finance-drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="eco-finance-drawer" role="dialog" aria-modal="true" aria-label="Детализация товара" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>Детализация товара</span>
            <h2>{product.productName}</h2>
            <p>{productMeta(product)}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <X aria-hidden />
          </button>
        </header>

        <div className="eco-finance-drawer-kpis">
          <article><span>Кол-во продаж</span><strong>{formatQty(product.quantity)}</strong></article>
          <article><span>Выручка</span><strong>{formatMoney(product.revenue)}</strong></article>
          <article><span>Себестоимость</span><strong>{formatMoney(product.cost)}</strong></article>
          <article><span>Прибыль</span><strong>{formatMoney(product.profit)}</strong></article>
          <article><span>Маржа</span><strong>{formatPercent(product.marginPercent)}</strong></article>
          <article><span>Строк без себестоимости</span><strong>{product.missingCostLines}</strong></article>
        </div>

        <section>
          <h3>Документы</h3>
          <div className="eco-finance-drawer-list">
            {documents.map((row) => (
              <Link key={row.documentId} href={row.documentHref}>
                <strong>{row.documentName}</strong>
                <span>{typeLabel(row.type)} · {formatDate(row.documentDate)} · {row.applicable ? "проведён" : "черновик"}</span>
                <ExternalLink aria-hidden />
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h3>Последние отгрузки</h3>
          <div className="eco-finance-drawer-list">
            {salesRows.slice(0, 6).map((row) => (
              <Link key={row.id} href={row.documentHref}>
                <strong>{row.documentName}</strong>
                <span>{formatDate(row.documentDate)} · {formatQty(row.quantity)} · прибыль {row.profit == null ? "—" : formatMoney(row.profit)}</span>
                <ExternalLink aria-hidden />
              </Link>
            ))}
            {salesRows.length === 0 && <p>Отгрузок по товару в выборке нет.</p>}
          </div>
        </section>

        <section>
          <h3>Закупочные цены</h3>
          <div className="eco-finance-drawer-list">
            {receiptRows.slice(0, 6).map((row) => (
              <Link key={row.id} href={row.documentHref}>
                <strong>{row.cost == null ? "—" : formatMoney(row.cost / Math.max(1, row.quantity))} за ед.</strong>
                <span>{row.documentName} · {formatDate(row.documentDate)} · {row.counterpartyName || "поставщик не указан"}</span>
                <ExternalLink aria-hidden />
              </Link>
            ))}
            {receiptRows.length === 0 && <p>Приёмок по товару в выборке нет.</p>}
          </div>
        </section>

        {missingRows.length > 0 && (
          <section className="is-warning">
            <h3>Строки без себестоимости</h3>
            <p>У товара есть строки, которые требуют закупочной цены.</p>
            {product.productId && (
              <Link className="eco-btn eco-btn--primary" href={productEditHref(product.productId)}>
                Исправить закупочную цену
              </Link>
            )}
          </section>
        )}
      </aside>
    </div>
  );
}

function SkeletonDashboard() {
  return (
    <div className="eco-finance-skeleton">
      {Array.from({ length: 8 }).map((_, index) => <span key={index} />)}
    </div>
  );
}
