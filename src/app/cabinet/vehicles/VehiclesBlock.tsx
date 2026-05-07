"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCurrentMonthRange, useOwnerUsers } from "../useOwnerUsers";

type VehicleRecord = {
  demandId: string;
  demandName: string;
  date: string;
  agentName: string;
  sumCents: number;
  works: { name: string; quantity: number; priceCents: number }[];
  products: { name: string; pathName?: string; quantity: number; priceCents: number }[];
  earningsByLogin: Record<string, number>;
};

export default function VehiclesBlock({ role, embedded }: { role: string; embedded?: boolean }) {
  const defaults = getCurrentMonthRange();
  const [history, setHistory] = useState<VehicleRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [userFilter, setUserFilter] = useState("");
  const autoLoadedRef = useRef(false);

  const isOwner = role === "owner";
  const { users } = useOwnerUsers(isOwner);

  const load = useCallback(() => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (isOwner && userFilter) params.set("user", userFilter);
    fetch(`/api/payroll?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setHistory(data.vehicleHistory ?? []))
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, isOwner, userFilter]);

  useEffect(() => {
    if (autoLoadedRef.current || !dateFrom || !dateTo) return;
    autoLoadedRef.current = true;
    const timer = window.setTimeout(() => {
      load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dateFrom, dateTo, load]);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">С</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500">По</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          />
        </label>
        {isOwner && (
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          >
            <option value="">Все сотрудники</option>
            {users.map((user) => (
              <option key={user.login} value={user.login}>
                {user.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={load}
          disabled={loading || !dateFrom || !dateTo}
          className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? "…" : "Загрузить"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        Сразу загружается текущий месяц{isOwner ? " по всем сотрудникам" : ""}.
      </p>

      <div className="mt-6 space-y-4">
        {history.map((v) => (
          <div
            key={v.demandId}
            className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
          >
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              {v.demandName} · {v.date}
            </p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Контрагент: {v.agentName || "—"} · Сумма: {(v.sumCents / 100).toFixed(2)} ₽
            </p>
            {v.works.length > 0 && (
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                Работы: {v.works.map((w) => `${w.name} × ${w.quantity}`).join(", ")}
              </p>
            )}
            {v.products.length > 0 && (
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                Товары: {v.products.map((p) => `${p.name} × ${p.quantity}`).join(", ")}
              </p>
            )}
            <p className="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Начисление:{" "}
              {Object.entries(v.earningsByLogin)
                .map(([l, c]) => `${l}: ${(c / 100).toFixed(2)} ₽`)
                .join(", ") || "—"}
            </p>
          </div>
        ))}
        {history.length === 0 && !loading && (dateFrom || dateTo) && (
          <p className="text-zinc-500">
            Нет отгрузок за выбранный период{userFilter && isOwner ? " у выбранного сотрудника" : ""}.
          </p>
        )}
      </div>

      {!embedded && (
        <p className="mt-6">
          <Link href="/cabinet" className="text-sm text-amber-600 hover:underline dark:text-amber-400">
            ← В личный кабинет
          </Link>
        </p>
      )}
    </>
  );
}
