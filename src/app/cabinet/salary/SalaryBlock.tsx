"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCurrentMonthRange, useOwnerUsers } from "../useOwnerUsers";

type PayrollByLogin = {
  shiftTotalCents: number;
  pieceworkCents: number;
  bonusPenaltyCents: number;
  paidOutCents: number;
  remainingCents: number;
  totalCents: number;
  shiftsCount: number;
};

type Payroll = {
  dateFrom: string;
  dateTo: string;
  byLogin: Record<string, PayrollByLogin>;
  vehicleHistory: unknown[];
};

export default function SalaryBlock({ role, login, embedded }: { role: string; login: string; embedded?: boolean }) {
  const defaults = getCurrentMonthRange();
  const [data, setData] = useState<Payroll | null>(null);
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
      .then((payload) => setData(payload))
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

  const entries = data?.byLogin ? Object.entries(data.byLogin) : [];
  const targetLogin = isOwner && userFilter ? userFilter : login;
  const row = data?.byLogin?.[targetLogin];

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
          {loading ? "…" : "Рассчитать"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        По умолчанию показан текущий месяц{isOwner ? " по всем сотрудникам" : ""}.
      </p>

      {data && (
        <div className="mt-6 space-y-4">
          {isOwner && entries.length > 1 ? (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
                    <th className="px-4 py-3 font-medium text-zinc-500">Сотрудник</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Смен</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Ставки смен</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Сдельная часть</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Бонусы/штрафы</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Выплачено</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">К выдаче</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([userLogin, r]) => (
                    <tr key={userLogin} className="border-b border-zinc-100 dark:border-zinc-700">
                      <td className="px-4 py-3 font-medium">{userLogin}</td>
                      <td className="px-4 py-3">{r.shiftsCount}</td>
                      <td className="px-4 py-3">{(r.shiftTotalCents / 100).toFixed(2)} ₽</td>
                      <td className="px-4 py-3">{(r.pieceworkCents / 100).toFixed(2)} ₽</td>
                      <td className="px-4 py-3">{(r.bonusPenaltyCents / 100).toFixed(2)} ₽</td>
                      <td className="px-4 py-3">{(r.paidOutCents / 100).toFixed(2)} ₽</td>
                      <td className="px-4 py-3">{(r.remainingCents / 100).toFixed(2)} ₽</td>
                      <td className="px-4 py-3 font-medium">{(r.totalCents / 100).toFixed(2)} ₽</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : row ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-800">
              <p className="text-zinc-600 dark:text-zinc-400">
                Период: {data.dateFrom} — {data.dateTo}
              </p>
              <ul className="mt-3 space-y-1 text-sm">
                <li>Смен: {row.shiftsCount}</li>
                <li>Ставки смен: {(row.shiftTotalCents / 100).toFixed(2)} ₽</li>
                <li>Сдельная часть: {(row.pieceworkCents / 100).toFixed(2)} ₽</li>
                <li>Бонусы и штрафы: {(row.bonusPenaltyCents / 100).toFixed(2)} ₽</li>
                <li>Выплачено по РКО: {(row.paidOutCents / 100).toFixed(2)} ₽</li>
                <li>К выдаче: {(row.remainingCents / 100).toFixed(2)} ₽</li>
                <li className="font-semibold">Итого: {(row.totalCents / 100).toFixed(2)} ₽</li>
              </ul>
            </div>
          ) : null}
        </div>
      )}

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
