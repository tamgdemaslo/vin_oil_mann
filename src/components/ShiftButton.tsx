"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatServiceTime } from "@/lib/date-time";
import { responseJson } from "@/lib/response-json";
import { invalidateDashboardClientBundle } from "@/lib/dashboard-client";

export type ShiftButtonShift = {
  id: string;
  shiftDate?: string;
  startedAt?: string;
  endedAt?: string | null;
  closeType?: string;
  latePenaltyCents?: number | null;
} | null;

export type ShiftButtonCashShift = {
  id: string;
  status: "open" | "closed";
  openedAt?: string;
} | null;

type UserRole = "owner" | "admin" | "master";

const SHIFT_EVENT = "eco-shift-changed";

function notifyShiftChanged() {
  invalidateDashboardClientBundle();
  window.dispatchEvent(new Event(SHIFT_EVENT));
}

export default function ShiftButton({
  role,
  current,
  currentCashShift,
  loading = false,
}: {
  role: UserRole;
  current: ShiftButtonShift;
  currentCashShift: ShiftButtonCashShift;
  loading?: boolean;
}) {
  const router = useRouter();
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startShift() {
    setError(null);
    setActionLoading(true);
    try {
      const response = await fetch("/api/shifts/start", { method: "POST" });
      let data: { error?: string };
      try {
        data = await responseJson(response);
      } catch {
        setError(response.ok ? "Сервер вернул некорректный ответ." : `Не удалось открыть смену: ошибка ${response.status}.`);
        return;
      }
      if (!response.ok) {
        setError(data.error ?? "Не удалось открыть смену.");
        return;
      }
      notifyShiftChanged();
    } catch {
      setError("Нет связи с сервером. Проверьте подключение и повторите.");
    } finally {
      setActionLoading(false);
    }
  }

  async function endShift() {
    setError(null);
    setActionLoading(true);
    try {
      const response = await fetch("/api/shifts/end", { method: "POST" });
      let data: { error?: string };
      try {
        data = await responseJson(response);
      } catch {
        setError(response.ok ? "Сервер вернул некорректный ответ." : `Не удалось закрыть смену: ошибка ${response.status}.`);
        return;
      }
      if (!response.ok) {
        setError(data.error ?? "Не удалось закрыть смену.");
        return;
      }
      notifyShiftChanged();
    } catch {
      setError("Нет связи с сервером. Проверьте подключение и повторите.");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="eco-shift-control" role="status" aria-live="polite">
        <span className="eco-shift-control__hint">Проверяем состояние смены…</span>
      </div>
    );
  }

  const hasAnyActiveShift = Boolean(current) || currentCashShift?.status === "open";

  return (
    <div className="eco-shift-control">
      {hasAnyActiveShift ? (
        <>
          <p className="eco-shift-control__status">
            {current
              ? `Смена открыта${current.startedAt ? ` с ${formatServiceTime(current.startedAt)}` : ""}`
              : `Кассовая смена открыта${currentCashShift?.openedAt ? ` с ${formatServiceTime(currentCashShift.openedAt)}` : ""}`}
          </p>
          {role === "admin" && (
            <p className="eco-shift-control__hint">Смена администратора закрывается вместе с кассовой.</p>
          )}
          {current?.latePenaltyCents != null && current.latePenaltyCents > 0 && (
            <p className="eco-shift-control__warning">Штраф за опоздание: {(current.latePenaltyCents / 100).toFixed(0)} ₽</p>
          )}
          {role !== "admin" && current && (
            <button type="button" onClick={() => void endShift()} disabled={actionLoading} className="eco-ops-btn eco-ops-btn--ghost">
              {actionLoading ? "Закрываем…" : "Завершить смену"}
            </button>
          )}
        </>
      ) : role === "admin" ? (
        <>
          <p className="eco-shift-control__hint">Рабочая смена администратора открывается вместе с кассовой.</p>
          <button type="button" onClick={() => router.push("/cash#open")} className="eco-ops-btn eco-ops-btn--primary">
            Открыть кассовую смену
          </button>
        </>
      ) : (
        <>
          <p className="eco-shift-control__hint">Сегодня смена ещё не начата.</p>
          <button type="button" onClick={() => void startShift()} disabled={actionLoading} className="eco-ops-btn eco-ops-btn--primary">
            {actionLoading ? "Открываем…" : "Я на смене"}
          </button>
        </>
      )}
      {role === "admin" && current && (
        <button type="button" onClick={() => router.push("/cash#cash-state")} className="eco-ops-btn eco-ops-btn--ghost">
          Перейти к закрытию кассы
        </button>
      )}
      {error && <p className="eco-shift-control__error" role="alert">{error}</p>}
    </div>
  );
}
