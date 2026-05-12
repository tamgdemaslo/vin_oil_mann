"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type CurrentShift = {
  id: string;
  shiftDate: string;
  startedAt: string;
  endedAt: string | null;
  closeType: string;
  latePenaltyCents: number | null;
} | null;
type CurrentCashShift = {
  id: string;
  status: "open" | "closed";
  openedAt: string;
} | null;
type UserRole = "owner" | "admin" | "master" | null;

const SHIFT_EVENT = "eco-shift-changed";

function notifyShiftChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SHIFT_EVENT));
  }
}

export default function ShiftButton() {
  const router = useRouter();
  const [current, setCurrent] = useState<CurrentShift>(null);
  const [currentCashShift, setCurrentCashShift] = useState<CurrentCashShift>(null);
  const [role, setRole] = useState<UserRole>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/auth/session").then((r) => r.json()).catch(() => ({ user: null })),
      fetch("/api/shifts/current").then((r) => r.json()).catch(() => null),
      fetch("/api/cash").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([sessionData, shiftData, cashData]) => {
        if (cancelled) return;
        setRole(sessionData?.user?.role ?? null);
        setCurrent(shiftData);
        setCurrentCashShift(cashData?.shift ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setRole(null);
          setCurrent(null);
          setCurrentCashShift(null);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  async function startShift() {
    setError(null);
    setActionLoading(true);
    try {
      const r = await fetch("/api/shifts/start", { method: "POST" });
      let data: { error?: string; id?: string; shiftDate?: string; startedAt?: string };
      try {
        data = await r.json();
      } catch {
        setError(r.ok ? "Ошибка ответа сервера" : `Ошибка ${r.status}. Проверьте консоль сервера.`);
        return;
      }
      if (!r.ok) {
        setError(data.error ?? "Ошибка");
        return;
      }
      setCurrent({
        id: data.id!,
        shiftDate: data.shiftDate!,
        startedAt: data.startedAt!,
        endedAt: null,
        closeType: "by_employee",
        latePenaltyCents: null,
      });
      notifyShiftChanged();
    } finally {
      setActionLoading(false);
    }
  }

  async function endShift() {
    setError(null);
    setActionLoading(true);
    try {
      const r = await fetch("/api/shifts/end", { method: "POST" });
      let data: { error?: string };
      try {
        data = await r.json();
      } catch {
        setError(r.ok ? "Ошибка ответа сервера" : `Ошибка ${r.status}. Проверьте консоль сервера.`);
        return;
      }
      if (!r.ok) {
        setError(data.error ?? "Ошибка");
        return;
      }
      setCurrent(null);
      notifyShiftChanged();
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <span className="text-sm text-zinc-500">Загрузка…</span>
      </div>
    );
  }

  const hasAnyActiveShift = !!current || currentCashShift?.status === "open";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
      {hasAnyActiveShift ? (
        <>
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
            {current
              ? `Смена открыта с ${new Date(current.startedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`
              : `Кассовая смена открыта с ${new Date(currentCashShift?.openedAt ?? "").toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`}
          </p>
          {role === "admin" && (
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Для администратора закрытие рабочей смены выполняется при закрытии кассовой.
            </p>
          )}
          {current?.latePenaltyCents != null && current.latePenaltyCents > 0 && (
            <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
              Штраф за опоздание: {(current.latePenaltyCents / 100).toFixed(0)} ₽
            </p>
          )}
          {role !== "admin" && current && (
            <button
              type="button"
              onClick={endShift}
              disabled={actionLoading}
              className="mt-3 w-full rounded-lg bg-zinc-200 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-300 disabled:opacity-50 dark:bg-zinc-600 dark:hover:bg-zinc-500"
            >
              {actionLoading ? "…" : "Смена окончена"}
            </button>
          )}
        </>
      ) : (
        <>
          {role === "admin" ? (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Рабочая смена администратора открывается вместе с кассовой.
              </p>
              <button
                type="button"
                onClick={() => router.push("/cash")}
                className="mt-3 w-full rounded-lg bg-emerald-500 py-2 text-sm font-medium text-white hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-700"
              >
                Открыть кассовую смену
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">Сегодня смена не начата</p>
              <button
                type="button"
                onClick={startShift}
                disabled={actionLoading}
                className="mt-3 w-full rounded-lg bg-amber-500 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-700"
              >
                {actionLoading ? "…" : "Я на смене"}
              </button>
            </>
          )}
        </>
      )}
      {role === "admin" && current && (
        <button
          type="button"
          onClick={() => router.push("/cash")}
          className="mt-3 w-full rounded-lg bg-zinc-200 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-300 dark:bg-zinc-600 dark:hover:bg-zinc-500"
        >
          Перейти в кассу для закрытия
        </button>
      )}
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
