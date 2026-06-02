"use client";

import { useState, useEffect, useCallback } from "react";
import { SERVICE_TIME_ZONE } from "@/lib/date-time";
import { toLocalDateInputValue, useOwnerUsers } from "../useOwnerUsers";

type WorkingDayItem = {
  id: string;
  userLogin: string;
  date: string;
  createdByLogin: string;
  source?: "scheduled" | "actual" | "both";
  removable?: boolean;
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function getMonthBounds(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  return {
    dateFrom: toLocalDateInputValue(first),
    dateTo: toLocalDateInputValue(last),
    daysInMonth: last.getDate(),
    startPad: (first.getDay() + 6) % 7,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export default function WorkingDaysBlock() {
  const { users, loading: usersLoading } = useOwnerUsers(true);
  const [selectedLogin, setSelectedLogin] = useState<string | null>(null);
  const [viewDate, setViewDate] = useState(() => new Date());
  const [list, setList] = useState<WorkingDayItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const viewYear = viewDate.getFullYear();
  const viewMonth = viewDate.getMonth();

  const loadWorkingDays = useCallback(() => {
    if (!selectedLogin) {
      setList([]);
      return;
    }
    setLoading(true);
    const { dateFrom, dateTo } = getMonthBounds(viewYear, viewMonth);
    fetch(`/api/working-days?user=${encodeURIComponent(selectedLogin)}&dateFrom=${dateFrom}&dateTo=${dateTo}`)
      .then((r) => r.json())
      .then((data) => setList(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, [selectedLogin, viewYear, viewMonth]);

  useEffect(() => {
    if (!selectedLogin && users.length > 0) {
      setSelectedLogin(users[0].login);
    }
  }, [selectedLogin, users]);

  useEffect(() => {
    loadWorkingDays();
  }, [loadWorkingDays]);

  const getDayItem = (dateStr: string) => list.find((x) => x.date === dateStr) ?? null;
  const dateToId = (dateStr: string) => getDayItem(dateStr)?.id ?? null;
  const isWorking = (dateStr: string) => dateToId(dateStr) != null;

  const handleDayClick = async (dateStr: string) => {
    if (!selectedLogin || toggling) return;
    const item = getDayItem(dateStr);
    if (item && item.removable === false) return;
    const id = item?.id ?? null;
    setToggling(dateStr);
    try {
      if (id) {
        const r = await fetch(`/api/working-days/${id}`, { method: "DELETE" });
        if (r.ok) {
          setList((prev) =>
            prev.flatMap((x) => {
              if (x.id !== id) return [x];
              if (x.source === "both") {
                return [
                  {
                    ...x,
                    id: `actual:${x.userLogin}:${x.date}`,
                    createdByLogin: "system",
                    source: "actual",
                    removable: false,
                  },
                ];
              }
              return [];
            })
          );
        }
      } else {
        const r = await fetch("/api/working-days", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userLogin: selectedLogin, date: dateStr }),
        });
        const data = await r.json();
        if (r.ok && data?.items?.length) setList((prev) => [...data.items, ...prev]);
      }
    } finally {
      setToggling(null);
    }
  };

  const { daysInMonth, startPad } = getMonthBounds(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array(startPad).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  const rows = chunk(cells, 7);
  const monthLabel = new Intl.DateTimeFormat("ru-RU", {
    timeZone: SERVICE_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(viewDate);

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Выберите сотрудника и нажимайте на даты в календаре: клик назначает рабочий день, повторный —
        снимает. Дни с фактической сменой отображаются автоматически.
      </p>
      <div className="flex flex-wrap gap-3 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-emerald-500" />
          Назначенный рабочий день
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-sky-500" />
          Фактическая смена
        </span>
      </div>

      {usersLoading ? (
        <p className="text-zinc-500">Загрузка сотрудников…</p>
      ) : users.length === 0 ? (
        <p className="text-zinc-500">Нет сотрудников.</p>
      ) : (
        <>
          <div>
            <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Сотрудник</p>
            <div className="flex flex-wrap gap-2">
              {users.map((u) => (
                <button
                  key={u.login}
                  type="button"
                  onClick={() => setSelectedLogin(u.login)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    selectedLogin === u.login
                      ? "bg-amber-500 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                  }`}
                >
                  {u.name}
                </button>
              ))}
            </div>
          </div>

          {selectedLogin && (
            <div>
              <div className="mb-3 flex items-center justify-between gap-4">
                <h3 className="text-base font-semibold text-zinc-800 dark:text-zinc-100 capitalize">
                  {monthLabel}
                </h3>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setViewDate(new Date(viewYear, viewMonth - 1, 1))}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewDate(new Date(viewYear, viewMonth + 1, 1))}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
                  >
                    →
                  </button>
                </div>
              </div>

              <div className="inline-block rounded-xl border border-zinc-200 bg-white p-3 shadow-sm dark:border-zinc-700 dark:bg-zinc-800/50">
                <div className="grid grid-cols-7 gap-1 text-center">
                  {WEEKDAYS.map((d) => (
                    <div
                      key={d}
                      className="py-1 text-xs font-medium text-zinc-500 dark:text-zinc-400"
                    >
                      {d}
                    </div>
                  ))}
                  {rows.flatMap((row, rowIdx) =>
                    row.map((day, i) => {
                      const cellKey = rowIdx * 7 + i;
                      if (day === null) {
                        return <div key={`empty-${cellKey}`} className="aspect-square" />;
                      }
                      const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                      const item = getDayItem(dateStr);
                      const working = isWorking(dateStr);
                      const busy = toggling === dateStr;
                      const actualOnly = item?.source === "actual";
                      const both = item?.source === "both";
                      const title = actualOnly
                        ? "Фактическая смена"
                        : both
                          ? "Есть фактическая смена и назначенный рабочий день"
                          : working
                            ? "Снять рабочий день"
                            : "Назначить рабочий день";
                      return (
                        <button
                          key={dateStr}
                          type="button"
                          disabled={busy || actualOnly}
                          onClick={() => handleDayClick(dateStr)}
                          title={title}
                          className={`aspect-square min-w-[2.25rem] rounded-lg text-sm font-medium transition-colors disabled:opacity-50 ${
                            actualOnly
                              ? "bg-sky-500 text-white"
                              : both
                                ? "bg-emerald-500 text-white hover:bg-emerald-600"
                                : working
                                  ? "bg-emerald-500 text-white hover:bg-emerald-600"
                                  : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                          } ${
                            actualOnly ? "cursor-default" : ""
                          }`}
                        >
                          {busy ? "…" : day}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              {loading && (
                <p className="mt-2 text-sm text-zinc-500">Загрузка…</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
