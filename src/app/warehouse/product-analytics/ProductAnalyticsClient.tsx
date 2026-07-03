"use client";

import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  PackagePlus,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { EcoBadge, EcoKpi, EcoTable } from "@/components/platform/EcoUI";
import { formatServiceDate, formatServiceDateTime, toServiceDateInput } from "@/lib/date-time";
import type {
  WarehouseAnalyticsGroupRow,
  WarehouseAnalyticsMatrixCell,
  WarehouseAnalyticsProductRow,
  WarehouseAnalyticsQualityGroup,
  WarehouseAnalyticsTable,
  WarehouseProductAnalytics,
} from "@/lib/warehouse-product-analytics";

type AnalyticsTab =
  | "overview"
  | "top"
  | "margins"
  | "dead"
  | "never"
  | "stockouts"
  | "quality"
  | "abcxyz"
  | "replenishment"
  | "new-location"
  | "partners"
  | "export";

type Filters = {
  period: string;
  dateFrom: string;
  dateTo: string;
  organizationId: string;
  warehouseId: string;
  category: string;
  brand: string;
  supplier: string;
  entityType: string;
  includeArchived: boolean;
  onlyActive: boolean;
  onlyWithStock: boolean;
  onlyWithoutSales: boolean;
  onlyProblems: boolean;
  onlyMarked: boolean;
  onlyBulkOil: boolean;
  onlyNegativeStock: boolean;
  onlyZeroCost: boolean;
};

type ActionPreview = {
  message?: string;
  rows?: WarehouseAnalyticsProductRow[];
};

const today = toServiceDateInput(new Date());

const defaultFilters: Filters = {
  period: "30d",
  dateFrom: today,
  dateTo: today,
  organizationId: "",
  warehouseId: "",
  category: "",
  brand: "",
  supplier: "",
  entityType: "",
  includeArchived: false,
  onlyActive: true,
  onlyWithStock: false,
  onlyWithoutSales: false,
  onlyProblems: false,
  onlyMarked: false,
  onlyBulkOil: false,
  onlyNegativeStock: false,
  onlyZeroCost: false,
};

const tabs: Array<{ id: AnalyticsTab; label: string; count?: (data: WarehouseProductAnalytics) => number }> = [
  { id: "overview", label: "Обзор" },
  { id: "top", label: "Лидеры продаж", count: (data) => data.topProducts.length },
  { id: "margins", label: "Маржинальность", count: (data) => data.margins.length },
  { id: "dead", label: "Залежавшиеся", count: (data) => data.deadStock.length },
  { id: "never", label: "Никогда не продавались", count: (data) => data.neverSold.length },
  { id: "stockouts", label: "Дефицит", count: (data) => data.stockouts.length },
  { id: "quality", label: "Качество карточек", count: (data) => data.cardQuality.products.length },
  { id: "abcxyz", label: "ABC / XYZ", count: (data) => data.abcXyz.rows.length },
  { id: "replenishment", label: "Рекомендации закупки", count: (data) => data.replenishment.length },
  { id: "new-location", label: "Для новой точки", count: (data) => data.newLocation.rows.length },
  { id: "partners", label: "Поставщики и бренды" },
  { id: "export", label: "Экспорт" },
];

const periods = [
  { value: "today", label: "Сегодня" },
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "current-month", label: "Текущий месяц" },
  { value: "previous-month", label: "Прошлый месяц" },
  { value: "90d", label: "90 дней" },
  { value: "year", label: "Год" },
  { value: "custom", label: "Произвольный" },
];

function tableForTab(tab: AnalyticsTab): WarehouseAnalyticsTable {
  if (tab === "margins") return "margins";
  if (tab === "dead") return "dead-stock";
  if (tab === "never") return "never-sold";
  if (tab === "stockouts") return "stockouts";
  if (tab === "quality") return "card-quality";
  if (tab === "abcxyz") return "abc-xyz";
  if (tab === "replenishment") return "replenishment";
  if (tab === "new-location") return "new-location";
  if (tab === "partners") return "suppliers";
  return "top-products";
}

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function buildParams(filters: Filters, refresh = false) {
  const params = new URLSearchParams();
  params.set("period", filters.period);
  if (filters.period === "custom") {
    params.set("dateFrom", filters.dateFrom);
    params.set("dateTo", filters.dateTo);
  }
  if (filters.organizationId) params.set("organizationId", filters.organizationId);
  if (filters.warehouseId) params.set("warehouseId", filters.warehouseId);
  if (filters.category) params.set("category", filters.category);
  if (filters.brand) params.set("brand", filters.brand);
  if (filters.supplier) params.set("supplier", filters.supplier);
  if (filters.entityType) params.set("entityType", filters.entityType);
  if (filters.includeArchived) params.set("includeArchived", "1");
  if (filters.onlyActive) params.set("onlyActive", "1");
  if (filters.onlyWithStock) params.set("onlyWithStock", "1");
  if (filters.onlyWithoutSales) params.set("onlyWithoutSales", "1");
  if (filters.onlyProblems) params.set("onlyProblems", "1");
  if (filters.onlyMarked) params.set("onlyMarked", "1");
  if (filters.onlyBulkOil) params.set("onlyBulkOil", "1");
  if (filters.onlyNegativeStock) params.set("onlyNegativeStock", "1");
  if (filters.onlyZeroCost) params.set("onlyZeroCost", "1");
  if (refresh) params.set("refresh", "1");
  return params;
}

function formatMoney(value: number | null | undefined) {
  return `${Number(value ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽`;
}

function formatMoneyExact(value: number | null | undefined) {
  if (value == null) return "—";
  return `${Number(value).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
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

function productHref(productId: string) {
  return `/inventory/products?product=${encodeURIComponent(productId)}`;
}

function TabCount({ data, count }: { data: WarehouseProductAnalytics | null; count?: (data: WarehouseProductAnalytics) => number }) {
  if (!data || !count) return null;
  return <span className="eco-tab__count">{count(data)}</span>;
}

function ToneBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <EcoBadge tone="neutral">Ок</EcoBadge>;
  const danger = /минус|заказать|отриц/i.test(value);
  const warning = /ниже|законч|лежит|никогда|мёртв/i.test(value);
  return <EcoBadge tone={danger ? "danger" : warning ? "warning" : "info"}>{value}</EcoBadge>;
}

function ProductTitle({ row }: { row: WarehouseAnalyticsProductRow }) {
  const meta = [row.article ? `арт. ${row.article}` : row.code ? `код ${row.code}` : "", row.brand, row.supplier]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="eco-pa-product-title">
      <Link href={productHref(row.productId)}>{row.name}</Link>
      <small>{meta || "без артикула / бренда / поставщика"}</small>
    </div>
  );
}

function ProductActions({ row, onProcurement }: { row: WarehouseAnalyticsProductRow; onProcurement: (row: WarehouseAnalyticsProductRow) => void }) {
  return (
    <div className="eco-row-actions eco-pa-row-actions">
      <Link className="eco-btn eco-btn--sm" href={productHref(row.productId)} title="Открыть товар" aria-label="Открыть товар">
        <ExternalLink className="eco-icon" aria-hidden />
      </Link>
      <button type="button" className="eco-btn eco-btn--sm" onClick={() => onProcurement(row)} title="Добавить в закупку" aria-label="Добавить в закупку">
        <PackagePlus className="eco-icon" aria-hidden />
      </button>
    </div>
  );
}

function ProductTable({
  rows,
  mode,
  empty,
  onProcurement,
}: {
  rows: WarehouseAnalyticsProductRow[];
  mode: "sales" | "margin" | "dead" | "stockout" | "quality" | "abc" | "new-location";
  empty: string;
  onProcurement: (row: WarehouseAnalyticsProductRow) => void;
}) {
  if (rows.length === 0) return <div className="eco-pa-empty">{empty}</div>;
  return (
    <EcoTable className="eco-pa-table-wrap">
      <thead>
        <tr>
          <th>Товар</th>
          <th>Категория</th>
          <th>Продано</th>
          <th>Выручка</th>
          <th>Прибыль</th>
          <th>Маржа</th>
          <th>Остаток</th>
          <th>Мин.</th>
          {mode === "dead" && <th>Без продаж</th>}
          {mode === "stockout" && <th>Дефицит</th>}
          {mode === "quality" && <th>Проблемы</th>}
          {mode === "abc" && <th>ABC/XYZ</th>}
          {mode === "new-location" && <th>Реком.</th>}
          <th>Последняя продажа</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.productId}>
            <td><ProductTitle row={row} /></td>
            <td>{row.category ?? "—"}</td>
            <td>{formatQty(row.soldQuantity)}</td>
            <td>{formatMoney(row.revenue)}</td>
            <td>{formatMoneyExact(row.grossProfit)}</td>
            <td>{formatPercent(row.marginPercent)}</td>
            <td>{formatQty(row.available)}</td>
            <td>{row.minimumBalance == null ? "—" : formatQty(row.minimumBalance)}</td>
            {mode === "dead" && <td><ToneBadge value={row.deadStockStatus ?? (row.daysWithoutSale == null ? "Никогда" : `${row.daysWithoutSale} дн.`)} /></td>}
            {mode === "stockout" && <td><ToneBadge value={row.stockoutStatus} /></td>}
            {mode === "quality" && <td>{row.qualityProblems.slice(0, 3).join(", ") || "—"}</td>}
            {mode === "abc" && <td><EcoBadge tone={row.abcRevenue === "A" ? "success" : row.abcRevenue === "B" ? "info" : "neutral"}>{row.abcRevenue}{row.xyz}</EcoBadge></td>}
            {mode === "new-location" && <td>{formatQty(row.recommendedMin)} шт.</td>}
            <td>{formatDate(row.lastSaleDate)}</td>
            <td><ProductActions row={row} onProcurement={onProcurement} /></td>
          </tr>
        ))}
      </tbody>
    </EcoTable>
  );
}

function GroupTable({ rows, title }: { rows: WarehouseAnalyticsGroupRow[]; title: string }) {
  return (
    <section className="eco-card eco-card--padded eco-pa-section">
      <div className="eco-card__head eco-card__head--plain">
        <div>
          <h2>{title}</h2>
          <p>Выручка, прибыль, остатки и неликвид по группе.</p>
        </div>
      </div>
      <EcoTable>
        <thead>
          <tr>
            <th>Группа</th>
            <th>Товаров</th>
            <th>С остатком</th>
            <th>Продано</th>
            <th>Выручка</th>
            <th>Прибыль</th>
            <th>Маржа</th>
            <th>Залежались</th>
            <th>Дефицит</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 40).map((row) => (
            <tr key={row.key}>
              <td><strong>{row.name}</strong></td>
              <td>{row.productsCount}</td>
              <td>{row.productsWithStock}</td>
              <td>{formatQty(row.soldQuantity)}</td>
              <td>{formatMoney(row.revenue)}</td>
              <td>{formatMoney(row.grossProfit)}</td>
              <td>{formatPercent(row.marginPercent)}</td>
              <td>{row.deadStockCount}</td>
              <td>{row.stockoutCount}</td>
            </tr>
          ))}
        </tbody>
      </EcoTable>
    </section>
  );
}

function QualityPanel({ groups, products, onProcurement }: { groups: WarehouseAnalyticsQualityGroup[]; products: WarehouseAnalyticsProductRow[]; onProcurement: (row: WarehouseAnalyticsProductRow) => void }) {
  return (
    <div className="eco-pa-stack">
      <section className="eco-card eco-card--padded eco-pa-section">
        <div className="eco-card__head eco-card__head--plain">
          <div>
            <h2>Проблемы карточек</h2>
            <p>Количество товаров по типам ошибок, влияющих на поиск, закупки и маржу.</p>
          </div>
        </div>
        <div className="eco-pa-quality-grid">
          {groups.map((group) => (
            <div key={group.key} className="eco-pa-quality-item">
              <EcoBadge tone={group.severity === "danger" ? "danger" : "warning"}>{group.count}</EcoBadge>
              <strong>{group.label}</strong>
              <span>{group.description}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="eco-card eco-card--padded eco-pa-section">
        <div className="eco-card__head eco-card__head--plain">
          <div>
            <h2>Товары с проблемами</h2>
            <p>Сначала показаны карточки с наибольшим числом проблем.</p>
          </div>
        </div>
        <ProductTable rows={products} mode="quality" empty="Проблемные карточки не найдены." onProcurement={onProcurement} />
      </section>
    </div>
  );
}

function AbcXyzPanel({ rows, matrix, onProcurement }: { rows: WarehouseAnalyticsProductRow[]; matrix: WarehouseAnalyticsMatrixCell[]; onProcurement: (row: WarehouseAnalyticsProductRow) => void }) {
  return (
    <div className="eco-pa-stack">
      <section className="eco-card eco-card--padded eco-pa-section">
        <div className="eco-card__head eco-card__head--plain">
          <div>
            <h2>Матрица ABC/XYZ</h2>
            <p>ABC показывает вклад в выручку, XYZ — стабильность спроса.</p>
          </div>
        </div>
        <div className="eco-pa-matrix">
          {matrix.map((cell) => (
            <div key={cell.key} className={`eco-pa-matrix-cell is-${cell.key.toLowerCase()}`}>
              <strong>{cell.key}</strong>
              <span>{cell.productsCount} товаров</span>
              <small>{formatMoney(cell.stockCost)} склад · {formatMoney(cell.revenue)} выручка</small>
              <em>{cell.recommendation}</em>
            </div>
          ))}
        </div>
      </section>
      <section className="eco-card eco-card--padded eco-pa-section">
        <div className="eco-card__head eco-card__head--plain">
          <div>
            <h2>ABC / XYZ по товарам</h2>
            <p>AX — обязательный складской товар; CZ — кандидат на заказ под клиента.</p>
          </div>
        </div>
        <ProductTable rows={rows} mode="abc" empty="Нет товаров для ABC/XYZ." onProcurement={onProcurement} />
      </section>
    </div>
  );
}

function ExportPanel({ data, onExport }: { data: WarehouseProductAnalytics; onExport: (table: WarehouseAnalyticsTable) => void }) {
  const exportItems: Array<{ table: WarehouseAnalyticsTable; label: string; count: number }> = [
    { table: "top-products", label: "Лидеры продаж", count: data.topProducts.length },
    { table: "margins", label: "Маржинальность", count: data.margins.length },
    { table: "dead-stock", label: "Залежавшиеся", count: data.deadStock.length },
    { table: "never-sold", label: "Никогда не продавались", count: data.neverSold.length },
    { table: "stockouts", label: "Дефицит", count: data.stockouts.length },
    { table: "card-quality", label: "Проблемы карточек", count: data.cardQuality.groups.length },
    { table: "abc-xyz", label: "ABC/XYZ", count: data.abcXyz.rows.length },
    { table: "replenishment", label: "Рекомендации закупки", count: data.replenishment.length },
    { table: "new-location", label: "Новая точка", count: data.newLocation.rows.length },
  ];
  return (
    <section className="eco-card eco-card--padded eco-pa-section">
      <div className="eco-card__head eco-card__head--plain">
        <div>
          <h2>Экспорт</h2>
          <p>CSV выгружается по текущему набору фильтров.</p>
        </div>
      </div>
      <div className="eco-pa-export-grid">
        {exportItems.map((item) => (
          <button key={item.table} type="button" className="eco-pa-export-item" onClick={() => onExport(item.table)}>
            <FileSpreadsheet className="eco-icon" aria-hidden />
            <span>
              <strong>{item.label}</strong>
              <small>{item.count} строк</small>
            </span>
            <Download className="eco-icon" aria-hidden />
          </button>
        ))}
      </div>
    </section>
  );
}

export default function ProductAnalyticsClient() {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [data, setData] = useState<WarehouseProductAnalytics | null>(null);
  const [activeTab, setActiveTab] = useState<AnalyticsTab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionPreview, setActionPreview] = useState<ActionPreview | null>(null);

  const load = useCallback(async (nextFilters: Filters, refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/warehouse/analytics/overview?${buildParams(nextFilters, refresh)}`, { cache: "no-store" });
      const payload = await readJson<WarehouseProductAnalytics & { error?: string }>(res);
      if (!res.ok || !payload) throw new Error(payload?.error || "Не удалось рассчитать аналитику товаров");
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось рассчитать аналитику товаров");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(defaultFilters);
  }, [load]);

  const periodLabel = useMemo(() => {
    if (!data) return "";
    return `${formatDate(data.period.dateFrom)} — ${formatDate(data.period.dateTo)}`;
  }, [data]);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    void load(filters, true);
  }

  function exportTable(table = tableForTab(activeTab)) {
    const params = buildParams(filters);
    params.set("table", table);
    window.location.href = `/api/warehouse/analytics/export?${params.toString()}`;
  }

  async function previewProcurement(row: WarehouseAnalyticsProductRow) {
    const res = await fetch(`/api/warehouse/analytics/add-to-procurement?${buildParams(filters)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: [row.productId] }),
    });
    const payload = await readJson<ActionPreview>(res);
    setActionPreview(payload ?? { message: "Preview недоступен" });
  }

  async function previewMinStock() {
    const res = await fetch(`/api/warehouse/analytics/apply-min-stock-recommendations?${buildParams(filters)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: data?.replenishment.slice(0, 20).map((row) => row.productId) ?? [] }),
    });
    const payload = await readJson<ActionPreview>(res);
    setActionPreview(payload ?? { message: "Preview недоступен" });
  }

  return (
    <div className="eco-pa-shell">
      <header className="eco-page-head eco-pa-head">
        <div>
          <p className="eco-page-kicker">Склад</p>
          <h1 className="eco-page-title">Аналитика товаров</h1>
          <p className="eco-page-subtitle">Продажи, маржа, остатки, дефицит, качество карточек и стартовый склад для новой точки.</p>
        </div>
        <div className="eco-actions">
          {data && <EcoBadge tone="info">Обновлено {formatServiceDateTime(data.calculatedAt)}</EcoBadge>}
          <button type="button" className="eco-btn" onClick={() => void load(filters, true)} disabled={loading}>
            <RefreshCw className={`eco-icon ${loading ? "is-spin" : ""}`} aria-hidden />
            Пересчитать
          </button>
          <button type="button" className="eco-btn eco-btn--primary" onClick={() => exportTable()} disabled={!data}>
            <Download className="eco-icon" aria-hidden />
            CSV
          </button>
        </div>
      </header>

      <form className="eco-card eco-card--padded eco-pa-filters" onSubmit={submitFilters}>
        <div className="eco-pa-filter-head">
          <SlidersHorizontal className="eco-icon" aria-hidden />
          <strong>Фильтры</strong>
          {data && <span>{periodLabel}</span>}
        </div>
        <div className="eco-pa-filter-grid">
          <label className="eco-field">
            <span>Период</span>
            <select className="eco-input" value={filters.period} onChange={(event) => updateFilter("period", event.target.value)}>
              {periods.map((period) => <option key={period.value} value={period.value}>{period.label}</option>)}
            </select>
          </label>
          <label className="eco-field">
            <span>Дата от</span>
            <input className="eco-input" type="date" value={filters.dateFrom} onChange={(event) => updateFilter("dateFrom", event.target.value)} disabled={filters.period !== "custom"} />
          </label>
          <label className="eco-field">
            <span>Дата до</span>
            <input className="eco-input" type="date" value={filters.dateTo} onChange={(event) => updateFilter("dateTo", event.target.value)} disabled={filters.period !== "custom"} />
          </label>
          <label className="eco-field">
            <span>Организация</span>
            <select className="eco-input" value={filters.organizationId} onChange={(event) => updateFilter("organizationId", event.target.value)}>
              <option value="">Все организации</option>
              {data?.options.organizations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="eco-field">
            <span>Склад</span>
            <select className="eco-input" value={filters.warehouseId} onChange={(event) => updateFilter("warehouseId", event.target.value)}>
              <option value="">Все склады</option>
              {data?.options.warehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="eco-field">
            <span>Категория</span>
            <select className="eco-input" value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>
              <option value="">Все категории</option>
              {data?.options.categories.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
            </select>
          </label>
          <label className="eco-field">
            <span>Бренд</span>
            <select className="eco-input" value={filters.brand} onChange={(event) => updateFilter("brand", event.target.value)}>
              <option value="">Все бренды</option>
              {data?.options.brands.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
            </select>
          </label>
          <label className="eco-field">
            <span>Поставщик</span>
            <select className="eco-input" value={filters.supplier} onChange={(event) => updateFilter("supplier", event.target.value)}>
              <option value="">Все поставщики</option>
              {data?.options.suppliers.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
            </select>
          </label>
          <label className="eco-field">
            <span>Тип</span>
            <select className="eco-input" value={filters.entityType} onChange={(event) => updateFilter("entityType", event.target.value)}>
              <option value="">Товары без услуг</option>
              {data?.options.entityTypes.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}
            </select>
          </label>
        </div>
        <div className="eco-pa-switches">
          {[
            ["onlyActive", "Только активные"],
            ["includeArchived", "Включая архивные"],
            ["onlyWithStock", "С остатком"],
            ["onlyWithoutSales", "Без продаж"],
            ["onlyProblems", "С проблемами"],
            ["onlyMarked", "Маркированные"],
            ["onlyBulkOil", "На разлив"],
            ["onlyNegativeStock", "Отрицательный остаток"],
            ["onlyZeroCost", "Нулевая себестоимость"],
          ].map(([key, label]) => (
            <label key={key} className="eco-pa-check">
              <input
                type="checkbox"
                checked={Boolean(filters[key as keyof Filters])}
                onChange={(event) => updateFilter(key as keyof Filters, event.target.checked as never)}
              />
              <span>{label}</span>
            </label>
          ))}
          <button type="submit" className="eco-btn eco-btn--primary" disabled={loading}>
            <BarChart3 className="eco-icon" aria-hidden />
            Показать
          </button>
        </div>
      </form>

      {error && (
        <div className="eco-pa-alert">
          <AlertTriangle className="eco-icon" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {actionPreview?.message && (
        <div className="eco-pa-alert is-success">
          <CheckCircle2 className="eco-icon" aria-hidden />
          <span>{actionPreview.message}</span>
          {!!actionPreview.rows?.length && <b>{actionPreview.rows.length} поз.</b>}
        </div>
      )}

      {loading && !data ? (
        <div className="eco-pa-loading">Считаем аналитику товаров…</div>
      ) : data ? (
        <>
          <nav className="eco-tabs eco-pa-tabs" aria-label="Вкладки аналитики товаров">
            {tabs.map((tab) => (
              <button key={tab.id} type="button" className={`eco-tab ${activeTab === tab.id ? "is-active" : ""}`} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
                <TabCount data={data} count={tab.count} />
              </button>
            ))}
          </nav>

          {activeTab === "overview" && (
            <div className="eco-pa-stack">
              <div className="eco-pa-kpis">
                {data.kpis.map((kpi) => (
                  <EcoKpi
                    key={kpi.key}
                    label={kpi.label}
                    value={kpi.format === "money" ? formatMoney(kpi.value) : kpi.format === "percent" ? formatPercent(kpi.value) : formatQty(kpi.value)}
                    sub={kpi.sub}
                    tone={kpi.tone}
                  />
                ))}
              </div>
              <section className="eco-card eco-card--padded eco-pa-section">
                <div className="eco-card__head eco-card__head--plain">
                  <div>
                    <h2>Топ по выручке</h2>
                    <p>Товары, которые дают основной оборот за выбранный период.</p>
                  </div>
                </div>
                <ProductTable rows={data.overview.topRevenue} mode="sales" empty="Нет продаж за период." onProcurement={previewProcurement} />
              </section>
              <div className="eco-pa-two-col">
                <section className="eco-card eco-card--padded eco-pa-section">
                  <div className="eco-card__head eco-card__head--plain">
                    <div>
                      <h2>Залежавшиеся по стоимости</h2>
                      <p>Остаток есть, продаж давно не было.</p>
                    </div>
                  </div>
                  <ProductTable rows={data.overview.deadStock} mode="dead" empty="Залежавшиеся товары не найдены." onProcurement={previewProcurement} />
                </section>
                <section className="eco-card eco-card--padded eco-pa-section">
                  <div className="eco-card__head eco-card__head--plain">
                    <div>
                      <h2>Дефицит</h2>
                      <p>Товары ниже минимума или близко к нулю.</p>
                    </div>
                  </div>
                  <ProductTable rows={data.overview.stockouts} mode="stockout" empty="Дефицит не найден." onProcurement={previewProcurement} />
                </section>
              </div>
            </div>
          )}

          {activeTab === "top" && (
            <section className="eco-card eco-card--padded eco-pa-section">
              <ProductTable rows={data.topProducts} mode="sales" empty="Нет продаж за период." onProcurement={previewProcurement} />
            </section>
          )}
          {activeTab === "margins" && (
            <section className="eco-card eco-card--padded eco-pa-section">
              <ProductTable rows={data.margins} mode="margin" empty="Нет данных по марже." onProcurement={previewProcurement} />
            </section>
          )}
          {activeTab === "dead" && (
            <section className="eco-card eco-card--padded eco-pa-section">
              <ProductTable rows={data.deadStock} mode="dead" empty="Залежавшиеся товары не найдены." onProcurement={previewProcurement} />
            </section>
          )}
          {activeTab === "never" && (
            <section className="eco-card eco-card--padded eco-pa-section">
              <ProductTable rows={data.neverSold} mode="dead" empty="Товары без продаж не найдены." onProcurement={previewProcurement} />
            </section>
          )}
          {activeTab === "stockouts" && (
            <section className="eco-card eco-card--padded eco-pa-section">
              <ProductTable rows={data.stockouts} mode="stockout" empty="Дефицит не найден." onProcurement={previewProcurement} />
            </section>
          )}
          {activeTab === "quality" && <QualityPanel groups={data.cardQuality.groups} products={data.cardQuality.products} onProcurement={previewProcurement} />}
          {activeTab === "abcxyz" && <AbcXyzPanel rows={data.abcXyz.rows} matrix={data.abcXyz.matrix} onProcurement={previewProcurement} />}
          {activeTab === "replenishment" && (
            <section className="eco-card eco-card--padded eco-pa-section">
              <div className="eco-card__head eco-card__head--plain">
                <div>
                  <h2>Рекомендации по минимальным остаткам</h2>
                  <p>Расчёт основан на скорости продаж, текущем остатке и ABC/XYZ.</p>
                </div>
                <button type="button" className="eco-btn eco-btn--primary" onClick={() => void previewMinStock()}>
                  Preview применения
                </button>
              </div>
              <ProductTable rows={data.replenishment} mode="stockout" empty="Рекомендации пополнения не найдены." onProcurement={previewProcurement} />
            </section>
          )}
          {activeTab === "new-location" && (
            <div className="eco-pa-stack">
              <section className="eco-card eco-card--padded eco-pa-section">
                <div className="eco-pa-new-summary">
                  <EcoKpi label="Базовый склад" value={data.newLocation.summary.baseProducts} sub={formatMoney(data.newLocation.summary.baseCost)} tone="success" />
                  <EcoKpi label="Расширенный склад" value={data.newLocation.summary.extendedProducts} sub={formatMoney(data.newLocation.summary.extendedCost)} tone="info" />
                  <EcoKpi label="Ожидаемая маржа" value={formatMoney(data.newLocation.summary.expectedMargin)} sub={`${data.newLocation.summary.categoriesCount} категорий · ${data.newLocation.summary.suppliersCount} поставщиков`} tone="rust" />
                </div>
              </section>
              <section className="eco-card eco-card--padded eco-pa-section">
                <ProductTable rows={data.newLocation.rows} mode="new-location" empty="Рекомендации для новой точки не найдены." onProcurement={previewProcurement} />
              </section>
            </div>
          )}
          {activeTab === "partners" && (
            <div className="eco-pa-stack">
              <GroupTable rows={data.brands} title="Бренды" />
              <GroupTable rows={data.suppliers} title="Поставщики" />
              <GroupTable rows={data.categories} title="Категории" />
            </div>
          )}
          {activeTab === "export" && <ExportPanel data={data} onExport={exportTable} />}
        </>
      ) : null}
    </div>
  );
}
