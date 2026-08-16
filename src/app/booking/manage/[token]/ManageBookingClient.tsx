"use client";

import {
  ArrowLeft,
  CalendarDays,
  Car,
  CheckCircle2,
  Clock3,
  MapPin,
  Phone,
  RefreshCw,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import styles from "../../booking.module.css";

type ManagedBooking = {
  id: string;
  branch: { id: string; name: string; timezone: string; address: string | null; phone: string | null };
  customerName: string;
  vehicle: { make: string; model: string; year: number | null; plate: string | null; vin: string | null } | null;
  master: { membershipId: string; name: string; position: string | null } | null;
  services: Array<{ id: string | null; name: string; durationMinutes: number }>;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: string;
  requiresConfirmation: boolean;
  confirmationState: string;
  comment: string | null;
  cancellationReason: string | null;
};

type Slot = {
  startsAt: string;
  localTime: string;
  master: { membershipId: string; name: string; position: string | null };
};

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(body?.error || "Не удалось выполнить запрос");
  if (!body) throw new Error("Сервис вернул пустой ответ");
  return body;
}

function inputDate(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formattedDate(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(value));
}

function formattedTime(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value));
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} ч` : null, rest ? `${rest} мин` : null].filter(Boolean).join(" ");
}

export default function ManageBookingClient({ token }: { token: string }) {
  const [booking, setBooking] = useState<ManagedBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mode, setMode] = useState<"details" | "reschedule" | "cancel">("details");
  const [localDate, setLocalDate] = useState(inputDate(new Date(Date.now() + 24 * 60 * 60_000)));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState("");

  const loadBooking = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await readJson<{ booking: ManagedBooking }>(await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}`));
      setBooking(data.booking);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Запись не найдена");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { void loadBooking(); }, [loadBooking]);

  const loadSlots = useCallback(async () => {
    setBusy(true);
    setError("");
    setSelectedSlot(null);
    try {
      const data = await readJson<{ slots: Slot[] }>(await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}/availability`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ localDate }),
      }));
      setSlots(data.slots);
    } catch (cause) {
      setSlots([]);
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить свободное время");
    } finally {
      setBusy(false);
    }
  }, [localDate, token]);

  async function reschedule() {
    if (!selectedSlot) return;
    setBusy(true);
    setError("");
    try {
      const data = await readJson<{ booking: ManagedBooking }>(await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startsAt: selectedSlot.startsAt, masterMembershipId: selectedSlot.master.membershipId }),
      }));
      setBooking(data.booking);
      setMode("details");
      setNotice("Запись перенесена. Новое время уже закреплено за вами.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось перенести запись");
      await loadSlots();
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError("");
    try {
      const data = await readJson<{ booking: ManagedBooking }>(await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      }));
      setBooking(data.booking);
      setMode("details");
      setNotice("Запись отменена. Если планы изменятся, создайте новую запись.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отменить запись");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`${styles.publicRoot} ${styles.manageRoot}`}>
      <header className={styles.publicHeader}>
        <a className={styles.brand} href="/client-site"><span aria-hidden>ТГМ</span><strong>Там где масло</strong></a>
        <div><ShieldCheck aria-hidden /><span>Защищённая ссылка<br /><small>доступ только к вашей записи</small></span></div>
      </header>

      <section className={styles.manageShell}>
        {loading ? (
          <div className={styles.managePanel}><div className={styles.skeleton}><i /><i /><i /></div></div>
        ) : !booking ? (
          <div className={styles.managePanel}>
            <span className={styles.cancelledIcon}><XCircle aria-hidden /></span>
            <h1>Запись не найдена</h1>
            <p>{error || "Ссылка недействительна или была заменена."}</p>
            <a className={styles.primaryButton} href="/booking">Создать новую запись</a>
          </div>
        ) : (
          <div className={styles.managePanel}>
            <div className={styles.manageHeading}>
              <div>
                <span className={booking.status === "CANCELLED" ? styles.statusCancelled : booking.confirmationState === "PENDING" ? styles.statusPending : styles.statusConfirmed}>
                  {booking.status === "CANCELLED" ? "Запись отменена" : booking.confirmationState === "PENDING" ? "Ожидает подтверждения" : "Запись подтверждена"}
                </span>
                <h1>Здравствуйте, {booking.customerName}</h1>
                <p>{booking.status === "CANCELLED" ? "Эта запись больше не занимает слот." : "Здесь можно проверить детали, перенести или отменить визит."}</p>
              </div>
              {booking.status !== "CANCELLED" && <CheckCircle2 aria-hidden />}
            </div>

            {notice && <div className={styles.manageNotice} role="status"><CheckCircle2 aria-hidden /> {notice}</div>}
            {error && <div className={styles.error} role="alert">{error}</div>}

            {mode === "details" ? (
              <>
                <dl className={styles.manageFacts}>
                  <div><dt><CalendarDays aria-hidden /> Дата и время</dt><dd>{formattedDate(booking.startsAt, booking.branch.timezone)}<strong>{formattedTime(booking.startsAt, booking.branch.timezone)}–{formattedTime(booking.endsAt, booking.branch.timezone)}</strong></dd></div>
                  <div><dt><MapPin aria-hidden /> Филиал</dt><dd>{booking.branch.name}<small>{booking.branch.address}</small></dd></div>
                  <div><dt><Car aria-hidden /> Автомобиль</dt><dd>{booking.vehicle ? `${booking.vehicle.make} ${booking.vehicle.model}` : "Не указан"}<small>{[booking.vehicle?.year, booking.vehicle?.plate, booking.vehicle?.vin].filter(Boolean).join(" · ")}</small></dd></div>
                  <div><dt><Wrench aria-hidden /> Работы</dt><dd>{booking.services.map((service) => service.name).join(", ")}<small>{durationLabel(booking.durationMinutes)} · мастер {booking.master?.name || "будет назначен"}</small></dd></div>
                </dl>
                {booking.confirmationState === "PENDING" && booking.status !== "CANCELLED" && <div className={styles.pendingNotice}><ShieldCheck aria-hidden /> Это предварительное время, оно пока не подтверждено. Чтобы исключить двойную запись, время учтено в календаре; после проверки администратор свяжется с вами.</div>}
                {booking.status === "CANCELLED" ? (
                  <div className={styles.manageActions}><a className={styles.primaryButton} href="/booking">Записаться снова</a></div>
                ) : (
                  <div className={styles.manageActions}>
                    <button type="button" className={styles.primaryButton} onClick={() => { setMode("reschedule"); setNotice(""); void loadSlots(); }}><RefreshCw aria-hidden /> Перенести</button>
                    <button type="button" className={styles.dangerButton} onClick={() => { setMode("cancel"); setNotice(""); }}>Отменить запись</button>
                    {booking.branch.phone && <a className={styles.phoneLink} href={`tel:${booking.branch.phone.replace(/[^+\d]/g, "")}`}><Phone aria-hidden /> {booking.branch.phone}</a>}
                  </div>
                )}
              </>
            ) : mode === "reschedule" ? (
              <div className={styles.manageEditor}>
                <button type="button" className={styles.backLink} onClick={() => { setMode("details"); setError(""); }}><ArrowLeft aria-hidden /> К записи</button>
                <h2>Новое время</h2>
                <p>Старый слот освободится только после успешного переноса.</p>
                <div className={styles.manageDateRow}>
                  <label><span>Дата</span><input type="date" min={inputDate()} value={localDate} onChange={(event) => setLocalDate(event.target.value)} /></label>
                  <button type="button" className={styles.secondaryButton} onClick={loadSlots} disabled={busy}>Показать время</button>
                </div>
                {busy ? <div className={styles.slotSkeleton}><i /><i /><i /><i /></div> : (
                  <div className={styles.slotGrid}>
                    {slots.map((slot) => <button type="button" key={`${slot.startsAt}-${slot.master.membershipId}`} className={selectedSlot?.startsAt === slot.startsAt && selectedSlot.master.membershipId === slot.master.membershipId ? styles.selectedSlot : ""} onClick={() => setSelectedSlot(slot)}><strong>{slot.localTime}</strong><span>{slot.master.name}</span></button>)}
                    {!slots.length && <div className={styles.empty}>На выбранную дату нет свободного времени.</div>}
                  </div>
                )}
                <div className={styles.manageActions}><button type="button" className={styles.primaryButton} onClick={reschedule} disabled={!selectedSlot || busy}><Clock3 aria-hidden /> Подтвердить перенос</button></div>
              </div>
            ) : (
              <div className={styles.manageEditor}>
                <button type="button" className={styles.backLink} onClick={() => { setMode("details"); setError(""); }}><ArrowLeft aria-hidden /> К записи</button>
                <h2>Отменить запись?</h2>
                <p>Отменить запись на {formattedDate(booking.startsAt, booking.branch.timezone)} в {formattedTime(booking.startsAt, booking.branch.timezone)}? Слот сразу станет доступен другим клиентам.</p>
                <label className={styles.cancelReason}><span>Причина — необязательно</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Например, изменились планы" /></label>
                <div className={styles.manageActions}><button type="button" className={styles.dangerButton} onClick={cancel} disabled={busy}>{busy ? "Отменяем…" : "Да, отменить запись"}</button><button type="button" className={styles.secondaryButton} onClick={() => setMode("details")}>Оставить как есть</button></div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
