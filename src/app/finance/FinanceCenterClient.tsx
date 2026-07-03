"use client";

import {
  AlertTriangle,
  BarChart3,
  Calculator,
  CheckCircle2,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Landmark,
  Printer,
  RefreshCw,
  Settings,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { FinanceCenterResult, FinanceMetric, FinanceMode, FinanceTabId } from "@/lib/finance-center";
import { formatServiceDate, formatServiceDateTime, toServiceDateInput } from "@/lib/date-time";

type FinanceCenterClientProps = {
  initialTab?: FinanceTabId;
};

type LoadState = "idle" | "loading" | "error";

const MODE_LABELS: Array<{ id: FinanceMode; label: string; description: string }> = [
  { id: "manager", label: "Управляющий", description: "Операционная картина точки" },
  { id: "cfo", label: "Финансовый директор", description: "P&L, cashflow, расходы и контроль" },
  { id: "owner", label: "Владелец", description: "Полная управленческая прибыль и решения" },
];

const ALL_TABS: Array<{ id: FinanceTabId; label: string; manager?: boolean }> = [
  { id: "overview", label: "Обзор", manager: true },
  { id: "pnl", label: "Прибыль / P&L" },
  { id: "cashflow", label: "Деньги / Cashflow", manager: true },
  { id: "expenses", label: "Расходы", manager: true },
  { id: "taxes", label: "Налоги" },
  { id: "acquiring", label: "Эквайринг" },
  { id: "payroll", label: "Зарплата", manager: true },
  { id: "purchases", label: "Закупки и поставщики" },
  { id: "breakEven", label: "Точка безубыточности" },
  { id: "planFact", label: "План / факт", manager: true },
  { id: "documents", label: "Документы", manager: true },
  { id: "problems", label: "Проблемы учёта", manager: true },
  { id: "export", label: "Экспорт", manager: true },
  { id: "settings", label: "Настройки" },
];

function todayInput() {
  return toServiceDateInput(new Date());
}

function monthStartInput() {
  const now = new Date();
  return toServiceDateInput(new Date(now.getFullYear(), now.getMonth(), 1));
}

function formatMoney(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "Не настроено";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽`;
}

function formatNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
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

function buildExport(data: FinanceCenterResult, tab: FinanceTabId) {
  if (tab === "cashflow") {
    return [
      ["Группа", "Показатель", "Сумма", "Пояснение"],
      ...data.cashflow.lines.map((row) => [row.group, row.label, row.amount, row.description]),
    ];
  }
  if (tab === "expenses") {
    return [
      ["Дата", "Номер", "Категория", "Контрагент", "Сумма", "Влияет на прибыль", "Влияет на деньги"],
      ...data.expenses.rows.map((row) => [row.date, row.number, row.categoryName, row.counterparty, row.amount, row.affectsProfit ? "да" : "нет", row.affectsCashflow ? "да" : "нет"]),
    ];
  }
  if (tab === "documents") {
    return [
      ["Дата", "Тип", "Номер", "Контрагент", "Категория", "Сумма", "Статус", "Прибыль", "Cashflow"],
      ...data.documents.map((row) => [row.date, row.type, row.number, row.counterparty, row.category, row.amount, row.status, row.affectsProfit ? "да" : "нет", row.affectsCashflow ? "да" : "нет"]),
    ];
  }
  return [
    ["Показатель", "Сумма", "% от выручки", "Изменение", "Пояснение"],
    ...data.pnl.rows.map((row) => [row.label, row.amount ?? "", row.displayRatio, row.displayChange, row.description]),
  ];
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    unpaid: "Не оплачен",
    partial: "Частично",
    paid: "Оплачен",
    overdue: "Просрочен",
    posted: "Проведён",
    awaiting: "Ожидает",
    settled: "Зачислено",
    mismatch: "Расхождение",
    ok: "Ок",
    missing_cost: "Нет себестоимости",
    negative_margin: "Минусовая маржа",
    writeoff: "Списание",
    receipt: "Приёмка",
  };
  return map[status] ?? status;
}

function FinanceKpi({ metric, onOpen }: { metric: FinanceMetric; onOpen: (tab: FinanceTabId) => void }) {
  const body = (
    <>
      <span>{metric.label}</span>
      <strong>{metric.display}</strong>
      <small>{metric.sub}</small>
      {metric.tab && <em>Открыть расшифровку</em>}
    </>
  );
  if (metric.tab) {
    return (
      <button type="button" className={`eco-fc-kpi is-${metric.tone}`} onClick={() => onOpen(metric.tab!)}>
        {body}
      </button>
    );
  }
  return <article className={`eco-fc-kpi is-${metric.tone}`}>{body}</article>;
}

function SectionHead({
  title,
  text,
  icon,
}: {
  title: string;
  text?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="eco-fc-section-head">
      <div>
        <h2>{title}</h2>
        {text && <p>{text}</p>}
      </div>
      {icon}
    </div>
  );
}

function BoolMark({ value }: { value: boolean }) {
  return <span className={`eco-fc-bool ${value ? "is-yes" : "is-no"}`}>{value ? "Да" : "Нет"}</span>;
}

export default function FinanceCenterClient({ initialTab = "overview" }: FinanceCenterClientProps) {
  const [dateFrom, setDateFrom] = useState(monthStartInput());
  const [dateTo, setDateTo] = useState(todayInput());
  const [organizationId, setOrganizationId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [calculationMode, setCalculationMode] = useState<"accrual" | "payment">("accrual");
  const [mode, setMode] = useState<FinanceMode>("owner");
  const [activeTab, setActiveTab] = useState<FinanceTabId>(initialTab);
  const [data, setData] = useState<FinanceCenterResult | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState("");

  const tabs = useMemo(
    () => ALL_TABS.filter((tab) => mode !== "manager" || tab.manager),
    [mode]
  );

  const selectedMode = MODE_LABELS.find((item) => item.id === mode) ?? MODE_LABELS[0];

  async function load(nextAction: "load" | "recalculate" = "load") {
    setState("loading");
    setError("");
    const params = new URLSearchParams({ dateFrom, dateTo, calculationMode });
    if (organizationId) params.set("organizationId", organizationId);
    if (warehouseId) params.set("warehouseId", warehouseId);
    try {
      const res = await fetch(`/api/finance/${nextAction === "recalculate" ? "recalculate" : "overview"}?${params.toString()}`, {
        method: nextAction === "recalculate" ? "POST" : "GET",
        cache: "no-store",
      });
      const json = await res.json() as FinanceCenterResult | { overview?: FinanceCenterResult; error?: string };
      if (!res.ok) throw new Error("error" in json ? json.error : "Не удалось загрузить финансовый центр");
      setData("overview" in json && json.overview ? json.overview : json as FinanceCenterResult);
      setState("idle");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mode === "manager" && !tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("overview");
    }
  }, [activeTab, mode, tabs]);

  function applyPreset(preset: "today" | "month" | "prevMonth" | "30d") {
    const now = new Date();
    if (preset === "today") {
      const value = toServiceDateInput(now);
      setDateFrom(value);
      setDateTo(value);
      return;
    }
    if (preset === "month") {
      setDateFrom(toServiceDateInput(new Date(now.getFullYear(), now.getMonth(), 1)));
      setDateTo(toServiceDateInput(now));
      return;
    }
    if (preset === "prevMonth") {
      setDateFrom(toServiceDateInput(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setDateTo(toServiceDateInput(new Date(now.getFullYear(), now.getMonth(), 0)));
      return;
    }
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    setDateFrom(toServiceDateInput(start));
    setDateTo(toServiceDateInput(now));
  }

  function exportCurrent(format: "csv" | "xls") {
    if (!data) return;
    const rows = buildExport(data, activeTab);
    if (format === "csv") {
      downloadTextFile(
        `finance-${activeTab}-${data.period.dateFrom}-${data.period.dateTo}.csv`,
        `\ufeff${rows.map((row) => row.map(csvCell).join(";")).join("\n")}`,
        "text/csv;charset=utf-8"
      );
      return;
    }
    downloadTextFile(
      `finance-${activeTab}-${data.period.dateFrom}-${data.period.dateTo}.xls`,
      `\ufeff<table>${rows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`).join("")}</table>`,
      "application/vnd.ms-excel;charset=utf-8"
    );
  }

  return (
    <div className="eco-fc">
      <header className="eco-fc-head">
        <div>
          <div className="eco-page-kicker">Финансы / Финансовый центр</div>
          <h1 className="eco-page-title">Финансовый центр</h1>
          <p className="eco-page-subtitle">
            Управленческая прибыль, движение денег, расходы, зарплата, эквайринг, налоги, закупки и точка безубыточности в одном рабочем разделе.
          </p>
        </div>
        <div className="eco-fc-head-actions">
          <button type="button" className="eco-btn eco-btn--primary" onClick={() => void load("recalculate")} disabled={state === "loading"}>
            <Calculator className="eco-icon" aria-hidden />
            Пересчитать
          </button>
          <button type="button" className="eco-btn" onClick={() => exportCurrent("csv")} disabled={!data}>
            <Download className="eco-icon" aria-hidden />
            CSV
          </button>
          <button type="button" className="eco-btn" onClick={() => exportCurrent("xls")} disabled={!data}>
            <FileSpreadsheet className="eco-icon" aria-hidden />
            Excel
          </button>
          <button type="button" className="eco-btn eco-btn--ghost" onClick={() => window.print()} disabled={!data}>
            <Printer className="eco-icon" aria-hidden />
            Печать
          </button>
        </div>
      </header>

      <section className="eco-fc-modebar">
        <div className="eco-fc-modebar__copy">
          <strong>{selectedMode.label}</strong>
          <span>{selectedMode.description}</span>
        </div>
        <div className="eco-fc-segment" role="tablist" aria-label="Режим просмотра">
          {MODE_LABELS.map((item) => (
            <button key={item.id} type="button" className={mode === item.id ? "is-active" : ""} onClick={() => setMode(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <form
        className="eco-fc-filters"
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
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
            {data?.filters.organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>{organization.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Склад / точка</span>
          <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
            <option value="">Все точки</option>
            {data?.filters.warehouses
              .filter((warehouse) => !organizationId || warehouse.organizationId === organizationId)
              .map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
              ))}
          </select>
        </label>
        <label>
          <span>Режим расчёта</span>
          <select value={calculationMode} onChange={(event) => setCalculationMode(event.target.value as "accrual" | "payment")}>
            <option value="accrual">По начислению</option>
            <option value="payment">По оплате</option>
          </select>
        </label>
        <div className="eco-fc-filter-actions">
          <button type="button" onClick={() => applyPreset("today")}>Сегодня</button>
          <button type="button" onClick={() => applyPreset("month")}>Текущий месяц</button>
          <button type="button" onClick={() => applyPreset("prevMonth")}>Прошлый месяц</button>
          <button type="button" onClick={() => applyPreset("30d")}>30 дней</button>
          <button type="submit" className="eco-btn eco-btn--primary" disabled={state === "loading"}>
            <RefreshCw className="eco-icon" aria-hidden />
            Обновить
          </button>
        </div>
      </form>

      {state === "loading" && (
        <div className="eco-fc-progress" role="status">
          <RefreshCw className="eco-icon" aria-hidden />
          Считаем финансы без смешивания прибыли и денег…
        </div>
      )}

      {state === "error" && (
        <section className="eco-fc-state is-error">
          <AlertTriangle aria-hidden />
          <h2>Не удалось загрузить финансовый центр</h2>
          <p>{error}</p>
          <button type="button" className="eco-btn eco-btn--primary" onClick={() => void load()}>Повторить</button>
        </section>
      )}

      {data && (
        <>
          <section className="eco-fc-source">
            <span>Период {formatDate(data.period.dateFrom)} — {formatDate(data.period.dateTo)}</span>
            <span>Режим: {data.period.calculationMode === "payment" ? "по оплате" : "по начислению"}</span>
            <strong>Обновлено {formatDateTime(data.period.calculatedAt)}</strong>
            <em>{data.period.sourceNote}</em>
          </section>

          <section className="eco-fc-kpis">
            {(mode === "manager" ? data.managerMetrics : data.metrics).map((metric) => (
              <FinanceKpi key={metric.id} metric={metric} onOpen={setActiveTab} />
            ))}
          </section>

          {data.problems.some((problem) => problem.severity === "danger") && (
            <section className="eco-fc-alert">
              <AlertTriangle aria-hidden />
              <div>
                <strong>Есть критичные проблемы учёта</strong>
                <p>До закрытия периода нужно исправить налоги, себестоимость или некатегоризированные операции.</p>
              </div>
              <button type="button" className="eco-btn eco-btn--primary" onClick={() => setActiveTab("problems")}>Показать</button>
            </section>
          )}

          <nav className="eco-fc-tabs" aria-label="Вкладки финансового центра">
            {tabs.map((tab) => (
              <button key={tab.id} type="button" className={activeTab === tab.id ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </nav>

          {activeTab === "overview" && <OverviewTab data={data} onTab={setActiveTab} mode={mode} />}
          {activeTab === "pnl" && <PnlTab data={data} />}
          {activeTab === "cashflow" && <CashflowTab data={data} />}
          {activeTab === "expenses" && <ExpensesTab data={data} />}
          {activeTab === "taxes" && <TaxesTab data={data} />}
          {activeTab === "acquiring" && <AcquiringTab data={data} />}
          {activeTab === "payroll" && <PayrollTab data={data} />}
          {activeTab === "purchases" && <PurchasesTab data={data} />}
          {activeTab === "breakEven" && <BreakEvenTab data={data} />}
          {activeTab === "planFact" && <PlanFactTab data={data} />}
          {activeTab === "documents" && <DocumentsTab data={data} />}
          {activeTab === "problems" && <ProblemsTab data={data} />}
          {activeTab === "export" && <ExportTab data={data} onExport={exportCurrent} />}
          {activeTab === "settings" && <SettingsTab data={data} />}
        </>
      )}
    </div>
  );
}

function OverviewTab({ data, onTab, mode }: { data: FinanceCenterResult; onTab: (tab: FinanceTabId) => void; mode: FinanceMode }) {
  const nextInvoices = data.purchases.invoices.filter((invoice) => invoice.remaining > 0).slice(0, 4);
  const criticalProblems = data.problems.filter((problem) => problem.severity === "danger").slice(0, 4);
  return (
    <div className="eco-fc-overview">
      <section className="eco-fc-panel eco-fc-panel--wide">
        <SectionHead
          title="Прибыль отдельно, деньги отдельно"
          text="P&L показывает результат бизнеса по начислению. Cashflow показывает фактические поступления и выплаты."
          icon={<Wallet aria-hidden />}
        />
        <div className="eco-fc-split">
          <article>
            <span>P&L</span>
            <strong>{formatMoney(data.pnl.knownNetProfit)}</strong>
            <p>Выручка − себестоимость − расходы − зарплата − эквайринг − налоги.</p>
            <button type="button" onClick={() => onTab("pnl")}>Открыть P&L</button>
          </article>
          <article>
            <span>Cashflow</span>
            <strong>{formatMoney(data.cashflow.netFlow)}</strong>
            <p>Фактические деньги: касса, эквайринг, выплаты, закупки и расходы.</p>
            <button type="button" onClick={() => onTab("cashflow")}>Открыть cashflow</button>
          </article>
          <article>
            <span>Закрытие периода</span>
            <strong>{data.period.snapshotStatus === "ready_to_close" ? "Готов" : "Есть блокеры"}</strong>
            <p>Перед закрытием проверяются себестоимость, зарплата, налоги, эквайринг и касса.</p>
            <button type="button" onClick={() => onTab("problems")}>Проверить</button>
          </article>
        </div>
      </section>

      {mode === "manager" && (
        <section className="eco-fc-panel">
          <SectionHead title="Операционный фокус" text="То, что управляющему нужно видеть в течение дня." icon={<CheckCircle2 aria-hidden />} />
          <div className="eco-fc-mini-list">
            <div><span>Получено денег</span><strong>{formatMoney(data.pnl.paidRevenue)}</strong></div>
            <div><span>К выплате зарплаты</span><strong>{formatMoney(data.payroll.remaining)}</strong></div>
            <div><span>До плана выручки</span><strong>{formatMoney(Math.max(0, (data.planFact.rows[0]?.plan ?? 0) - (data.planFact.rows[0]?.fact ?? 0)))}</strong></div>
            <div><span>Критичных проблем</span><strong>{data.problems.filter((problem) => problem.severity === "danger").length}</strong></div>
          </div>
        </section>
      )}

      <section className="eco-fc-panel">
        <SectionHead title="Ближайшие платежи" text="То, что скоро заберёт деньги из кассы или банка." />
        <div className="eco-fc-next-list">
          {nextInvoices.length === 0 && data.payroll.remaining <= 0 && !data.taxes.remaining && <span>Критичных ближайших платежей не найдено.</span>}
          {nextInvoices.map((invoice) => (
            <Link key={invoice.id} href={invoice.href}>
              <strong>{invoice.supplier}</strong>
              <span>{invoice.number} · срок {formatDate(invoice.dueDate)}</span>
              <b>{formatMoney(invoice.remaining)}</b>
            </Link>
          ))}
          {data.payroll.remaining > 0 && (
            <button type="button" onClick={() => onTab("payroll")}>
              <strong>Зарплата к выплате</strong>
              <span>Начислено минус выплачено</span>
              <b>{formatMoney(data.payroll.remaining)}</b>
            </button>
          )}
          {data.taxes.remaining != null && data.taxes.remaining > 0 && (
            <button type="button" onClick={() => onTab("taxes")}>
              <strong>Налоги к оплате</strong>
              <span>Срок {formatDate(data.taxes.dueDate)}</span>
              <b>{formatMoney(data.taxes.remaining)}</b>
            </button>
          )}
        </div>
      </section>

      <section className="eco-fc-panel">
        <SectionHead title="Проблемы учёта" text="Сначала исправляем то, что влияет на чистую прибыль." icon={<AlertTriangle aria-hidden />} />
        <div className="eco-fc-issue-compact">
          {criticalProblems.length === 0 ? (
            <div className="eco-fc-good"><CheckCircle2 aria-hidden />Критичных проблем нет</div>
          ) : criticalProblems.map((problem) => (
            <button key={problem.id} type="button" onClick={() => onTab("problems")}>
              <strong>{problem.title}</strong>
              <span>{problem.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="eco-fc-panel eco-fc-panel--wide">
        <SectionHead title="Прогноз и план" text="Текущий темп пересчитан до конца выбранного периода." icon={<BarChart3 aria-hidden />} />
        <div className="eco-fc-plan-bars">
          {data.planFact.rows.map((row) => (
            <div key={row.id}>
              <span>{row.label}</span>
              <strong>{formatMoney(row.fact)}</strong>
              <div>
                <i style={{ width: `${Math.min(100, Math.max(4, row.plan > 0 ? row.fact / row.plan * 100 : 0))}%` }} />
              </div>
              <em>план {formatMoney(row.plan)} · прогноз {formatMoney(row.forecast)}</em>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PnlTab({ data }: { data: FinanceCenterResult }) {
  return (
    <section className="eco-fc-panel">
      <SectionHead
        title="Управленческий P&L"
        text="Каждая строка отделяет начисленную прибыль от движения денег и ведёт в свою расшифровку."
        icon={<Calculator aria-hidden />}
      />
      <div className="eco-fc-toolbar">
        <Link className="eco-btn" href={data.legacy.profitUrl}>
          <ExternalLink className="eco-icon" aria-hidden />
          Старая детализация «Цены и прибыль»
        </Link>
      </div>
      <div className="eco-fc-table-wrap">
        <table className="eco-fc-table">
          <thead>
            <tr>
              <th>Показатель</th>
              <th className="is-number">Сумма</th>
              <th className="is-number">% от выручки</th>
              <th className="is-number">Изменение</th>
              <th>Расшифровка</th>
            </tr>
          </thead>
          <tbody>
            {data.pnl.rows.map((row) => (
              <tr key={row.id} className={`is-${row.kind} is-level-${row.level}`}>
                <td>
                  <strong>{row.label}</strong>
                  <span>{row.description}</span>
                </td>
                <td className="is-number">{row.display}</td>
                <td className="is-number">{row.displayRatio}</td>
                <td className="is-number">{row.displayChange}</td>
                <td>{row.tab ? <span className="eco-fc-chip">{ALL_TABS.find((tab) => tab.id === row.tab)?.label ?? row.tab}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CashflowTab({ data }: { data: FinanceCenterResult }) {
  return (
    <section className="eco-fc-panel">
      <SectionHead title="Деньги / Cashflow" text="Здесь только фактическое движение денег: пришло, ушло, остаток." icon={<Wallet aria-hidden />} />
      <div className="eco-fc-cash-grid">
        {data.cashflow.lines.map((line) => (
          <article key={line.id} className={`is-${line.group}`}>
            <span>{line.label}</span>
            <strong>{line.display}</strong>
            <p>{line.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ExpensesTab({ data }: { data: FinanceCenterResult }) {
  return (
    <div className="eco-fc-stack">
      <section className="eco-fc-panel">
        <SectionHead title="Расходы по категориям" text="Категории знают, влияют ли они на P&L и cashflow." />
        <div className="eco-fc-category-grid">
          {data.expenses.byCategory.map((row) => (
            <article key={row.id}>
              <span>{row.name}</span>
              <strong>{row.displayAmount}</strong>
              <div><i style={{ width: `${Math.min(100, row.share)}%` }} /></div>
              <em>{formatPercent(row.share)} расходов</em>
            </article>
          ))}
        </div>
      </section>
      <section className="eco-fc-panel">
        <SectionHead title="Расходные ордера" text="Проверка влияния каждой операции на прибыль и движение денег." />
        <div className="eco-fc-table-wrap">
          <table className="eco-fc-table">
            <thead>
              <tr>
                <th>Дата / ордер</th>
                <th>Категория</th>
                <th>Контрагент</th>
                <th className="is-number">Сумма</th>
                <th>Прибыль</th>
                <th>Cashflow</th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.rows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.number}</strong><span>{formatDate(row.date)} · {row.paymentType}</span></td>
                  <td><span className="eco-fc-chip">{row.categoryName}</span></td>
                  <td><strong>{row.counterparty}</strong><span>{row.comment || row.source}</span></td>
                  <td className="is-number">{row.displayAmount}</td>
                  <td><BoolMark value={row.affectsProfit} /></td>
                  <td><BoolMark value={row.affectsCashflow} /></td>
                </tr>
              ))}
              {data.expenses.rows.length === 0 && <tr><td colSpan={6} className="eco-fc-empty">Расходных ордеров за период нет.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function TaxesTab({ data }: { data: FinanceCenterResult }) {
  return (
    <section className="eco-fc-panel">
      <SectionHead title="Налоги" text="Ставки не считаются молча как ноль: если настройка не задана, это проблема учёта." icon={<Landmark aria-hidden />} />
      {data.taxes.warning && (
        <div className="eco-fc-alert is-inline">
          <AlertTriangle aria-hidden />
          <div><strong>{data.taxes.warning}</strong><p>Укажите режим, базу и ставку в настройках организации.</p></div>
        </div>
      )}
      <div className="eco-fc-definition-grid">
        <div><span>Организация</span><strong>{data.taxes.organizationName}</strong></div>
        <div><span>Режим</span><strong>{data.taxes.regime}</strong></div>
        <div><span>База</span><strong>{data.taxes.base == null ? "Не настроено" : formatMoney(data.taxes.base)}</strong></div>
        <div><span>Ставка</span><strong>{data.taxes.rate == null ? "Не настроено" : `${formatNumber(data.taxes.rate)}%`}</strong></div>
        <div><span>Рассчитано</span><strong>{formatMoney(data.taxes.calculated)}</strong></div>
        <div><span>Оплачено</span><strong>{formatMoney(data.taxes.paid)}</strong></div>
        <div><span>Осталось</span><strong>{formatMoney(data.taxes.remaining)}</strong></div>
        <div><span>Ближайший срок</span><strong>{formatDate(data.taxes.dueDate)}</strong></div>
      </div>
    </section>
  );
}

function AcquiringTab({ data }: { data: FinanceCenterResult }) {
  return (
    <section className="eco-fc-panel">
      <SectionHead title="Эквайринг" text="Комиссия — расход P&L, к зачислению в cashflow попадает сумма после удержания." />
      <div className="eco-fc-definition-grid">
        <div><span>Провайдер</span><strong>{data.acquiring.provider}</strong></div>
        <div><span>Ставка</span><strong>{data.acquiring.percentRate == null ? "Не настроено" : `${formatNumber(data.acquiring.percentRate)}%`}</strong></div>
        <div><span>Оплаты картой</span><strong>{formatMoney(data.acquiring.grossCardPayments)}</strong></div>
        <div><span>Комиссия</span><strong>{formatMoney(data.acquiring.commission)}</strong></div>
        <div><span>К зачислению</span><strong>{formatMoney(data.acquiring.netToSettle)}</strong></div>
        <div><span>Ожидаемая дата</span><strong>{formatDate(data.acquiring.expectedSettlementDate)}</strong></div>
      </div>
      <div className="eco-fc-table-wrap">
        <table className="eco-fc-table">
          <thead><tr><th>Операция</th><th className="is-number">Оплата</th><th className="is-number">Комиссия</th><th className="is-number">К зачислению</th><th>Статус</th></tr></thead>
          <tbody>
            {data.acquiring.operations.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.label}</strong><span>{formatDate(row.date)}</span></td>
                <td className="is-number">{formatMoney(row.amount)}</td>
                <td className="is-number">{formatMoney(row.commission)}</td>
                <td className="is-number">{formatMoney(row.net)}</td>
                <td><span className="eco-fc-chip">{statusLabel(row.status)}</span></td>
              </tr>
            ))}
            {data.acquiring.operations.length === 0 && <tr><td colSpan={5} className="eco-fc-empty">Карточных оплат за период нет.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PayrollTab({ data }: { data: FinanceCenterResult }) {
  return (
    <section className="eco-fc-panel">
      <SectionHead title="Зарплата в финансах" text="Начисление уменьшает P&L, выплата отражается только в cashflow." />
      <div className="eco-fc-definition-grid">
        <div><span>Начислено</span><strong>{formatMoney(data.payroll.accrued)}</strong></div>
        <div><span>Выплачено</span><strong>{formatMoney(data.payroll.paid)}</strong></div>
        <div><span>К выплате</span><strong>{formatMoney(data.payroll.remaining)}</strong></div>
        <div><span>% от выручки</span><strong>{formatPercent(data.payroll.percentOfRevenue)}</strong></div>
        <div><span>Фикс</span><strong>{formatMoney(data.payroll.fixed)}</strong></div>
        <div><span>Сдельная часть</span><strong>{formatMoney(data.payroll.piecework)}</strong></div>
        <div><span>Бонусы / удержания</span><strong>{formatMoney(data.payroll.bonusPenalty)}</strong></div>
      </div>
      <div className="eco-fc-table-wrap">
        <table className="eco-fc-table">
          <thead><tr><th>Сотрудник</th><th className="is-number">Начислено</th><th className="is-number">Выплачено</th><th className="is-number">К выплате</th><th className="is-number">Смены</th></tr></thead>
          <tbody>
            {data.payroll.employees.map((employee) => (
              <tr key={employee.login}>
                <td><strong>{employee.name}</strong><span>{employee.login}</span></td>
                <td className="is-number">{formatMoney(employee.accrued)}</td>
                <td className="is-number">{formatMoney(employee.paid)}</td>
                <td className="is-number">{formatMoney(employee.remaining)}</td>
                <td className="is-number">{employee.shifts}</td>
              </tr>
            ))}
            {data.payroll.employees.length === 0 && <tr><td colSpan={5} className="eco-fc-empty">Начислений за период нет.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PurchasesTab({ data }: { data: FinanceCenterResult }) {
  return (
    <section className="eco-fc-panel">
      <SectionHead title="Закупки и поставщики" text="Закупка на склад — cashflow сейчас, себестоимость в P&L только после продажи." />
      <div className="eco-fc-definition-grid">
        <div><span>Закуплено по приёмкам</span><strong>{formatMoney(data.purchases.receiptValue)}</strong></div>
        <div><span>Оплачено поставщикам</span><strong>{formatMoney(data.purchases.paidToSuppliers)}</strong></div>
        <div><span>Кредиторка</span><strong>{formatMoney(data.purchases.unpaidToSuppliers)}</strong></div>
        <div><span>Денежный отток закупок</span><strong>{formatMoney(data.purchases.inventoryPurchaseCashflow)}</strong></div>
      </div>
      <div className="eco-fc-table-wrap">
        <table className="eco-fc-table">
          <thead><tr><th>Счёт</th><th>Поставщик</th><th>Срок</th><th className="is-number">Сумма</th><th className="is-number">Оплачено</th><th className="is-number">Остаток</th></tr></thead>
          <tbody>
            {data.purchases.invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td><Link href={invoice.href}><strong>{invoice.number}</strong><span>{formatDate(invoice.invoiceDate)}</span></Link></td>
                <td>{invoice.supplier}</td>
                <td>{formatDate(invoice.dueDate)}</td>
                <td className="is-number">{formatMoney(invoice.sum)}</td>
                <td className="is-number">{formatMoney(invoice.paid)}</td>
                <td className="is-number">{formatMoney(invoice.remaining)}</td>
              </tr>
            ))}
            {data.purchases.invoices.length === 0 && <tr><td colSpan={6} className="eco-fc-empty">Счетов поставщиков за период нет.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BreakEvenTab({ data }: { data: FinanceCenterResult }) {
  return (
    <section className="eco-fc-panel">
      <SectionHead title="Точка безубыточности" text="Сколько нужно выручки и отгрузок, чтобы выйти в ноль." />
      <div className="eco-fc-definition-grid">
        <div><span>Постоянные расходы</span><strong>{formatMoney(data.breakEven.fixedExpenses)}</strong></div>
        <div><span>Маржа после переменных</span><strong>{formatPercent(data.breakEven.contributionMarginPercent)}</strong></div>
        <div><span>Выручка в месяц</span><strong>{formatMoney(data.breakEven.monthlyRevenue)}</strong></div>
        <div><span>Выручка в день</span><strong>{formatMoney(data.breakEven.dailyRevenue)}</strong></div>
        <div><span>Отгрузок в день</span><strong>{formatNumber(data.breakEven.shipmentsPerDay)}</strong></div>
        <div><span>Средний чек</span><strong>{formatMoney(data.breakEven.averageTicket)}</strong></div>
        <div><span>Запас прочности</span><strong>{formatMoney(data.breakEven.safetyMargin)}</strong></div>
        <div><span>Прогресс к нулю</span><strong>{formatPercent(data.breakEven.progressPercent)}</strong></div>
      </div>
      <details className="eco-fc-formulas" open>
        <summary>Формулы расчёта</summary>
        {data.breakEven.formulas.map((formula) => <code key={formula}>{formula}</code>)}
      </details>
    </section>
  );
}

function PlanFactTab({ data }: { data: FinanceCenterResult }) {
  return (
    <section className="eco-fc-panel">
      <SectionHead title="План / факт и прогноз" text="Факт сравнивается с планом и текущим темпом до конца периода." />
      <div className="eco-fc-definition-grid">
        <div><span>Прогноз выручки</span><strong>{formatMoney(data.planFact.forecastRevenue)}</strong></div>
        <div><span>Прогноз валовой прибыли</span><strong>{formatMoney(data.planFact.forecastGrossProfit)}</strong></div>
        <div><span>Прогноз чистой прибыли</span><strong>{formatMoney(data.planFact.forecastNetProfit)}</strong></div>
        <div><span>Нужно в день</span><strong>{formatMoney(data.planFact.dailyRevenueRequired)}</strong></div>
      </div>
      {data.planFact.risk && <div className="eco-fc-alert is-inline"><AlertTriangle aria-hidden /><div><strong>{data.planFact.risk}</strong></div></div>}
      <div className="eco-fc-table-wrap">
        <table className="eco-fc-table">
          <thead><tr><th>Показатель</th><th className="is-number">План</th><th className="is-number">Факт</th><th className="is-number">Прогноз</th><th className="is-number">Отклонение</th><th>Статус</th></tr></thead>
          <tbody>
            {data.planFact.rows.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.label}</strong></td>
                <td className="is-number">{row.id === "shipments" ? formatNumber(row.plan) : formatMoney(row.plan)}</td>
                <td className="is-number">{row.id === "shipments" ? formatNumber(row.fact) : formatMoney(row.fact)}</td>
                <td className="is-number">{row.id === "shipments" ? formatNumber(row.forecast) : formatMoney(row.forecast)}</td>
                <td className="is-number">{row.id === "shipments" ? formatNumber(row.deviation) : formatMoney(row.deviation)}</td>
                <td><span className={`eco-fc-chip is-${row.status === "above" ? "success" : row.status === "risk" ? "warning" : "danger"}`}>{row.status === "above" ? "выше плана" : row.status === "risk" ? "риск" : "ниже"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DocumentsTab({ data }: { data: FinanceCenterResult }) {
  return (
    <section className="eco-fc-panel">
      <SectionHead title="Документы" text="Документы, из которых собраны цифры финансового центра." />
      <div className="eco-fc-table-wrap">
        <table className="eco-fc-table">
          <thead><tr><th>Дата / документ</th><th>Тип</th><th>Контрагент</th><th>Категория</th><th className="is-number">Сумма</th><th>Прибыль</th><th>Cashflow</th></tr></thead>
          <tbody>
            {data.documents.map((row) => (
              <tr key={row.id}>
                <td><Link href={row.href}><strong>{row.number}</strong><span>{formatDate(row.date)} · {statusLabel(row.status)}</span></Link></td>
                <td>{row.type}</td>
                <td>{row.counterparty}</td>
                <td>{row.category}</td>
                <td className="is-number">{row.displayAmount}</td>
                <td><BoolMark value={row.affectsProfit} /></td>
                <td><BoolMark value={row.affectsCashflow} /></td>
              </tr>
            ))}
            {data.documents.length === 0 && <tr><td colSpan={7} className="eco-fc-empty">Документов за период нет.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProblemsTab({ data }: { data: FinanceCenterResult }) {
  return (
    <section className="eco-fc-panel">
      <SectionHead title="Проблемы учёта" text="Проблемы кликабельны и показывают, что нужно исправить до закрытия периода." icon={<AlertTriangle aria-hidden />} />
      <div className="eco-fc-problems">
        {data.problems.map((problem) => (
          <article key={problem.id} className={`is-${problem.severity}`}>
            <AlertTriangle aria-hidden />
            <div>
              <strong>{problem.title}</strong>
              <p>{problem.description}</p>
              <span>{problem.source}</span>
            </div>
            <div>
              <b>{problem.displayAmount}</b>
              {problem.href ? <Link className="eco-btn eco-btn--sm" href={problem.href}>{problem.action}</Link> : <button type="button" className="eco-btn eco-btn--sm">{problem.action}</button>}
            </div>
          </article>
        ))}
        {data.problems.length === 0 && <div className="eco-fc-good"><CheckCircle2 aria-hidden />Проблем учёта не найдено</div>}
      </div>
    </section>
  );
}

function ExportTab({ data, onExport }: { data: FinanceCenterResult; onExport: (format: "csv" | "xls") => void }) {
  return (
    <section className="eco-fc-panel">
      <SectionHead title="Экспорт" text="Готовые управленческие отчёты за выбранный период." />
      <div className="eco-fc-export-grid">
        {data.exportReports.map((report) => (
          <article key={report.id}>
            <strong>{report.label}</strong>
            <p>{report.description}</p>
            <span>{report.formats.join(" · ")}</span>
          </article>
        ))}
      </div>
      <div className="eco-fc-toolbar">
        <button type="button" className="eco-btn eco-btn--primary" onClick={() => onExport("csv")}><Download className="eco-icon" aria-hidden />Выгрузить CSV</button>
        <button type="button" className="eco-btn" onClick={() => onExport("xls")}><FileSpreadsheet className="eco-icon" aria-hidden />Выгрузить Excel</button>
        <button type="button" className="eco-btn" onClick={() => window.print()}><Printer className="eco-icon" aria-hidden />Печать / PDF</button>
      </div>
    </section>
  );
}

function SettingsTab({ data }: { data: FinanceCenterResult }) {
  return (
    <div className="eco-fc-stack">
      <section className="eco-fc-panel">
        <SectionHead title="Настройки финансов" text="Справочники и правила влияния операций на прибыль и cashflow." icon={<Settings aria-hidden />} />
        <div className="eco-fc-table-wrap">
          <table className="eco-fc-table">
            <thead><tr><th>Категория</th><th>Группа</th><th>Статья P&L</th><th>Статья cashflow</th><th>Прибыль</th><th>Cashflow</th></tr></thead>
            <tbody>
              {data.settings.expenseCategories.map((category) => (
                <tr key={category.id}>
                  <td><strong>{category.name}</strong><span>{category.costBehavior} · {category.operationScope}</span></td>
                  <td>{category.group}</td>
                  <td>{category.pnlLine}</td>
                  <td>{category.cashflowLine}</td>
                  <td><BoolMark value={category.affectsProfit} /></td>
                  <td><BoolMark value={category.affectsCashflow} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="eco-fc-panel">
        <SectionHead title="Правила влияния операций" text="Ключевая защита от двойного списания и смешивания прибыли с деньгами." />
        <div className="eco-fc-rule-grid">
          {data.settings.influenceRules.map((rule) => (
            <article key={rule.operation}>
              <strong>{rule.operation}</strong>
              <span>P&L: {rule.profit}</span>
              <span>Cashflow: {rule.cashflow}</span>
              <p>{rule.note}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="eco-fc-panel">
        <SectionHead title="Права доступа" text="Набор прав для владельца и финансового директора." />
        <div className="eco-fc-rights">
          {data.settings.accessRights.map((right) => <span key={right}>{right}</span>)}
        </div>
      </section>
    </div>
  );
}
