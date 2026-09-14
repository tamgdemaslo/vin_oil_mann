"use client";

import {
  ArrowLeft,
  CalendarDays,
  Clock3,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BookingRecordCard, { type BookingRecord } from "../../BookingRecordCard";
import PublicBookingHeader from "../../PublicBookingHeader";
import styles from "../../booking.module.css";

type ManagedBooking = BookingRecord & {
  customerName: string;
  comment: string | null;
  cancellationReason: string | null;
};

type Slot = {
  startsAt: string;
  endsAt?: string;
  localTime: string;
  master: { membershipId: string; name: string; position: string | null };
};

type NearestDay = { localDate: string; slots: Slot[] };

class ApiError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string; code?: string }) | null;
  if (!response.ok) throw new ApiError(body?.error || "Не удалось выполнить запрос", body?.code || "booking_request_failed", response.status);
  if (!body) throw new ApiError("Сервис вернул пустой ответ", "booking_empty_response", response.status);
  return body;
}

function branchToday(timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function localDateLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long" }).format(new Date(`${value}T12:00:00Z`));
}

function formattedDate(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(new Date(value));
}

function formattedTime(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value));
}

function requestError(error: unknown) {
  if (!(error instanceof ApiError)) return "Не удалось связаться с сервером. Проверьте интернет и повторите.";
  if (error.status === 429 || error.code === "booking_rate_limited") return "Слишком много запросов. Подождите немного и повторите.";
  if (error.status >= 500) return "Сервис временно недоступен. Повторите попытку позже.";
  return error.message;
}

export default function ManageBookingClient({ token }: { token: string }) {
  const [booking, setBooking] = useState<ManagedBooking | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "not_found" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [nearestLoading, setNearestLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [slotError, setSlotError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"details" | "reschedule" | "cancel">("details");
  const [localDate, setLocalDate] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [nearestDays, setNearestDays] = useState<NearestDay[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState("");
  const bookingAbortRef = useRef<AbortController | null>(null);
  const slotsAbortRef = useRef<AbortController | null>(null);
  const activeSlotsKeyRef = useRef("");

  const slotsKey = useMemo(() => booking ? JSON.stringify({
    branchId: booking.branch.id,
    serviceIds: booking.services.map((service) => service.id).filter(Boolean).sort(),
    localDate,
    durationMinutes: booking.durationMinutes,
    timezone: booking.branch.timezone,
  }) : "", [booking, localDate]);
  const slotMasterNames = useMemo(() => new Set(slots.map((slot) => slot.master.name)), [slots]);

  const loadBooking = useCallback(async () => {
    bookingAbortRef.current?.abort();
    const controller = new AbortController();
    bookingAbortRef.current = controller;
    setLoadState("loading");
    setLoadError("");
    try {
      const data = await readJson<{ booking: ManagedBooking }>(await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}`, { signal: controller.signal }));
      setBooking(data.booking);
      setLocalDate(branchToday(data.booking.branch.timezone));
      const requestedAction = new URLSearchParams(window.location.search).get("action");
      setMode(data.booking.status !== "CANCELLED" && requestedAction === "reschedule" ? "reschedule" : data.booking.status !== "CANCELLED" && requestedAction === "cancel" ? "cancel" : "details");
      setLoadState("loaded");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof ApiError && error.status === 404) {
        setLoadState("not_found");
        setLoadError(error.message);
      } else {
        setLoadState("error");
        setLoadError(requestError(error));
      }
    }
  }, [token]);

  useEffect(() => {
    void loadBooking();
    return () => bookingAbortRef.current?.abort();
  }, [loadBooking]);

  const loadSlots = useCallback(async () => {
    if (!booking || !localDate || mode !== "reschedule") return;
    slotsAbortRef.current?.abort();
    const controller = new AbortController();
    slotsAbortRef.current = controller;
    const requestKey = slotsKey;
    activeSlotsKeyRef.current = requestKey;
    setBusy(true);
    setNearestLoading(false);
    setSlots([]);
    setNearestDays([]);
    try {
      const availability = await readJson<{ slots: Slot[]; message?: string }>(await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ localDate }),
      }));
      if (activeSlotsKeyRef.current !== requestKey) return;
      setSlots(availability.slots);
      setBusy(false);
      if (!availability.slots.length) {
        setSlotError(availability.message || "На выбранную дату свободного времени нет.");
        setNearestLoading(true);
        const nearest = await readJson<{ days: NearestDay[] }>(await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}/availability`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ localDate, searchNearest: true }),
        }));
        if (activeSlotsKeyRef.current !== requestKey) return;
        setNearestDays(nearest.days);
        setNearestLoading(false);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (activeSlotsKeyRef.current !== requestKey) return;
      setSlotError(requestError(error));
    } finally {
      if (activeSlotsKeyRef.current === requestKey) {
        setBusy(false);
        setNearestLoading(false);
      }
    }
  }, [booking, localDate, mode, slotsKey, token]);

  useEffect(() => {
    if (mode === "reschedule") void loadSlots();
    return () => slotsAbortRef.current?.abort();
  }, [loadSlots, mode]);

  function changeDate(value: string) {
    setLocalDate(value);
    setSelectedSlot(null);
    setSlots([]);
    setNearestDays([]);
    setSlotError("");
    setActionError("");
  }

  async function reschedule() {
    if (!selectedSlot || !booking) return;
    setBusy(true);
    setActionError("");
    try {
      const data = await readJson<{ booking: ManagedBooking; notification: { state: "DELIVERED" | "QUEUED" | "NOT_CONFIRMED" | "NOT_AVAILABLE" } }>(await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startsAt: selectedSlot.startsAt, masterMembershipId: selectedSlot.master.membershipId }),
      }));
      setBooking(data.booking);
      setMode("details");
      window.history.replaceState({}, "", window.location.pathname);
      const statusText = data.booking.confirmationState === "PENDING"
        ? "Заявка на перенос принята. Новое время предварительное."
        : "Запись перенесена. Новое время подтверждено.";
      setNotice(statusText);
      setSelectedSlot(null);
    } catch (error) {
      const message = requestError(error);
      setActionError(message);
      if (error instanceof ApiError && ["booking_slot_taken", "booking_outside_schedule", "booking_nonstandard_start", "booking_master_unavailable"].includes(error.code)) {
        setSelectedSlot(null);
        await loadSlots();
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setActionError("");
    try {
      const data = await readJson<{ booking: ManagedBooking }>(await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }));
      setBooking(data.booking);
      setMode("details");
      window.history.replaceState({}, "", window.location.pathname);
      setNotice("Запись отменена.");
    } catch (error) {
      setActionError(requestError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`${styles.publicRoot} ${styles.manageRoot}`}>
      <PublicBookingHeader secureLink />

      <section className={styles.manageShell}>
        {loadState === "loading" ? (
          <div className={styles.managePanel}><div className={styles.skeleton}><i /><i /><i /></div></div>
        ) : loadState === "error" ? (
          <div className={styles.managePanel}>
            <span className={styles.cancelledIcon}><RefreshCw aria-hidden /></span>
            <h1>Не удалось загрузить запись</h1><p>{loadError}</p>
            <button className={styles.primaryButton} type="button" onClick={() => void loadBooking()}>Повторить</button>
          </div>
        ) : loadState === "not_found" || !booking ? (
          <div className={styles.managePanel}>
            <span className={styles.cancelledIcon}><XCircle aria-hidden /></span>
            <h1>Запись не найдена</h1><p>{loadError || "Сервер подтвердил, что ссылка недействительна или была заменена."}</p>
            <a className={styles.primaryButton} href="/booking">Создать новую запись</a>
          </div>
        ) : (
          <div className={styles.managePanel}>
            {actionError && mode !== "reschedule" && <div className={styles.error} role="alert">{actionError}</div>}

            {mode === "details" ? <>
              <BookingRecordCard
                booking={booking}
                managementUrl={`/booking/manage/${encodeURIComponent(token)}`}
                notice={notice}
                onReschedule={() => { setMode("reschedule"); setNotice(""); setActionError(""); setSlotError(""); setSelectedSlot(null); setLocalDate(branchToday(booking.branch.timezone)); window.history.replaceState({}, "", `${window.location.pathname}?action=reschedule`); }}
                onCancel={() => { setMode("cancel"); setNotice(""); setActionError(""); window.history.replaceState({}, "", `${window.location.pathname}?action=cancel`); }}
              />
            </> : mode === "reschedule" ? <div className={styles.manageEditor}>
              <button type="button" className={styles.backLink} onClick={() => { setMode("details"); setActionError(""); setSlotError(""); window.history.replaceState({}, "", window.location.pathname); }}><ArrowLeft aria-hidden /> К записи</button>
              <h2>Новое время</h2><p>Текущее время сохранится, пока вы не подтвердите перенос.</p>
              <div className={styles.manageDateRow}><label><span>Дата</span><input type="date" min={branchToday(booking.branch.timezone)} value={localDate} onChange={(event) => changeDate(event.target.value)} /></label><button type="button" className={styles.secondaryButton} onClick={() => void loadSlots()} disabled={busy || nearestLoading}>Обновить время</button></div>
              {actionError && <div className={styles.warning} role="alert">{actionError}</div>}
              {slotError && <div className={styles.neutralNotice}>{slotError}</div>}
              {busy ? <div className={styles.slotSkeleton}><i /><i /><i /><i /></div> : <div className={styles.slotGrid}>{slots.map((slot) => <button type="button" key={`${slot.startsAt}-${slot.master.membershipId}`} className={selectedSlot?.startsAt === slot.startsAt && selectedSlot.master.membershipId === slot.master.membershipId ? styles.selectedSlot : ""} onClick={() => { setSelectedSlot(slot); setSlotError(""); }}><strong>{slot.localTime}</strong>{slotMasterNames.size > 1 && <span>{slot.master.name}</span>}</button>)}</div>}
              {nearestLoading && <div className={styles.neutralNotice}>Ищем ближайшие даты со свободным временем…</div>}
              {!busy && nearestDays.length > 0 && <div className={styles.nearestDays}><strong>Ближайшие даты со свободным временем</strong><div>{nearestDays.map((day) => <button type="button" key={day.localDate} onClick={() => changeDate(day.localDate)}><CalendarDays aria-hidden /><span>{localDateLabel(day.localDate)}<small>с {day.slots[0]?.localTime}</small></span></button>)}</div></div>}
              {selectedSlot && <div className={styles.rescheduleComparison}><div><span>Было</span><strong>{formattedDate(booking.startsAt, booking.branch.timezone)}, {formattedTime(booking.startsAt, booking.branch.timezone)}</strong><small>Мастер: {booking.master?.name || "не указан"}</small></div><div><span>Станет</span><strong>{localDateLabel(localDate)}, {selectedSlot.localTime}</strong><small>Мастер: {selectedSlot.master.name}</small></div></div>}
              <div className={styles.manageActions}><button type="button" className={styles.primaryButton} onClick={() => void reschedule()} disabled={!selectedSlot || busy}><Clock3 aria-hidden /> Подтвердить перенос</button></div>
            </div> : <div className={styles.manageEditor}>
              <button type="button" className={styles.backLink} onClick={() => { setMode("details"); setActionError(""); window.history.replaceState({}, "", window.location.pathname); }}><ArrowLeft aria-hidden /> К записи</button>
              <h2>Отменить запись?</h2><p>Отменить запись на {formattedDate(booking.startsAt, booking.branch.timezone)} в {formattedTime(booking.startsAt, booking.branch.timezone)}? Слот станет доступен другим клиентам.</p>
              <label className={styles.cancelReason}><span>Причина — необязательно</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Например, изменились планы" /></label>
              <div className={styles.manageActions}><button type="button" className={styles.dangerButton} onClick={() => void cancel()} disabled={busy}>{busy ? "Отменяем…" : "Да, отменить запись"}</button><button type="button" className={styles.secondaryButton} onClick={() => { setMode("details"); window.history.replaceState({}, "", window.location.pathname); }}>Оставить как есть</button></div>
            </div>}
          </div>
        )}
      </section>
    </main>
  );
}
