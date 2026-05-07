"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCurrentMonthRange, useOwnerUsers } from "../useOwnerUsers";

type Shift = {
  id: string;
  userLogin: string;
  shiftDate: string;
  startedAt: string;
  endedAt: string | null;
  closeType: string;
  closedByLogin: string | null;
  latePenaltyCents: number | null;
  unclosedPenaltyCents: number | null;
};

const closeTypeLabel: Record<string, string> = {
  by_employee: "закрыта сотрудником",
  by_owner: "закрыта владельцем",
  auto: "закрыта автоматически",
};

export default function ShiftsList({ role, embedded }: { role: string; embedded?: boolean }) {
  const defaults = getCurrentMonthRange();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [userFilter, setUserFilter] = useState("");
  const [closing, setClosing] = useState<string | null>(null);
  const autoLoadedRef = useRef(false);

  const isOwner = role === "owner";
  const { users } = useOwnerUsers(isOwner);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (isOwner && userFilter) params.set("user", userFilter);
    fetch(`/api/shifts?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => setShifts(Array.isArray(data) ? data : []))
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

  async function closeByOwner(shiftId: string) {
    setClosing(shiftId);
    try {
      const r = await fetch(`/api/shifts/${shiftId}/close-by-owner`, { method: "POST" });
      if (r.ok) {
        setShifts((prev) =>
          prev.map((s) =>
            s.id === shiftId
              ? {
                  ...s,
                  endedAt: new Date().toISOString(),
                  closeType: "by_owner",
                  closedByLogin: "you",
                }
              : s
          )
        );
      }
    } finally {
      setClosing(null);
    }
  }

  if (loading) return <p className="mt-4 text-zinc-500">Загрузка…</p>;

  return (
    <>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        />
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
          {loading ? "…" : "Обновить"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        По умолчанию показан текущий месяц{isOwner ? " по всем сотрудникам" : ""}.
      </p>
      <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
              {isOwner && <th className="px-4 py-3 font-medium text-zinc-500">Сотрудник</th>}
              <th className="px-4 py-3 font-medium text-zinc-500">Дата</th>
              <th className="px-4 py-3 font-medium text-zinc-500">Начало</th>
              <th className="px-4 py-3 font-medium text-zinc-500">Окончание</th>
              <th className="px-4 py-3 font-medium text-zinc-500">Закрытие</th>
              <th className="px-4 py-3 font-medium text-zinc-500">Штрафы</th>
              {isOwner && <th className="px-4 py-3 font-medium text-zinc-500" />}
            </tr>
          </thead>
          <tbody>
            {shifts.map((s) => (
              <tr key={s.id} className="border-b border-zinc-100 dark:border-zinc-700">
                {isOwner && <td className="px-4 py-3">{s.userLogin}</td>}
                <td className="px-4 py-3">{s.shiftDate}</td>
                <td className="px-4 py-3">
                  {new Date(s.startedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="px-4 py-3">
                  {s.endedAt
                    ? new Date(s.endedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
                    : "—"}
                </td>
                <td className="px-4 py-3">{closeTypeLabel[s.closeType] ?? s.closeType}</td>
                <td className="px-4 py-3">
                  {[s.latePenaltyCents, s.unclosedPenaltyCents]
                    .filter((c) => c != null && c > 0)
                    .map((c) => `${(c! / 100).toFixed(0)} ₽`)
                    .join(", ") || "—"}
                </td>
                {isOwner && (
                  <td className="px-4 py-3">
                    {!s.endedAt && (
                      <button
                        type="button"
                        disabled={closing === s.id}
                        onClick={() => closeByOwner(s.id)}
                        className="rounded bg-amber-500 px-2 py-1 text-xs text-white hover:bg-amber-600 disabled:opacity-50"
                      >
                        {closing === s.id ? "…" : "Закрыть"}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {shifts.length === 0 && (
          <p className="px-4 py-8 text-center text-zinc-500">Нет смен за выбранный период.</p>
        )}
      </div>
      {!embedded && (
        <p className="mt-4">
          <Link href="/cabinet" className="text-sm text-amber-600 hover:underline dark:text-amber-400">
            ← В личный кабинет
          </Link>
        </p>
      )}
    </>
  );
}
