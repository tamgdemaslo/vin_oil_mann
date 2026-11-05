"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Data = { branchName: string; period: { month: string; comparisonDays: number; previousFrom: string }; revenueCents: number; shipmentsCount: number; revenueDeltaPercent: number | null; shipmentsDeltaPercent: number | null; planError: string | null; plans: { id: string; title: string; target: number; actual: number | null; unit: string; money: boolean }[] };
const number = (value: number) => value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
const money = (value: number) => `${number(value / 100)} ₽`;
function Delta({ value }: { value: number | null }) {
  return <span className={`eco-owner-month__delta ${value == null || value === 0 ? "" : value > 0 ? "is-positive" : "is-negative"}`}>{value == null ? "Нет базы для сравнения" : value === 0 ? "На уровне прошлого месяца" : `${value > 0 ? "+" : ""}${number(value)}% к прошлому месяцу`}</span>;
}
export default function OwnerMonthCard({ refreshToken }: { refreshToken: number | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/dashboard/owner-month", { cache: "no-store", signal: controller.signal }).then(async response => { if (!response.ok) throw new Error(); return await response.json() as Data; }).then(value => { setData(value); setError(false); }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [refreshToken]);
  const month = data ? new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${data.period.month}-01T12:00:00Z`)) : "текущий месяц";
  return <section className="eco-ops-card eco-owner-month" aria-label="Итоги месяца и план филиала">
    <header><div><h2>Продажи за {month}</h2><p>{data?.branchName ?? "Текущий филиал"}</p></div><Link href="/warehouse/product-analytics?tab=sales-plan&salesTab=plan">План продаж →</Link></header>
    {error && <p role="status">Не удалось обновить итоги месяца. {data ? "Показаны предыдущие данные." : "Нажмите «Обновить» вверху дашборда."}</p>}
    {!data && !error && <p role="status">Загружаем итоги и план продаж…</p>}
    {data && <><div className="eco-owner-month__totals"><div><span>Выручка за месяц</span><strong>{money(data.revenueCents)}</strong><Delta value={data.revenueDeltaPercent} /></div><div><span>Отгрузки за месяц</span><strong>{number(data.shipmentsCount)}</strong><Delta value={data.shipmentsDeltaPercent} /></div></div>
      <p className="eco-owner-month__comparison">Сравнение: 1–{data.period.comparisonDays} числа текущего и прошлого месяца. Учитываются проведённые отгрузки.</p>
      <h3>План продаж филиала</h3>
      {data.planError ? <p role="status">{data.planError}</p> : !data.plans.length ? <p>План на этот месяц ещё не задан. <Link href="/warehouse/product-analytics?tab=sales-plan&salesTab=plan">Задать план</Link></p> : <div className="eco-owner-month__plans">{data.plans.map(row => {
        const percent = row.actual == null ? null : row.actual / row.target * 100;
        const value = (n: number) => row.money ? money(n) : `${number(n)} ${row.unit}`;
        return <div className="eco-owner-month__plan" key={row.id}><div><b>{row.title}</b><span>{row.actual == null ? "Факт уточняется" : `${value(row.actual)} / ${value(row.target)}`}</span><strong>{percent == null ? "—" : `${number(percent)}%`}</strong></div><progress max={100} value={Math.min(100, Math.max(0, percent ?? 0))} aria-label={`${row.title}: выполнение плана`} /></div>;
      })}</div>}
    </>}
  </section>;
}
