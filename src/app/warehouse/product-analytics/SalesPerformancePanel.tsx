"use client";

import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  History,
  RefreshCw,
  Save,
  Search,
  Tags,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { EcoBadge, EcoKpi, EcoTable } from "@/components/platform/EcoUI";
import { formatServiceDate, formatServiceDateTime, toServiceDateInput } from "@/lib/date-time";
import type {
  SalesPerformanceAnalytics,
  SalesPerformanceComparison,
  SalesPerformanceDetailRow,
  SalesPerformancePlanFactRow,
  SalesPerformanceProductRow,
  SalesPerformanceServiceRow,
  SalesPerformanceUnclassifiedRow,
} from "@/lib/sales-performance-analytics";

type SalesTab = "overview" | "products" | "services" | "plan" | "growth" | "classification";
type DetailPayload = { rowKey: string; total: number; rows: SalesPerformanceDetailRow[] };

type SalesFilters = {
  period: string;
  dateFrom: string;
  dateTo: string;
  metricCode: string;
};

const today = toServiceDateInput(new Date());
const defaultFilters: SalesFilters = {
  period: "current-month",
  dateFrom: today,
  dateTo: today,
  metricCode: "",
};

const periodOptions = [
  { value: "today", label: "Сегодня" },
  { value: "7d", label: "7 дней" },
  { value: "30d", label: "30 дней" },
  { value: "current-month", label: "Текущий месяц" },
  { value: "previous-month", label: "Прошлый месяц" },
  { value: "90d", label: "90 дней" },
  { value: "custom", label: "Произвольный" },
];

const aggregateLabels: Record<string, string> = {
  AUTOMATIC: "АКПП",
  CVT: "CVT",
  DCT_DSG: "DCT / DSG",
  MANUAL: "МКПП",
  UNKNOWN: "агрегат не указан",
};

const procedureLabels: Record<string, string> = {
  PARTIAL: "частичная",
  MACHINE: "аппаратная",
  STANDARD: "стандартная",
  UNKNOWN: "способ не указан",
};

const configurationLabels: Record<string, string> = {
  NO_PAN: "без поддона",
  PAN_AND_FILTER: "поддон и фильтр",
  TWO_FILTERS: "два фильтра",
  OTHER: "другая конфигурация",
  UNKNOWN: "конфигурация не указана",
};

function buildParams(filters: SalesFilters, refresh = false) {
  const params = new URLSearchParams({ period: filters.period });
  if (filters.period === "custom") {
    params.set("dateFrom", filters.dateFrom);
    params.set("dateTo", filters.dateTo);
  }
  if (filters.metricCode) params.set("metricCode", filters.metricCode);
  if (refresh) params.set("refresh", "1");
  return params;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

function money(cents: number | null | undefined) {
  if (cents == null) return "—";
  return `${(cents / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽`;
}

function number(value: number | null | undefined, maximumFractionDigits = 1) {
  if (value == null) return "—";
  return value.toLocaleString("ru-RU", { maximumFractionDigits });
}

function percent(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${number(value, 1)}%`;
}

function quantity(value: number | null, unit: string) {
  if (value == null) return "—";
  const suffix = unit === "LITER" ? "л" : unit === "OPERATION" ? "опер." : "шт.";
  return `${number(value, 3)} ${suffix}`;
}

function comparisonLabel(comparison: SalesPerformanceComparison | null, suffix = "") {
  if (!comparison) return "Нет сопоставимых данных";
  const delta = `${comparison.delta > 0 ? "+" : ""}${number(comparison.delta, 1)}${suffix}`;
  const deltaPercent = comparison.deltaPercent == null
    ? "без базы"
    : `${comparison.deltaPercent > 0 ? "+" : ""}${percent(comparison.deltaPercent)}`;
  return `${delta} · ${deltaPercent}`;
}

function Comparison({ value, suffix = "" }: { value: SalesPerformanceComparison | null; suffix?: string }) {
  if (!value) return <span className="eco-sp-change is-neutral">—</span>;
  const Icon = value.delta > 0 ? ArrowUpRight : value.delta < 0 ? ArrowDownRight : ArrowRight;
  const tone = value.delta > 0 ? "is-positive" : value.delta < 0 ? "is-negative" : "is-neutral";
  return (
    <span className={`eco-sp-change ${tone}`} title={comparisonLabel(value, suffix)}>
      <Icon aria-hidden />
      {value.deltaPercent == null ? "новое" : `${value.deltaPercent > 0 ? "+" : ""}${percent(value.deltaPercent)}`}
    </span>
  );
}

function serviceSubtitle(row: SalesPerformanceServiceRow) {
  return [
    row.aggregateType ? aggregateLabels[row.aggregateType] : "",
    row.procedure ? procedureLabels[row.procedure] : "",
    row.configuration ? configurationLabels[row.configuration] : "",
  ].filter(Boolean).join(" · ");
}

function servicePlanSubtitle(row: Pick<SalesPerformancePlanFactRow, "metricCode" | "aggregateType" | "procedure" | "configuration">) {
  return [
    row.aggregateType ? aggregateLabels[row.aggregateType] : "",
    row.procedure ? procedureLabels[row.procedure] : "",
    row.configuration ? configurationLabels[row.configuration] : "",
  ].filter(Boolean).join(" · ") || row.metricCode;
}

function ProductRows({ rows, onOpen }: { rows: SalesPerformanceProductRow[]; onOpen: (key: string, title: string) => void }) {
  if (!rows.length) return <div className="eco-sp-empty">Нет товарных продаж за выбранный период.</div>;
  return (
    <EcoTable className="eco-sp-table-wrap">
      <thead>
        <tr>
          <th>Категория</th>
          <th>Продано</th>
          <th>Отгрузок</th>
          <th>Клиентов</th>
          <th>Выручка</th>
          <th>Валовая прибыль</th>
          <th>Маржа</th>
          <th>К прошлому периоду</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>
              <button type="button" className="eco-sp-row-title" onClick={() => onOpen(row.key, row.title)}>
                <strong>{row.title}</strong>
                <small>{row.metricCode}</small>
              </button>
            </td>
            <td>
              <strong className="eco-sp-number">{quantity(row.quantity, row.unit)}</strong>
              {row.unit === "LITER" && row.quantityCoveragePercent < 100 ? (
                <small className="eco-sp-cell-note">Литры подтверждены для {percent(row.quantityCoveragePercent)} строк</small>
              ) : null}
            </td>
            <td>{number(row.documentsCount, 0)}</td>
            <td>{number(row.clientsCount, 0)}</td>
            <td>{money(row.revenueCents)}</td>
            <td>
              {money(row.grossProfitCents)}
              {row.missingCostLines ? <small className="eco-sp-cell-note is-warning">{row.missingCostLines} стр. без cost snapshot</small> : null}
            </td>
            <td>{percent(row.marginPercent)}</td>
            <td><Comparison value={row.comparison.quantity} suffix={row.unit === "LITER" ? " л" : " шт."} /></td>
            <td>
              <button type="button" className="eco-btn eco-btn--sm" onClick={() => onOpen(row.key, row.title)}>
                <Search className="eco-icon" aria-hidden />
                Отгрузки
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </EcoTable>
  );
}

function ServiceRows({ rows, onOpen }: { rows: SalesPerformanceServiceRow[]; onOpen: (key: string, title: string) => void }) {
  if (!rows.length) return <div className="eco-sp-empty">Нет выполненных услуг за выбранный период.</div>;
  return (
    <EcoTable className="eco-sp-table-wrap">
      <thead>
        <tr>
          <th>Услуга</th>
          <th>Операций</th>
          <th>Клиентов</th>
          <th>Выручка работ</th>
          <th>Связанные материалы</th>
          <th>Прибыль материалов</th>
          <th>К прошлому периоду</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td>
              <button type="button" className="eco-sp-row-title" onClick={() => onOpen(row.key, row.title)}>
                <strong>{row.title}</strong>
                <small>{serviceSubtitle(row) || row.metricCode}</small>
              </button>
            </td>
            <td><strong className="eco-sp-number">{number(row.operationsCount, 0)}</strong></td>
            <td>{number(row.clientsCount, 0)}</td>
            <td>{money(row.directRevenueCents)}</td>
            <td>{money(row.linkedRevenueCents)}</td>
            <td>
              {money(row.linkedGrossProfitCents)}
              {row.linkedMissingCostLines ? <small className="eco-sp-cell-note is-warning">Неполный cost snapshot</small> : null}
            </td>
            <td><Comparison value={row.comparison.operations} suffix=" опер." /></td>
            <td>
              <button type="button" className="eco-btn eco-btn--sm" onClick={() => onOpen(row.key, row.title)}>
                <Search className="eco-icon" aria-hidden />
                Отгрузки
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </EcoTable>
  );
}

function DetailPanel({ title, loading, error, details, onClose }: {
  title: string;
  loading: boolean;
  error: string;
  details: DetailPayload | null;
  onClose: () => void;
}) {
  return (
    <section className="eco-card eco-sp-detail" aria-live="polite">
      <header>
        <div>
          <span>Исходные данные</span>
          <h3>{title}</h3>
          {details ? <p>{details.total} строк в проведённых отгрузках</p> : null}
        </div>
        <button type="button" className="eco-btn eco-btn--sm" onClick={onClose} aria-label="Закрыть детализацию"><X className="eco-icon" aria-hidden /></button>
      </header>
      {loading ? <div className="eco-sp-empty">Загружаем отгрузки…</div> : null}
      {error ? <div className="eco-sp-inline-alert"><AlertTriangle className="eco-icon" aria-hidden />{error}</div> : null}
      {!loading && details ? (
        <EcoTable className="eco-sp-detail-table">
          <thead>
            <tr>
              <th>Дата</th>
              <th>Отгрузка</th>
              <th>Филиал / склад</th>
              <th>Клиент</th>
              <th>Позиция</th>
              <th>Кол-во</th>
              <th>Выручка</th>
              <th>Себестоимость</th>
              <th>Прибыль</th>
            </tr>
          </thead>
          <tbody>
            {details.rows.map((row) => (
              <tr key={row.positionId}>
                <td>{formatServiceDate(row.documentDate)}</td>
                <td><Link className="eco-sp-shipment-link" href={`/shipment/${encodeURIComponent(row.shipmentId)}`}>{row.shipmentName}<ExternalLink aria-hidden /></Link></td>
                <td>{row.branchName}<small className="eco-sp-cell-note">{row.storeName || "Склад не указан"}</small></td>
                <td>{row.clientName || "—"}</td>
                <td>{row.positionName}</td>
                <td>{row.baseQuantity == null ? number(row.quantity, 3) : quantity(row.baseQuantity, row.baseUnit || "PCS")}</td>
                <td>{money(row.revenueCents)}</td>
                <td>{money(row.costCents)}</td>
                <td>{money(row.grossProfitCents)}</td>
              </tr>
            ))}
          </tbody>
        </EcoTable>
      ) : null}
    </section>
  );
}

function ClassificationQueue({ data, filters, onSaved }: {
  data: SalesPerformanceAnalytics;
  filters: SalesFilters;
  onSaved: () => Promise<void>;
}) {
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");

  async function save(row: SalesPerformanceUnclassifiedRow) {
    const metricCode = selection[row.key];
    if (!metricCode) {
      setMessage("Выберите категорию для позиции.");
      return;
    }
    setSaving(row.key);
    setMessage("");
    const response = await fetch("/api/warehouse/analytics/sales-classification", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        metricCode,
        kind: row.kind,
      }),
    });
    const payload = await readJson<{ error?: string }>(response);
    if (!response.ok) {
      setMessage(payload?.error || "Не удалось сохранить классификацию.");
      setSaving("");
      return;
    }
    setMessage("Категория сохранена. Отчёт пересчитан.");
    await onSaved();
    setSaving("");
  }

  if (!data.unclassified.length) {
    return <div className="eco-sp-quality-ok"><CheckCircle2 aria-hidden />Все строки за период распределены по каноническим категориям.</div>;
  }

  return (
    <div className="eco-sp-stack">
      {!data.scope.canManageMappings ? (
        <div className="eco-sp-inline-alert"><AlertTriangle className="eco-icon" aria-hidden />Назначать категории можно в режиме конкретного филиала с правами владельца.</div>
      ) : null}
      {message ? <div className="eco-sp-inline-alert">{message}</div> : null}
      <EcoTable className="eco-sp-table-wrap">
        <thead>
          <tr>
            <th>Позиция</th>
            <th>Тип</th>
            <th>Строк / отгрузок</th>
            <th>Выручка</th>
            <th>Источник</th>
            <th>Назначить категорию</th>
          </tr>
        </thead>
        <tbody>
          {data.unclassified.map((row) => {
            const options = row.kind === "service" ? data.options.serviceMetrics : data.options.productMetrics;
            return (
              <tr key={row.key}>
                <td><strong>{row.name}</strong><small className="eco-sp-cell-note">{row.reason}</small></td>
                <td><EcoBadge tone={row.kind === "service" ? "info" : "neutral"}>{row.kind === "service" ? "Услуга" : "Товар"}</EcoBadge></td>
                <td>{row.linesCount} / {row.documentsCount}</td>
                <td>{money(row.revenueCents)}</td>
                <td><code>{row.sourceType}</code><small className="eco-sp-cell-note">{row.branchNames.join(", ")}</small></td>
                <td>
                  <div className="eco-sp-map-action">
                    <select
                      className="eco-input"
                      aria-label={`Категория для ${row.name}`}
                      value={selection[row.key] || ""}
                      onChange={(event) => setSelection((current) => ({ ...current, [row.key]: event.target.value }))}
                      disabled={!data.scope.canManageMappings || saving === row.key}
                    >
                      <option value="">Выбрать…</option>
                      {options.map((option) => <option key={option.code} value={option.code}>{option.title}</option>)}
                    </select>
                    <button type="button" className="eco-btn eco-btn--primary eco-btn--sm" onClick={() => void save(row)} disabled={!data.scope.canManageMappings || saving === row.key}>
                      {saving === row.key ? "Сохраняем…" : "Назначить"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </EcoTable>
      <p className="eco-sp-footnote">После подтверждения mapping применяется к тому же стабильному источнику в истории. Текущий фильтр: {filters.metricCode || "все категории"}.
      </p>
    </div>
  );
}

type PlanDraft = {
  targetCount: string;
  targetRevenueRubles: string;
  targetGrossProfitRubles: string;
  targetAttachRatePercent: string;
  expectedRevenuePerUnitRubles: string;
  expectedGrossProfitPerUnitRubles: string;
  note: string;
};

type PlanCatalogRow = {
  rowKey: string;
  metricCode: string;
  kind: "product" | "service";
  title: string;
  unit: string;
  aggregateType: SalesPerformancePlanFactRow["aggregateType"];
  procedure: SalesPerformancePlanFactRow["procedure"];
  configuration: SalesPerformancePlanFactRow["configuration"];
};

type PlanHistoryRow = {
  id: string;
  action: string;
  branchId: string | null;
  createdAt: string;
  metadata: unknown;
};

const emptyPlanDraft: PlanDraft = {
  targetCount: "",
  targetRevenueRubles: "",
  targetGrossProfitRubles: "",
  targetAttachRatePercent: "",
  expectedRevenuePerUnitRubles: "",
  expectedGrossProfitPerUnitRubles: "",
  note: "",
};

function draftFromPlan(row: SalesPerformancePlanFactRow): PlanDraft {
  return {
    targetCount: String(row.targetCount),
    targetRevenueRubles: row.targetRevenueCents == null ? "" : String(row.targetRevenueCents / 100),
    targetGrossProfitRubles: row.targetGrossProfitCents == null ? "" : String(row.targetGrossProfitCents / 100),
    targetAttachRatePercent: row.targetAttachRatePercent == null ? "" : String(row.targetAttachRatePercent),
    expectedRevenuePerUnitRubles: row.expectedRevenuePerUnitCents == null ? "" : String(row.expectedRevenuePerUnitCents / 100),
    expectedGrossProfitPerUnitRubles: row.expectedGrossProfitPerUnitCents == null ? "" : String(row.expectedGrossProfitPerUnitCents / 100),
    note: row.note ?? "",
  };
}

function previousMonth(month: string) {
  const date = new Date(`${month}-01T12:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString().slice(0, 7);
}

function planStatus(row: SalesPerformancePlanFactRow) {
  if (row.status === "completed") return { label: "План выполнен", tone: "success" as const };
  if (row.status === "on-pace") return { label: "По темпу", tone: "info" as const };
  if (row.status === "risk") return { label: "Риск невыполнения", tone: "warning" as const };
  return { label: "Недостаточно данных", tone: "neutral" as const };
}

function potentialBasisLabel(row: SalesPerformancePlanFactRow, kind: "revenue" | "profit") {
  const basis = kind === "revenue" ? row.potentialRevenueBasis : row.potentialGrossProfitBasis;
  if (basis.source === "PLAN") return "Ожидаемое значение из плана";
  if (basis.source === "MIXED") return `План + среднее за 90 дней · база ${number(basis.sampleUnits, 1)} ед.`;
  if (basis.source === "LAST_90_DAYS") return `Среднее за 90 дней · база ${number(basis.sampleUnits, 1)} ед.`;
  return "Недостаточно данных для точной оценки";
}

function PlanFactTable({ rows }: { rows: SalesPerformancePlanFactRow[] }) {
  if (!rows.length) return <div className="eco-sp-empty">На выбранный месяц планы пока не заданы.</div>;
  return (
    <EcoTable className="eco-sp-table-wrap eco-sp-plan-fact">
      <thead>
        <tr>
          <th>Категория</th>
          <th>Факт / план</th>
          <th>Выполнение</th>
          <th>Прогноз</th>
          <th>Осталось</th>
          <th>Нужный темп / раб. день</th>
          <th>Выручка факт / план</th>
          <th>Статус</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const status = planStatus(row);
          return (
            <tr key={row.rowKey}>
              <td>
                <span className="eco-sp-row-title">
                  <strong>{row.title}</strong>
                  <small>{row.kind === "service" ? servicePlanSubtitle(row) : row.metricCode}</small>
                </span>
              </td>
              <td><strong className="eco-sp-number">{quantity(row.actualCount, row.unit)}</strong><small className="eco-sp-cell-note">из {quantity(row.targetCount, row.unit)}</small></td>
              <td>
                <strong>{percent(row.completionPercent)}</strong>
                <span className="eco-sp-progress" aria-hidden><span style={{ width: `${Math.min(100, Math.max(0, row.completionPercent ?? 0))}%` }} /></span>
              </td>
              <td>
                {quantity(row.forecastCount, row.unit)}
                <small className={`eco-sp-cell-note ${row.forecastGap != null && row.forecastGap > 0 ? "is-warning" : ""}`}>
                  {row.forecastGap == null
                    ? "нет расчёта"
                    : row.forecastGap > 0
                      ? `прогнозируемый разрыв ${quantity(row.forecastGap, row.unit)}`
                      : `выше плана на ${quantity(Math.abs(row.forecastGap), row.unit)}`}
                  {row.forecastPreliminary ? " · предварительно" : ""}
                </small>
              </td>
              <td>{quantity(row.remainingToPlan, row.unit)}</td>
              <td>{quantity(row.requiredPerWorkingDay, row.unit)}</td>
              <td>{money(row.actualRevenueCents)}<small className="eco-sp-cell-note">из {money(row.targetRevenueCents)}</small></td>
              <td><EcoBadge tone={status.tone}>{status.label}</EcoBadge>{row.plannedBranches < row.totalBranches ? <small className="eco-sp-cell-note is-warning">План у {row.plannedBranches} из {row.totalBranches} филиалов</small> : null}</td>
            </tr>
          );
        })}
      </tbody>
    </EcoTable>
  );
}

function GrowthPanel({ data, onOpen, onExport }: {
  data: SalesPerformanceAnalytics;
  onOpen: (key: string, title: string) => void;
  onExport: () => void;
}) {
  if (!data.plan.available) {
    return <div className="eco-sp-empty">{data.plan.reason || "Возможности роста доступны для месячного плана."}</div>;
  }
  const growthRows = data.plan.rows.filter((row) => (row.remainingToPlan ?? 0) > 0);
  const forecastGap = data.plan.rows.reduce((sum, row) => sum + Math.max(0, row.forecastGap ?? 0), 0);
  return (
    <div className="eco-sp-stack">
      <div className="eco-sp-kpis">
        <EcoKpi label="Потенциал выручки до плана" value={money(data.plan.summary.potentialRevenueCents)} sub={`${data.plan.summary.potentialRows} категорий с резервом`} tone="success" />
        <EcoKpi label="Расчётный резерв прибыли" value={money(data.plan.summary.potentialGrossProfitCents)} sub={data.plan.summary.unavailableProfitRows ? `${data.plan.summary.unavailableProfitRows} строк без полной базы` : "себестоимость подтверждена"} tone={data.plan.summary.unavailableProfitRows ? "warning" : "success"} />
        <EcoKpi label="Прогнозируемый разрыв" value={number(forecastGap, 1)} sub="единиц по текущему темпу" tone={forecastGap > 0 ? "warning" : "neutral"} />
        <EcoKpi label="Резерв attach rate" value={`${data.plan.summary.attachOpportunityVisits} виз.`} sub={`потенциал прибыли ${money(data.plan.summary.attachOpportunityGrossProfitCents)}`} tone={data.plan.summary.attachOpportunityVisits ? "info" : "neutral"} />
      </div>

      <section className="eco-card eco-card--padded eco-sp-section">
        <div className="eco-card__head eco-card__head--plain">
          <div><h2>Потенциал до плана</h2><p>Оставшееся количество умножается на значение из плана, а при его отсутствии — на фактическое среднее за последние 90 дней.</p></div>
          <button type="button" className="eco-btn eco-btn--sm" onClick={onExport}><Download className="eco-icon" aria-hidden />CSV</button>
        </div>
        {growthRows.length ? (
          <EcoTable className="eco-sp-table-wrap eco-sp-growth-table">
            <thead><tr><th>Категория</th><th>Осталось до плана</th><th>Прогнозируемый разрыв</th><th>Выручка / ед.</th><th>Потенциал выручки</th><th>Прибыль / ед.</th><th>Потенциал прибыли</th><th /></tr></thead>
            <tbody>
              {growthRows.map((row) => (
                <tr key={row.rowKey}>
                  <td><button type="button" className="eco-sp-row-title" onClick={() => onOpen(row.rowKey, row.title)}><strong>{row.title}</strong><small>{row.kind === "service" ? servicePlanSubtitle(row) : row.metricCode}</small></button></td>
                  <td><strong className="eco-sp-number">{quantity(row.remainingToPlan, row.unit)}</strong><small className="eco-sp-cell-note">факт {quantity(row.actualCount, row.unit)} из {quantity(row.targetCount, row.unit)}</small></td>
                  <td>{row.forecastGap == null ? "—" : quantity(Math.max(0, row.forecastGap), row.unit)}{row.forecastPreliminary ? <small className="eco-sp-cell-note">Предварительный прогноз</small> : null}</td>
                  <td>{money(row.potentialRevenueBasis.averagePerUnitCents)}<small className="eco-sp-cell-note">{potentialBasisLabel(row, "revenue")}</small></td>
                  <td><strong className="eco-sp-growth-value">{money(row.potentialRevenueCents)}</strong></td>
                  <td>
                    {money(row.potentialGrossProfitBasis.averagePerUnitCents)}
                    <small className={`eco-sp-cell-note ${row.potentialGrossProfitCents == null ? "is-warning" : ""}`}>{potentialBasisLabel(row, "profit")}</small>
                    {row.potentialGrossProfitBasis.excludedMissingCostLines ? <small className="eco-sp-cell-note is-warning">Исключено без себестоимости: {row.potentialGrossProfitBasis.excludedMissingCostLines}</small> : null}
                  </td>
                  <td><strong className="eco-sp-growth-value">{money(row.potentialGrossProfitCents)}</strong></td>
                  <td><button type="button" className="eco-btn eco-btn--sm" onClick={() => onOpen(row.rowKey, row.title)}><Search className="eco-icon" aria-hidden />Отгрузки</button></td>
                </tr>
              ))}
            </tbody>
          </EcoTable>
        ) : <div className="eco-sp-quality-ok"><CheckCircle2 aria-hidden />По заданным количественным планам резерв уже закрыт.</div>}
        <p className="eco-sp-footnote eco-sp-growth-note">Это оценка потенциала, а не зафиксированная потеря. Исторические ставки рассчитаны по данным {formatServiceDate(data.period.dateTo)} и предшествующих 89 дней.</p>
      </section>

      <section className="eco-card eco-card--padded eco-sp-section">
        <div className="eco-card__head eco-card__head--plain"><div><h2>Attach opportunity фильтров</h2><p>Только distinct визиты с заменой моторного масла. Продажи фильтров без этой услуги показаны отдельно и не входят в долю.</p></div></div>
        {data.plan.attachOpportunities.length ? (
          <div className="eco-sp-attach-grid">
            {data.plan.attachOpportunities.map((row) => (
              <div key={row.metricCode} className="eco-sp-attach-row eco-sp-attach-row--opportunity">
                <div><Tags aria-hidden /><span><strong>{row.title}</strong><small>{row.attachedVisits} из {row.eligibleVisits} подходящих визитов · отдельно продано в {row.standaloneVisits}</small></span></div>
                <strong>{row.opportunityVisits} виз.</strong>
                <small>факт {percent(row.actualRatePercent)} · цель {percent(row.targetRatePercent)}</small>
                <p>Расчётный резерв роста прибыли: <strong>{money(row.opportunityGrossProfitCents)}</strong></p>
                <p>{row.grossProfitBasis.source === "LAST_90_DAYS" ? `Средняя прибыль на attach-продажу ${money(row.averageGrossProfitPerAttachedSaleCents)} · база ${row.grossProfitBasis.sampleUnits} виз.` : "Недостаточно визитов с полной себестоимостью для точной оценки прибыли."}</p>
              </div>
            ))}
          </div>
        ) : <div className="eco-sp-empty">Задайте целевой attach rate в плане воздушного или салонного фильтра.</div>}
      </section>
    </div>
  );
}

function PlanPanel({ data, onSaved, onExport }: { data: SalesPerformanceAnalytics; onSaved: () => Promise<void>; onExport: () => void }) {
  const [drafts, setDrafts] = useState<Record<string, PlanDraft>>({});
  const [expandedKey, setExpandedKey] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");
  const [history, setHistory] = useState<PlanHistoryRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const catalog = useMemo(() => {
    const rows: PlanCatalogRow[] = data.options.productMetrics.map((metric) => ({
      rowKey: `product:${metric.code}`,
      metricCode: metric.code,
      kind: "product",
      title: metric.title,
      unit: metric.unit,
      aggregateType: null,
      procedure: null,
      configuration: null,
    }));
    const serviceRowsByMetric = new Map<string, PlanCatalogRow[]>();
    for (const source of [...data.services, ...data.plan.rows.filter((row) => row.kind === "service")]) {
      const row: PlanCatalogRow = {
        rowKey: "key" in source ? source.key : source.rowKey,
        metricCode: source.metricCode,
        kind: "service",
        title: source.title,
        unit: "OPERATION",
        aggregateType: source.aggregateType,
        procedure: source.procedure,
        configuration: source.configuration,
      };
      const values = serviceRowsByMetric.get(row.metricCode) ?? [];
      if (!values.some((value) => value.rowKey === row.rowKey)) values.push(row);
      serviceRowsByMetric.set(row.metricCode, values);
    }
    for (const metric of data.options.serviceMetrics) {
      const existing = serviceRowsByMetric.get(metric.code);
      if (existing?.length) rows.push(...existing);
      else rows.push({
        rowKey: `service:${metric.code}:-:-:-`,
        metricCode: metric.code,
        kind: "service",
        title: metric.title,
        unit: metric.unit,
        aggregateType: null,
        procedure: null,
        configuration: null,
      });
    }
    return rows;
  }, [data]);

  const existingPlans = useMemo(() => new Map(data.plan.rows.map((row) => [row.rowKey, row])), [data.plan.rows]);

  function updateDraft(rowKey: string, field: keyof PlanDraft, value: string) {
    setDrafts((current) => ({
      ...current,
      [rowKey]: {
        ...(current[rowKey] ?? (existingPlans.get(rowKey) ? draftFromPlan(existingPlans.get(rowKey) as SalesPerformancePlanFactRow) : emptyPlanDraft)),
        [field]: value,
      },
    }));
  }

  function optionalCents(value: string) {
    return value.trim() === "" ? null : Math.round(Number(value) * 100);
  }

  async function save(row: PlanCatalogRow) {
    const draft = drafts[row.rowKey] ?? emptyPlanDraft;
    if (draft.targetCount.trim() === "" || !Number.isFinite(Number(draft.targetCount)) || Number(draft.targetCount) < 0) {
      setMessage("Укажите неотрицательный план по количеству.");
      return;
    }
    setSavingKey(row.rowKey);
    setMessage("");
    const response = await fetch("/api/warehouse/analytics/sales-plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchId: data.scope.branchIds[0],
        month: data.plan.month,
        plans: [{
          rowKey: row.rowKey,
          targetCount: Number(draft.targetCount),
          targetRevenueCents: optionalCents(draft.targetRevenueRubles),
          targetGrossProfitCents: optionalCents(draft.targetGrossProfitRubles),
          targetAttachRateBasisPoints: draft.targetAttachRatePercent.trim() === "" ? null : Math.round(Number(draft.targetAttachRatePercent) * 100),
          expectedRevenuePerUnitCents: optionalCents(draft.expectedRevenuePerUnitRubles),
          expectedGrossProfitPerUnitCents: optionalCents(draft.expectedGrossProfitPerUnitRubles),
          note: draft.note,
        }],
      }),
    });
    const payload = await readJson<{ error?: string }>(response);
    if (!response.ok) setMessage(payload?.error || "Не удалось сохранить план.");
    else {
      setMessage(`План «${row.title}» сохранён.`);
      await onSaved();
    }
    setSavingKey("");
  }

  async function copyPrevious() {
    if (!data.plan.month || !data.scope.branchIds[0]) return;
    setSavingKey("copy");
    setMessage("");
    const response = await fetch("/api/warehouse/analytics/sales-plans/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceBranchId: data.scope.branchIds[0],
        sourceMonth: previousMonth(data.plan.month),
        targetBranchId: data.scope.branchIds[0],
        targetMonth: data.plan.month,
      }),
    });
    const payload = await readJson<{ error?: string }>(response);
    if (!response.ok) setMessage(payload?.error || "Не удалось скопировать план.");
    else {
      setMessage("Планы прошлого месяца скопированы.");
      await onSaved();
    }
    setSavingKey("");
  }

  async function toggleHistory() {
    const nextOpen = !historyOpen;
    setHistoryOpen(nextOpen);
    if (!nextOpen || history.length || !data.plan.month) return;
    const params = new URLSearchParams({ month: data.plan.month, includeHistory: "1" });
    const response = await fetch(`/api/warehouse/analytics/sales-plans?${params}`, { cache: "no-store" });
    const payload = await readJson<{ error?: string; history?: PlanHistoryRow[] }>(response);
    if (!response.ok) setMessage(payload?.error || "Не удалось загрузить историю.");
    else setHistory(payload?.history ?? []);
  }

  if (!data.plan.available) {
    return <div className="eco-sp-empty">{data.plan.reason || "План/факт недоступен для выбранного периода."}</div>;
  }

  const calendar = data.plan.calendars[0];
  return (
    <div className="eco-sp-stack">
      <div className="eco-sp-kpis">
        <EcoKpi label="Категорий с планом" value={String(data.plan.summary.plannedRows)} sub={`${data.plan.summary.plannedBranches} из ${data.plan.summary.totalBranches} филиалов`} tone="info" />
        <EcoKpi label="План выполнен" value={String(data.plan.summary.completedRows)} sub="категорий достигли цели" tone="success" />
        <EcoKpi label="Идут по темпу" value={String(data.plan.summary.onPaceRows)} sub="прогноз не ниже плана" tone="info" />
        <EcoKpi label="В зоне риска" value={String(data.plan.summary.riskRows)} sub={calendar ? `${calendar.remainingWorkingDays} раб. дней осталось` : "по выбранному периоду"} tone={data.plan.summary.riskRows ? "warning" : "neutral"} />
      </div>

      <section className="eco-card eco-card--padded eco-sp-section">
        <div className="eco-card__head eco-card__head--plain">
          <div><h2>План / факт за {data.plan.month}</h2><p>Прогноз рассчитан по фактическому темпу каждого филиала и его рабочему календарю.</p></div>
          <div className="eco-sp-head-actions">
            <button type="button" className="eco-btn eco-btn--sm" onClick={onExport}><Download className="eco-icon" aria-hidden />CSV</button>
            <button type="button" className="eco-btn eco-btn--sm" onClick={() => void toggleHistory()}><History className="eco-icon" aria-hidden />История</button>
          </div>
        </div>
        <PlanFactTable rows={data.plan.rows} />
        {data.plan.calendars.length ? (
          <p className="eco-sp-footnote eco-sp-calendar-note">
            Рабочие дни: {data.plan.calendars.map((item) => `${item.branchName} — ${item.elapsedWorkingDays} из ${item.totalWorkingDays}${item.source === "DEFAULT_MONDAY_SATURDAY" ? " (пн–сб по умолчанию)" : ""}`).join("; ")}.
          </p>
        ) : null}
      </section>

      {historyOpen ? (
        <section className="eco-card eco-card--padded eco-sp-section">
          <div className="eco-card__head eco-card__head--plain"><div><h2>История изменений</h2><p>Последние операции с планом выбранного месяца.</p></div></div>
          {history.length ? <div className="eco-sp-history">{history.map((row) => <div key={row.id}><strong>{row.action === "SALES_PLAN_CREATED" ? "План создан" : row.action === "SALES_PLAN_COPIED" ? "Планы скопированы" : "План изменён"}</strong><span>{formatServiceDateTime(row.createdAt)}</span></div>)}</div> : <div className="eco-sp-empty">Изменений пока нет.</div>}
        </section>
      ) : null}

      {data.plan.canEdit ? (
        <section className="eco-card eco-card--padded eco-sp-section">
          <div className="eco-card__head eco-card__head--plain">
            <div><h2>Планы филиала</h2><p>Количество обязательно. Финансовые цели и ожидаемые значения можно заполнить отдельно.</p></div>
            <button type="button" className="eco-btn eco-btn--sm" onClick={() => void copyPrevious()} disabled={savingKey === "copy"}><Copy className="eco-icon" aria-hidden />{savingKey === "copy" ? "Копируем…" : "Скопировать прошлый месяц"}</button>
          </div>
          {message ? <div className="eco-sp-inline-alert" aria-live="polite">{message}</div> : null}
          <div className="eco-sp-plan-editor">
            {catalog.map((row) => {
              const existing = existingPlans.get(row.rowKey);
              const draft = drafts[row.rowKey] ?? (existing ? draftFromPlan(existing) : emptyPlanDraft);
              const expanded = expandedKey === row.rowKey;
              return (
                <article key={row.rowKey} className="eco-sp-plan-edit-row">
                  <div className="eco-sp-plan-edit-main">
                    <div><strong>{row.title}</strong><small>{row.kind === "service" ? servicePlanSubtitle(row as SalesPerformancePlanFactRow) : row.metricCode}</small></div>
                    <label><span>План, {row.unit === "LITER" ? "л" : row.unit === "OPERATION" ? "операций" : "шт."}</span><input className="eco-input" type="number" min="0" step="0.001" value={draft.targetCount} onChange={(event) => updateDraft(row.rowKey, "targetCount", event.target.value)} /></label>
                    <button type="button" className="eco-btn eco-btn--sm" onClick={() => setExpandedKey(expanded ? "" : row.rowKey)}>{expanded ? <ChevronUp className="eco-icon" aria-hidden /> : <ChevronDown className="eco-icon" aria-hidden />}Дополнительно</button>
                    <button type="button" className="eco-btn eco-btn--primary eco-btn--sm" onClick={() => void save(row)} disabled={savingKey === row.rowKey}><Save className="eco-icon" aria-hidden />{savingKey === row.rowKey ? "Сохраняем…" : "Сохранить"}</button>
                  </div>
                  {expanded ? (
                    <div className="eco-sp-plan-edit-extra">
                      <label><span>Выручка, ₽</span><input className="eco-input" type="number" min="0" step="0.01" value={draft.targetRevenueRubles} onChange={(event) => updateDraft(row.rowKey, "targetRevenueRubles", event.target.value)} /></label>
                      <label><span>Валовая прибыль, ₽</span><input className="eco-input" type="number" min="0" step="0.01" value={draft.targetGrossProfitRubles} onChange={(event) => updateDraft(row.rowKey, "targetGrossProfitRubles", event.target.value)} /></label>
                      {row.kind === "product" && ["AIR_FILTER", "CABIN_FILTER"].includes(row.metricCode) ? <label><span>Attach rate, %</span><input className="eco-input" type="number" min="0" max="100" step="0.1" value={draft.targetAttachRatePercent} onChange={(event) => updateDraft(row.rowKey, "targetAttachRatePercent", event.target.value)} /></label> : null}
                      <label><span>Выручка / ед., ₽</span><input className="eco-input" type="number" min="0" step="0.01" value={draft.expectedRevenuePerUnitRubles} onChange={(event) => updateDraft(row.rowKey, "expectedRevenuePerUnitRubles", event.target.value)} /></label>
                      <label><span>Прибыль / ед., ₽</span><input className="eco-input" type="number" min="0" step="0.01" value={draft.expectedGrossProfitPerUnitRubles} onChange={(event) => updateDraft(row.rowKey, "expectedGrossProfitPerUnitRubles", event.target.value)} /></label>
                      <label className="eco-sp-plan-note"><span>Комментарий</span><input className="eco-input" value={draft.note} maxLength={2000} onChange={(event) => updateDraft(row.rowKey, "note", event.target.value)} /></label>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="eco-sp-inline-alert"><AlertTriangle className="eco-icon" aria-hidden />Редактирование доступно владельцу или управляющему в режиме конкретного филиала.</div>
      )}
    </div>
  );
}

export default function SalesPerformancePanel() {
  const [filters, setFilters] = useState<SalesFilters>(defaultFilters);
  const [data, setData] = useState<SalesPerformanceAnalytics | null>(null);
  const [activeTab, setActiveTab] = useState<SalesTab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detailTitle, setDetailTitle] = useState("");
  const [detailKey, setDetailKey] = useState("");
  const [details, setDetails] = useState<DetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const load = useCallback(async (nextFilters: SalesFilters, refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/warehouse/analytics/sales-performance?${buildParams(nextFilters, refresh)}`, { cache: "no-store" });
      const payload = await readJson<SalesPerformanceAnalytics & { error?: string }>(response);
      if (!response.ok || !payload) throw new Error(payload?.error || "Не удалось рассчитать продажи и услуги");
      setData(payload);
      setDetails(null);
      setDetailKey("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось рассчитать продажи и услуги");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(defaultFilters);
  }, [load]);

  const metricOptions = useMemo(() => {
    if (!data) return [];
    return [...data.options.productMetrics, ...data.options.serviceMetrics];
  }, [data]);

  function updateFilter<K extends keyof SalesFilters>(key: K, value: SalesFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void load(filters, true);
  }

  async function openDetails(rowKey: string, title: string) {
    setDetailKey(rowKey);
    setDetailTitle(title);
    setDetails(null);
    setDetailError("");
    setDetailLoading(true);
    const params = buildParams(filters);
    params.set("rowKey", rowKey);
    const response = await fetch(`/api/warehouse/analytics/sales-performance/details?${params}`, { cache: "no-store" });
    const payload = await readJson<DetailPayload & { error?: string }>(response);
    if (!response.ok || !payload) setDetailError(payload?.error || "Не удалось загрузить отгрузки");
    else setDetails(payload);
    setDetailLoading(false);
  }

  function exportTable(table: "products" | "services" | "unclassified" | "plan" | "growth") {
    const params = buildParams(filters);
    params.set("table", table);
    window.location.href = `/api/warehouse/analytics/sales-performance/export?${params}`;
  }

  const productCoverage = data?.summary.productLines
    ? (data.summary.classifiedProductLines / data.summary.productLines) * 100
    : 100;
  const serviceCoverage = data?.summary.serviceLines
    ? (data.summary.classifiedServiceLines / data.summary.serviceLines) * 100
    : 100;
  const totalLines = (data?.summary.productLines ?? 0) + (data?.summary.serviceLines ?? 0);
  const totalCoverage = totalLines
    ? (((data?.summary.classifiedProductLines ?? 0) + (data?.summary.classifiedServiceLines ?? 0)) / totalLines) * 100
    : 100;

  return (
    <div className="eco-sp-shell">
      <section className="eco-card eco-card--padded eco-sp-intro">
        <div>
          <p className="eco-page-kicker">Фактические продажи</p>
          <h2>Товары и услуги считаются раздельно</h2>
          <p>Только актуальное проведённое состояние отгрузок; без черновиков и дублей из ревизий.</p>
        </div>
        {data ? (
          <div className="eco-sp-scope">
            <EcoBadge tone={data.scope.mode === "all" ? "info" : "neutral"}>{data.scope.mode === "all" ? "Все доступные филиалы" : data.scope.branchNames.join(", ")}</EcoBadge>
            <span>{formatServiceDate(data.period.dateFrom)} — {formatServiceDate(data.period.dateTo)}</span>
            <small>Сравнение: {formatServiceDate(data.period.comparisonDateFrom)} — {formatServiceDate(data.period.comparisonDateTo)}</small>
          </div>
        ) : null}
      </section>

      <form className="eco-card eco-card--padded eco-sp-filters" onSubmit={submit}>
        <label className="eco-field">
          <span>Период</span>
          <select className="eco-input" value={filters.period} onChange={(event) => updateFilter("period", event.target.value)}>
            {periodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
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
        <label className="eco-field eco-sp-metric-filter">
          <span>Категория</span>
          <select className="eco-input" value={filters.metricCode} onChange={(event) => updateFilter("metricCode", event.target.value)}>
            <option value="">Все категории</option>
            {metricOptions.map((option) => <option key={option.code} value={option.code}>{option.title}</option>)}
          </select>
        </label>
        <button type="submit" className="eco-btn eco-btn--primary" disabled={loading}>
          <Search className="eco-icon" aria-hidden />
          Показать
        </button>
        <button type="button" className="eco-btn" onClick={() => void load(filters, true)} disabled={loading}>
          <RefreshCw className={`eco-icon ${loading ? "is-spin" : ""}`} aria-hidden />
          Обновить
        </button>
      </form>

      {error ? <div className="eco-sp-alert"><AlertTriangle className="eco-icon" aria-hidden />{error}</div> : null}
      {loading && !data ? <div className="eco-sp-empty">Считаем продажи и услуги…</div> : null}

      {data ? (
        <>
          <nav className="eco-tabs eco-sp-tabs" aria-label="Разделы продаж и плана">
            {([
              ["overview", "Обзор"],
              ["products", "Категории товаров"],
              ["services", "Услуги"],
              ["plan", `План продаж (${data.plan.summary.plannedRows})`],
              ["growth", "Возможности роста"],
              ["classification", `Не распределено (${data.unclassified.length})`],
            ] as Array<[SalesTab, string]>).map(([id, label]) => (
              <button key={id} type="button" className={`eco-tab ${activeTab === id ? "is-active" : ""}`} onClick={() => setActiveTab(id)}>{label}</button>
            ))}
          </nav>

          {data.warnings.map((warning) => <div key={warning} className="eco-sp-alert"><AlertTriangle className="eco-icon" aria-hidden />{warning}</div>)}

          {activeTab === "overview" ? (
            <div className="eco-sp-stack">
              <div className="eco-sp-kpis">
                <EcoKpi label="Выручка" value={money(data.summary.revenueCents)} sub={`${data.summary.revenueDeltaPercent == null ? "нет базы" : `${data.summary.revenueDeltaPercent > 0 ? "+" : ""}${percent(data.summary.revenueDeltaPercent)}`} к прошлому периоду`} tone="rust" />
                <EcoKpi label="Валовая прибыль" value={money(data.summary.grossProfitCents)} sub={data.summary.missingCostLines ? `${data.summary.missingCostLines} строк без cost snapshot` : "Себестоимость полная"} tone={data.summary.missingCostLines ? "warning" : "success"} />
                <EcoKpi label="Отгрузки / клиенты" value={`${data.summary.documentsCount} / ${data.summary.clientsCount}`} sub={`${data.summary.classifiedOperationsCount} сервисных операций`} tone="info" />
                <EcoKpi label="Качество классификации" value={percent(totalCoverage)} sub={`товары ${percent(productCoverage)} · услуги ${percent(serviceCoverage)}`} tone={data.summary.unclassifiedLines ? "warning" : "success"} />
              </div>

              <section className="eco-card eco-card--padded eco-sp-section">
                <div className="eco-card__head eco-card__head--plain">
                  <div><h2>Ключевые товарные категории</h2><p>Физические товары и литры — отдельно от работ.</p></div>
                  <button type="button" className="eco-btn eco-btn--sm" onClick={() => exportTable("products")}><Download className="eco-icon" aria-hidden />CSV</button>
                </div>
                <ProductRows rows={data.products.filter((row) => row.quantity !== 0 || row.revenueCents !== 0).slice(0, 8)} onOpen={(key, title) => void openDetails(key, title)} />
              </section>

              <section className="eco-card eco-card--padded eco-sp-section">
                <div className="eco-card__head eco-card__head--plain">
                  <div><h2>Ключевые услуги</h2><p>Одна операция — distinct отгрузка + услуга + процедура/конфигурация.</p></div>
                  <button type="button" className="eco-btn eco-btn--sm" onClick={() => exportTable("services")}><Download className="eco-icon" aria-hidden />CSV</button>
                </div>
                <ServiceRows rows={data.services.filter((row) => row.operationsCount || row.directRevenueCents).slice(0, 8)} onOpen={(key, title) => void openDetails(key, title)} />
              </section>

              <section className="eco-card eco-card--padded eco-sp-section">
                <div className="eco-card__head eco-card__head--plain"><div><h2>Attach rate фильтров</h2><p>Доля distinct отгрузок с фильтром среди отгрузок с заменой моторного масла.</p></div></div>
                <div className="eco-sp-attach-grid">
                  {data.attachRates.map((row) => (
                    <div key={row.metricCode} className="eco-sp-attach-row">
                      <div><Tags aria-hidden /><span><strong>{row.title}</strong><small>{row.attachedVisits} из {row.denominatorVisits} визитов · {row.standaloneVisits} продано отдельно</small></span></div>
                      <strong>{percent(row.ratePercent)}</strong>
                      <small>{row.previousRatePercent == null || row.ratePercent == null ? "Нет сравнения" : `${row.ratePercent - row.previousRatePercent > 0 ? "+" : ""}${number(row.ratePercent - row.previousRatePercent, 1)} п.п.`}</small>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {activeTab === "products" ? (
            <section className="eco-card eco-card--padded eco-sp-section">
              <div className="eco-card__head eco-card__head--plain"><div><h2>Категории товаров</h2><p>Количество, документы, выручка и историческая себестоимость.</p></div><button type="button" className="eco-btn eco-btn--sm" onClick={() => exportTable("products")}><Download className="eco-icon" aria-hidden />CSV</button></div>
              <ProductRows rows={data.products} onOpen={(key, title) => void openDetails(key, title)} />
            </section>
          ) : null}

          {activeTab === "services" ? (
            <section className="eco-card eco-card--padded eco-sp-section">
              <div className="eco-card__head eco-card__head--plain"><div><h2>Сервисные операции</h2><p>Работы и связанные материалы не смешиваются в одной сумме.</p></div><button type="button" className="eco-btn eco-btn--sm" onClick={() => exportTable("services")}><Download className="eco-icon" aria-hidden />CSV</button></div>
              <ServiceRows rows={data.services} onOpen={(key, title) => void openDetails(key, title)} />
            </section>
          ) : null}

          {activeTab === "plan" ? <PlanPanel data={data} onSaved={() => load(filters, true)} onExport={() => exportTable("plan")} /> : null}

          {activeTab === "growth" ? <GrowthPanel data={data} onOpen={(key, title) => void openDetails(key, title)} onExport={() => exportTable("growth")} /> : null}

          {activeTab === "classification" ? (
            <section className="eco-card eco-card--padded eco-sp-section">
              <div className="eco-card__head eco-card__head--plain"><div><h2>Не распределено по категориям</h2><p>Позиции не скрываются в «Другое». Владелец может один раз закрепить стабильный mapping.</p></div><button type="button" className="eco-btn eco-btn--sm" onClick={() => exportTable("unclassified")}><Download className="eco-icon" aria-hidden />CSV</button></div>
              <ClassificationQueue data={data} filters={filters} onSaved={() => load(filters, true)} />
            </section>
          ) : null}

          {detailKey ? <DetailPanel title={detailTitle} loading={detailLoading} error={detailError} details={details} onClose={() => { setDetailKey(""); setDetails(null); }} /> : null}

          <footer className="eco-sp-updated">Рассчитано {formatServiceDateTime(data.calculatedAt)} · кеш {data.cacheTtlSeconds} сек. · {data.scope.branchNames.join(", ")}</footer>
        </>
      ) : null}
    </div>
  );
}
