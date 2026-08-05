"use client";

import { CalendarDays, ChevronDown, ChevronRight, RefreshCw, X } from "lucide-react";
import { useMemo, useState } from "react";

export type EmployeePayrollPeriod = "today" | "week" | "month" | "custom";

export type EmployeePayrollData = {
  period: { from: string; to: string; timezone: string; kind: EmployeePayrollPeriod };
  lastUpdatedAt: string;
  status: "CONFIRMED" | "PRELIMINARY";
  summary: {
    earnedCents: number;
    paidCents: number;
    toPayCents: number;
    shipmentEarningsCents: number;
    shiftEarningsCents: number;
    adjustmentsCents: number;
    shipmentCount: number;
    averageShipmentEarningsCents: number | null;
  };
  today: {
    earnedCents: number;
    shipmentCount: number;
    shipmentEarningsCents: number;
    shiftEarningsCents: number;
  };
  month: { earnedCents: number; paidCents: number; toPayCents: number };
  items: Array<{
    id: string;
    shipmentNumber: string;
    date: string;
    moment: string;
    clientName: string | null;
    vehicleLabel: string | null;
    earnedCents: number;
    status: "CONFIRMED" | "PRELIMINARY";
    components: Array<{
      label: string;
      category: "work" | "product";
      quantity: number;
      amountCents: number;
      ruleLabel: string;
      basisLabel: string;
    }>;
  }>;
};

type CustomRange = { dateFrom: string; dateTo: string };

function money(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function dateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}

function timeLabel(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function updatedLabel(value: string, timeZone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Обновлено";
  return `Обновлено в ${timeLabel(value, timeZone)}`;
}

function defaultCustomRange() {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  return { dateFrom: from, dateTo: to };
}

export default function MyPayrollCard({
  data,
  loading,
  error,
  onRefresh,
  onPeriodChange,
}: {
  data: EmployeePayrollData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onPeriodChange: (period: EmployeePayrollPeriod, range?: CustomRange) => void;
}) {
  const [selectedPeriod, setSelectedPeriod] = useState<EmployeePayrollPeriod>("today");
  const [customRange, setCustomRange] = useState<CustomRange>(defaultCustomRange);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selectedItem = useMemo(
    () => data?.items.find((item) => item.id === selectedItemId) ?? null,
    [data?.items, selectedItemId]
  );
  const timeZone = data?.period.timezone ?? "Europe/Kaliningrad";

  function changePeriod(period: EmployeePayrollPeriod) {
    setSelectedPeriod(period);
    if (period !== "custom") onPeriodChange(period);
  }

  return (
    <section className="eco-my-payroll" aria-busy={loading}>
      <header className="eco-my-payroll__head">
        <div>
          <h1>Моя зарплата</h1>
          <p>{data ? updatedLabel(data.lastUpdatedAt, timeZone) : "Считаем начисления по вашим отгрузкам"}</p>
        </div>
        <div className="eco-my-payroll__controls">
          <label>
            <span className="eco-visually-hidden">Период начислений</span>
            <select value={selectedPeriod} onChange={(event) => changePeriod(event.target.value as EmployeePayrollPeriod)}>
              <option value="today">Сегодня</option>
              <option value="week">Неделя</option>
              <option value="month">Месяц</option>
              <option value="custom">Произвольный</option>
            </select>
            <ChevronDown aria-hidden size={15} />
          </label>
          <button type="button" className="eco-my-payroll__refresh" onClick={onRefresh} disabled={loading}>
            <RefreshCw aria-hidden size={15} className={loading ? "eco-spin" : ""} />
            <span>Обновить</span>
          </button>
        </div>
      </header>

      {selectedPeriod === "custom" && (
        <form
          className="eco-my-payroll__custom-range"
          onSubmit={(event) => {
            event.preventDefault();
            onPeriodChange("custom", customRange);
          }}
        >
          <label>С<input type="date" value={customRange.dateFrom} onChange={(event) => setCustomRange((current) => ({ ...current, dateFrom: event.target.value }))} /></label>
          <label>По<input type="date" value={customRange.dateTo} onChange={(event) => setCustomRange((current) => ({ ...current, dateTo: event.target.value }))} /></label>
          <button type="submit">Показать</button>
        </form>
      )}

      {error && !data ? (
        <div className="eco-my-payroll__state is-error" role="alert">
          <strong>Не удалось загрузить расчёт.</strong>
          <span>Обновите данные и попробуйте ещё раз.</span>
          <button type="button" onClick={onRefresh}>Повторить</button>
        </div>
      ) : !data ? (
        <div className="eco-my-payroll__skeleton" aria-label="Загружаем зарплату">
          <span /><span /><span /><span /><span /><span />
        </div>
      ) : (
        <>
          {error && <p className="eco-my-payroll__inline-error" role="status">Не удалось обновить данные. Показан предыдущий расчёт.</p>}
          <div className="eco-my-payroll__metrics">
            <div><span>Сегодня</span><strong>{money(data.today.earnedCents)}</strong><small>{data.today.shipmentCount} {data.today.shipmentCount === 1 ? "отгрузка" : "отгрузок"}</small></div>
            <div><span>За месяц</span><strong>{money(data.month.earnedCents)}</strong><small>с первого числа</small></div>
            <div><span>Отгрузок сегодня</span><strong>{data.today.shipmentCount}</strong><small>с начислением</small></div>
            <div><span>Среднее с отгрузки</span><strong>{data.summary.averageShipmentEarningsCents == null ? "—" : money(data.summary.averageShipmentEarningsCents)}</strong><small>за выбранный период</small></div>
          </div>

          <div className="eco-my-payroll__summary" aria-label="Итоги начислений">
            <div><span>Заработано</span><strong>{money(data.summary.earnedCents)}</strong></div>
            <div><span>Выплачено</span><strong>{money(data.summary.paidCents)}</strong></div>
            <div><span>К выплате</span><strong>{money(data.summary.toPayCents)}</strong></div>
            {data.summary.shiftEarningsCents > 0 && <div><span>Оплата смены</span><strong>{money(data.summary.shiftEarningsCents)}</strong></div>}
            {data.summary.adjustmentsCents !== 0 && <div className={data.summary.adjustmentsCents < 0 ? "is-deduction" : ""}><span>Корректировки</span><strong>{data.summary.adjustmentsCents > 0 ? "+" : "−"}{money(Math.abs(data.summary.adjustmentsCents))}</strong></div>}
          </div>

          <div className="eco-my-payroll__list-head">
            <div>
              <h2>Начисления по отгрузкам</h2>
              <p>{dateLabel(data.period.from)} — {dateLabel(data.period.to)}</p>
            </div>
            <span className={data.status === "CONFIRMED" ? "is-confirmed" : ""}>{data.status === "CONFIRMED" ? "Подтверждено" : "Предварительно"}</span>
          </div>

          {data.items.length ? (
            <div className="eco-my-payroll__list">
              {data.items.map((item) => (
                <button key={item.id} type="button" className="eco-my-payroll__item" onClick={() => setSelectedItemId(item.id)}>
                  <time>{item.date === data.period.to ? timeLabel(item.moment, timeZone) : dateLabel(item.date)}</time>
                  <span className="eco-my-payroll__item-copy">
                    <strong>{item.shipmentNumber}</strong>
                    <small>{item.vehicleLabel || item.clientName || "Отгрузка"}</small>
                  </span>
                  <span className="eco-my-payroll__item-amount">{money(item.earnedCents)}</span>
                  <ChevronRight aria-hidden size={17} />
                </button>
              ))}
            </div>
          ) : (
            <div className="eco-my-payroll__state">
              <CalendarDays aria-hidden size={19} />
              <div><strong>Сегодня пока нет начислений по выполненным работам.</strong><span>Они появятся после проведённой отгрузки с правилом расчёта.</span></div>
            </div>
          )}
        </>
      )}

      {selectedItem && (
        <div className="eco-my-payroll__dialog-backdrop" role="presentation" onMouseDown={() => setSelectedItemId(null)}>
          <section className="eco-my-payroll__dialog" role="dialog" aria-modal="true" aria-labelledby="payroll-detail-title" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>Отгрузка</span><h2 id="payroll-detail-title">{selectedItem.shipmentNumber}</h2><p>{selectedItem.vehicleLabel || selectedItem.clientName || "Детали начисления"}</p></div><button type="button" aria-label="Закрыть детали начисления" onClick={() => setSelectedItemId(null)}><X aria-hidden size={18} /></button></header>
            <div className="eco-my-payroll__dialog-lines">
              {selectedItem.components.map((component, index) => (
                <div key={`${component.label}-${index}`}><span><strong>{component.label}</strong><small>{component.ruleLabel} · {component.basisLabel}</small></span><b>{money(component.amountCents)}</b></div>
              ))}
            </div>
            <footer><span>Итого сотруднику</span><strong>{money(selectedItem.earnedCents)}</strong></footer>
          </section>
        </div>
      )}
    </section>
  );
}
