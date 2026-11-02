"use client";

import { RefreshCw, Target, Wrench, Package } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export type EmployeeSalesPlanData = {
  month: string;
  branchName: string;
  updatedAt: string;
  rows: { id: string; title: string; kind: "service" | "product"; unit: string; measure: "quantity" | "revenue" | "profit"; target: number; actual: number | null; earnedCents: number | null; bonusCents: number | null; bonusStatus: "NOT_CONFIGURED" | "CONFIGURED" | "ACCRUED" | "REVERSED" }[];
};
const money = (value: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value / 100);
const quantity = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value);

export default function EmployeeSalesPlanCard({ refreshToken }: { refreshToken: number | null }) {
  const [data, setData] = useState<EmployeeSalesPlanData | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch("/api/dashboard/sales-plan", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error();
        const payload = await response.json() as EmployeeSalesPlanData;
        if (!cancelled) { setData(payload); setError(false); }
      } catch { if (!cancelled) setError(true); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; controller.abort(); };
  }, [refreshToken, reload]);
  const month = data ? new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${data.month}-01T12:00:00Z`)) : "текущий месяц";
  return (
    <section className="eco-ops-card eco-employee-sales-plan" aria-label="План продаж и ваш заработок" aria-busy={loading}>
      <header>
        <div><h2><Target size={20} aria-hidden />План продаж · {month}</h2><p>{data?.branchName ?? "Текущий филиал"} · ваш личный прогресс и сдельный заработок</p></div>
        <button type="button" className="eco-btn eco-btn--ghost" onClick={refresh} disabled={loading} aria-label="Обновить план продаж"><RefreshCw size={16} className={loading ? "eco-spin" : ""} aria-hidden /></button>
      </header>
      {error && <p role="status">Не удалось обновить план. {data ? "Показаны последние загруженные данные." : "Нажмите кнопку обновления."}</p>}
      {!data && loading ? <p role="status">Загружаем план продаж…</p> : data && !data.rows.length ? <p>План на этот месяц ещё не задан. Здесь появятся все позиции, которые назначит владелец.</p> : data?.rows.map((row) => {
        const percent = row.actual == null || row.target <= 0 ? null : Math.max(0, row.actual / row.target * 100);
        const complete = percent != null && percent >= 100;
        const unit = row.measure === "quantity" ? row.unit === "LITER" ? "л" : row.unit === "OPERATION" ? "усл." : "шт." : "₽";
        const value = (number: number) => row.measure === "quantity" ? quantity(number) : money(number);
        const Icon = row.kind === "service" ? Wrench : Package;
        return (
          <article key={row.id} className={complete ? "is-complete" : ""}>
            <div className="eco-employee-sales-plan__progress">
              <div className="eco-employee-sales-plan__row-title"><Icon size={17} aria-hidden /><h3>{row.title}</h3><span>{complete ? "План выполнен" : percent == null ? "Факт уточняется" : `${quantity(percent)}%`}</span></div>
              <progress max={100} value={Math.min(100, percent ?? 0)} aria-label={`${row.title}: выполнение плана`} />
              <div className="eco-employee-sales-plan__numbers"><span>{row.actual == null ? "Нет подтверждённых данных" : `${value(row.actual)} из ${value(row.target)}${unit === "₽" ? "" : ` ${unit}`}`}</span><span>{row.actual == null ? "" : complete ? "Цель достигнута" : `Осталось ${value(Math.max(0, row.target - row.actual))}${unit === "₽" ? "" : ` ${unit}`}`}</span></div>
            </div>
            <div className="eco-employee-sales-plan__earnings"><span>Вы заработали сдельно</span><strong>{row.earnedCents == null ? "Уточняется" : money(row.earnedCents)}</strong><small>{row.bonusStatus === "REVERSED" ? "Начисление бонуса отменено" : row.bonusCents == null ? "Бонус за выполнение пока не установлен" : `${row.bonusStatus === "ACCRUED" ? "Бонус начислен в зарплату" : "Бонус при выполнении"}: +${money(row.bonusCents)}`}</small></div>
          </article>
        );
      })}
      {!!data?.rows.length && <footer>Сдельные суммы входят в ваш текущий расчёт зарплаты. Бонус за выполнение начисляется отдельно в зарплату один раз за позицию в месяц.</footer>}
    </section>
  );
}
