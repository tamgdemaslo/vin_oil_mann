"use client";

import { useEffect, useMemo, useState } from "react";

type FinanceResponse = {
  period: { dateFrom: string; dateTo: string };
  formulas: string[];
  summary: {
    demandsCount: number;
    receiptsCount: number;
    writeoffsCount: number;
    salesRevenue: number;
    knownSalesRevenue: number;
    salesCost: number;
    grossProfit: number;
    grossMarginPercent: number | null;
    receiptValue: number;
    writeoffLoss: number;
    operationalProfit: number;
    missingCostRevenue: number;
    missingCostLines: number;
  };
  topProducts: {
    productName: string;
    quantity: number;
    revenue: number;
    cost: number;
    profit: number;
    marginPercent: number | null;
    missingCostLines: number;
  }[];
  rows: {
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
  }[];
};

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function monthStart() {
  return `${today().slice(0, 8)}01`;
}

function formatMoney(value: number | null | undefined) {
  const n = Number(value ?? 0);
  return n.toLocaleString("ru-RU", { style: "currency", currency: "RUB" });
}

function formatQty(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`;
}

function typeLabel(type: string) {
  if (type === "sale") return "Отгрузка";
  if (type === "writeoff") return "Списание";
  return "Приёмка";
}

export default function ProfitClient() {
  const [dateFrom, setDateFrom] = useState(monthStart());
  const [dateTo, setDateTo] = useState(today());
  const [data, setData] = useState<FinanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cards = useMemo(() => {
    if (!data) return [];
    return [
      { label: "Выручка", value: formatMoney(data.summary.salesRevenue) },
      { label: "Себестоимость", value: formatMoney(data.summary.salesCost) },
      { label: "Валовая прибыль", value: formatMoney(data.summary.grossProfit), accent: data.summary.grossProfit >= 0 },
      { label: "Маржа", value: formatPercent(data.summary.grossMarginPercent) },
      { label: "Потери списаний", value: formatMoney(data.summary.writeoffLoss), warning: data.summary.writeoffLoss > 0 },
      { label: "Прибыль после списаний", value: formatMoney(data.summary.operationalProfit), accent: data.summary.operationalProfit >= 0 },
      { label: "Приёмки", value: formatMoney(data.summary.receiptValue) },
      { label: "Без себестоимости", value: `${data.summary.missingCostLines} строк / ${formatMoney(data.summary.missingCostRevenue)}`, warning: data.summary.missingCostLines > 0 },
    ];
  }, [data]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      const res = await fetch(`/api/local-inventory/finance?${params.toString()}`, { cache: "no-store" });
      const json = await readJson<FinanceResponse & { error?: string }>(res);
      if (!res.ok) throw new Error(json?.error ?? "Не удалось загрузить расчёт прибыли");
      setData(json);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Цены и прибыль</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Расчёт строится только по локальным отгрузкам, приёмкам, списаниям и закупочным ценам.
            </p>
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void load();
            }}
          >
            <label className="text-sm">
              <span className="block text-xs font-medium text-zinc-500">С</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-medium text-zinc-500">По</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>
            <button
              type="submit"
              className="self-end rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950"
            >
              Рассчитать
            </button>
          </form>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {cards.map((card) => (
            <div
              key={card.label}
              className={`rounded-lg border p-3 ${
                card.warning
                  ? "border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30"
                  : card.accent
                    ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30"
                    : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950"
              }`}
            >
              <div className="text-xs font-medium text-zinc-500">{card.label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">{card.value}</div>
            </div>
          ))}
          {loading && <div className="text-sm text-zinc-500">Загрузка...</div>}
        </div>
      </section>

      {data && (
        <>
          <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Как считаем</h2>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {data.formulas.map((formula) => (
                <div key={formula} className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                  {formula}
                </div>
              ))}
            </div>
          </section>

          <section className="grid gap-5 xl:grid-cols-2">
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Товары по прибыли</h2>
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  <thead className="bg-zinc-50 dark:bg-zinc-950">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Товар</th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Кол-во</th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Выручка</th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Прибыль</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {data.topProducts.map((row) => (
                      <tr key={row.productName}>
                        <td className="min-w-[260px] px-3 py-2">{row.productName}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatQty(row.quantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.revenue)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(row.profit)}</td>
                      </tr>
                    ))}
                    {data.topProducts.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-8 text-center text-zinc-500">Нет продаж за период.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <h2 className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">Последние строки расчёта</h2>
              <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="min-w-full divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
                  <thead className="bg-zinc-50 dark:bg-zinc-950">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Документ</th>
                      <th className="px-3 py-2 text-left font-medium text-zinc-600 dark:text-zinc-400">Товар</th>
                      <th className="px-3 py-2 text-right font-medium text-zinc-600 dark:text-zinc-400">Прибыль</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {data.rows.slice(0, 60).map((row) => (
                      <tr key={row.id}>
                        <td className="min-w-[150px] px-3 py-2">
                          <div>{row.documentName}</div>
                          <div className="text-xs text-zinc-500">{row.documentDate} · {typeLabel(row.type)}</div>
                        </td>
                        <td className="min-w-[240px] px-3 py-2">
                          <div>{row.productName}</div>
                          <div className="text-xs text-zinc-500">{row.costSource}</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.profit == null ? "—" : formatMoney(row.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
