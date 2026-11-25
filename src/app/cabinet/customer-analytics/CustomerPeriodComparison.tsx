"use client";

import { useEffect, useState } from "react";
import type { AnalyticsPeriod, calculateCustomerCohorts } from "@/lib/customer-cohorts";

type Result = ReturnType<typeof calculateCustomerCohorts> & {
  scope: string; asOf: string; threshold: number; network: boolean; completeHistory: boolean;
  branches: { id: string; name: string; start: string | null }[];
  services: { id: string; name: string }[];
};
const metrics = [
  ["unique", "Уникальные"], ["newNetwork", "Впервые в сети"], ["transfer", "Впервые на точке после другой"],
  ["repeat", "Обслуживались ранее"], ["unknown", "Статус неизвестен"], ["regular", "Постоянные"],
  ["knownFirst", "Первый известный визит в охвате"], ["noPhone", "Без валидного телефона"], ["anonymous", "Розничные отгрузки"],
] as const;
const percent = (value: number) => `${(100 * value).toFixed(1)}%`;
const signed = (value: number, decimals = 0) => `${value > 0 ? "+" : ""}${value.toFixed(decimals)}`;
const money = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("ru-RU", {
  style: "currency", currency: "RUB", maximumFractionDigits: 0,
}).format(value / 100);

export default function CustomerPeriodComparison() {
  const [periods, setPeriods] = useState<AnalyticsPeriod[]>([
    { from: "", to: "" }, { from: "", to: "" },
  ]);
  const [base, setBase] = useState(0);
  const [scope, setScope] = useState("");
  const [asOf, setAsOf] = useState("");
  const [firstBranch, setFirstBranch] = useState("");
  const [services, setServices] = useState<string[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [availability, setAvailability] = useState<Pick<Result, "branches" | "network" | "services"> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const selected = result?.comparisons[base];
  const branchName = (id: string) => availability?.branches.find((branch) => branch.id === id)?.name ?? id;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/analytics/customers/comparison", { signal: controller.signal })
      .then(async (response) => { if (response.ok) setAvailability(await response.json()); })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/analytics/customers/comparison", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periods, scope, asOf, firstBranch, services }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось получить отчёт");
      setResult(data);
      setAvailability(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось получить отчёт");
    } finally { setLoading(false); }
  }

  return (
    <details className="eco-card eco-card--padded" style={{ marginBottom: "1rem" }}>
      <summary>Сравнение периодов и когорты</summary>
      <form onSubmit={(event) => { event.preventDefault(); void load(); }}>
        <fieldset disabled={loading}>
          <legend>Параметры сравнения</legend>
          <label>Охват <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Активный филиал</option>
            {availability?.branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}
            {availability?.network && <option value="network">Вся сеть</option>}
          </select></label>
          <label> Дата расчёта <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
          {periods.map((period, index) => (
            <div key={index}>
              <label><input type="radio" name="analytics-base" checked={base === index} onChange={() => setBase(index)} /> Базовый</label>
              {(["from", "to"] as const).map((field) => <label key={field}> {field === "from" ? "С" : "По"} <input
                type="date" required value={period[field]} onChange={(e) => setPeriods((current) =>
                  current.map((item, i) => i === index ? { ...item, [field]: e.target.value } : item))}
              /></label>)}
            </div>
          ))}
          {periods.length < 8 && <button type="button" onClick={() => setPeriods([...periods, { from: "", to: "" }])}>Добавить период</button>}
          <label> Филиал первого визита <select value={firstBranch} onChange={(e) => setFirstBranch(e.target.value)}>
            <option value="">Все доступные</option>
            {availability?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select></label>
          {!!availability?.services.length && <label> Услуги <select multiple value={services}
            onChange={(e) => setServices(Array.from(e.target.selectedOptions, (option) => option.value))}>
            {availability.services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
          </select></label>}
          <button type="submit">{loading ? "Считаем…" : "Рассчитать"}</button>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {result && selected && <>
        <p>{result.scope === "network" ? "Вся сеть" : branchName(result.scope)} · На {result.asOf}. Постоянный клиент — от {result.threshold} визитов к концу периода.</p>
        <p>{result.branches.map((branch) => `${branch.name}: ${branch.start ?? "нет документов"}`).join(" · ")}</p>
        {!result.completeHistory && <p>Полнота ранней истории не подтверждена. Когорты построены по первому известному визиту в доступных филиалах.</p>}
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>Показатель</th>{result.comparisons.map((period, i) =>
              <th key={i}>{period.from} — {period.to} · {period.days} дн.{i === base ? " · база" : ""}</th>)}</tr></thead>
            <tbody>{metrics.filter(([key]) => result.scope !== "network" || key !== "transfer").map(([key, label]) => (
              <tr key={key}><th scope="row">{label}</th>{result.comparisons.map((period, i) => {
                const proportion = !["unique", "anonymous"].includes(key) && period.unique > 0;
                return <td key={i}>{period[key]}{proportion ? ` (${period[key]}/${period.unique}, ${percent(period[key] / period.unique)})` : ""}
                  {i !== base && <small> · {signed(period[key] - selected[key])} / {selected[key] ? `${signed(100 * (period[key] - selected[key]) / selected[key], 1)}%` : "—"}
                    {proportion && selected.unique ? ` · ${signed(100 * (period[key] / period.unique - selected[key] / selected.unique), 1)} п. п.` : ""}</small>}
                </td>;
              })}</tr>
            ))}</tbody>
          </table>
        </div>
        <p>Визитов с несколькими связанными документами {result.linkedMultiDocumentVisits} из {result.visitCount}. Документ без подтверждённой связи считается отдельным визитом.</p>
        <h3>Переходы между филиалами</h3>
        {result.comparisons.map((period, index) => <p key={index}>{period.from} — {period.to} · {
          result.completeHistory ? Object.entries(period.transfers).map(([key, count]) =>
            `${key.split(" → ").map(branchName).join(" → ")}: ${count}`).join(" · ") || "0 подтверждённых переходов" : "первое посещение точки не установлено"
        }</p>)}
        <h3>Когорты и LTV</h3>
        <p>LTV по выручке от отгрузок включает первый визит и подходящие документы до конца окна. Возвраты денег отдельно не вычитались. Канал берётся из связанной записи первого визита. CAC недоступен без расходов кампаний и подтверждённой связи с визитом.</p>
        <div style={{ overflowX: "auto" }}><table>
          <thead><tr>{["Месяц", "Филиал", "Источник", "Дни", "Размер", "Прожили", "Вернулись", "Не вернулись", "Ещё не прожили", "На свою", "Первый возврат на другую", "Retention", "LTV выручка", "LTV прибыль", "Себестоимость"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{result.cohorts.map((row) => <tr key={`${row.month}:${row.branch}:${row.window}:${row.source}`}>
            <td>{row.month}</td><td>{branchName(row.branch)}</td><td>{row.source ?? "Все каналы"}</td><td>{row.window}</td>
            <td>{row.size}</td><td>{row.mature}</td><td>{row.returned}</td><td>{row.didNotReturn}</td><td>{row.immature}</td>
            <td>{row.same}</td><td>{row.other}</td><td>{row.retention === null ? "—" : `${row.returned}/${row.mature} · ${percent(row.retention)}`}</td>
            <td>{money(row.revenueLtv)}</td><td>{money(row.profitLtv)}</td><td>{row.withCost}/{row.operations}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
    </details>
  );
}
