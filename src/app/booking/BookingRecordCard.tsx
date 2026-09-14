"use client";

import {
  Car,
  Clock3,
  Copy,
  LoaderCircle,
  MapPin,
  MessageCircle,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import styles from "./booking.module.css";

export type BookingRecord = {
  id: string;
  branch: { id: string; name: string; timezone: string; address: string | null; phone: string | null };
  customerName?: string;
  vehicle: { make: string; model: string; year: number | null; plate: string | null; vin: string | null } | null;
  master: { membershipId: string; name: string; position: string | null } | null;
  services: Array<{ id: string | null; name: string; durationMinutes: number }>;
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  status: string;
  confirmationState: string;
  requiresConfirmation: boolean;
  clarificationRequired?: boolean;
};

export type TelegramState = "loading" | "available" | "connected" | "unavailable" | "error";

type Props = {
  booking: BookingRecord;
  managementUrl: string;
  title?: string;
  notice?: string;
  initialTelegramState?: TelegramState;
  onReschedule?: () => void;
  onCancel?: () => void;
};

function formattedDate(value: string, timeZone: string) {
  const text = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone }).format(new Date(value));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formattedTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone }).format(new Date(value));
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} ч` : null, rest ? `${rest} мин` : null].filter(Boolean).join(" ");
}

function actionUrl(url: string, action: "reschedule" | "cancel") {
  return `${url}${url.includes("?") ? "&" : "?"}action=${action}`;
}

function managementToken(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    const prefix = "/booking/manage/";
    return parsed.pathname.startsWith(prefix) ? parsed.pathname.slice(prefix.length).split("/")[0] : "";
  } catch {
    return "";
  }
}

export default function BookingRecordCard({
  booking,
  managementUrl,
  title = "Моя запись",
  notice,
  initialTelegramState = "loading",
  onReschedule,
  onCancel,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [telegramState, setTelegramState] = useState<TelegramState>(initialTelegramState);
  const [telegramBusy, setTelegramBusy] = useState(false);
  const cancelled = booking.status === "CANCELLED";
  const pending = booking.confirmationState === "PENDING";
  const statusLabel = cancelled ? "Запись отменена" : pending ? "Время предварительное" : "Запись подтверждена";

  const refreshTelegramState = useCallback(async () => {
    if (cancelled) return;
    const token = managementToken(managementUrl);
    if (!token) return setTelegramState("error");
    try {
      const response = await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}/telegram-link`);
      const body = await response.json().catch(() => null) as { telegram?: { state?: TelegramState } } | null;
      if (!response.ok) throw new Error("telegram_status_failed");
      setTelegramState(body?.telegram?.state || "unavailable");
    } catch {
      setTelegramState("error");
    }
  }, [cancelled, managementUrl]);

  useEffect(() => {
    if (initialTelegramState === "loading") void refreshTelegramState();
  }, [initialTelegramState, refreshTelegramState]);

  async function copyLink() {
    const absoluteUrl = new URL(managementUrl, window.location.origin).toString();
    await navigator.clipboard.writeText(absoluteUrl);
    setCopied(true);
  }

  async function connectTelegram() {
    const token = managementToken(managementUrl);
    if (!token) return setTelegramState("error");
    setTelegramBusy(true);
    try {
      const response = await fetch(`/api/public/booking/manage/${encodeURIComponent(token)}/telegram-link`, { method: "POST" });
      const body = await response.json().catch(() => null) as { linkUrl?: string; code?: string } | null;
      if (!response.ok || !body?.linkUrl) {
        setTelegramState(body?.code === "telegram_not_configured" ? "unavailable" : "error");
        return;
      }
      window.location.assign(body.linkUrl);
    } catch {
      setTelegramState("error");
    } finally {
      setTelegramBusy(false);
    }
  }

  return (
    <article className={styles.recordCard} aria-live="polite">
      <header className={styles.recordHeading}>
        <div>
          <span className={styles.recordTitle}>{title}</span>
          <span className={cancelled ? styles.statusCancelled : pending ? styles.statusPending : styles.statusConfirmed}>{statusLabel}</span>
        </div>
        <h1>{formattedDate(booking.startsAt, booking.branch.timezone)}</h1>
        <strong className={styles.recordTime}>{formattedTime(booking.startsAt, booking.branch.timezone)}–{formattedTime(booking.endsAt, booking.branch.timezone)}</strong>
      </header>

      {notice && <div className={styles.manageNotice} role="status">{notice}</div>}

      <dl className={styles.recordFacts}>
        <div><dt><MapPin aria-hidden /> Филиал</dt><dd>{booking.branch.name}{booking.branch.address && <small>{booking.branch.address}</small>}</dd></div>
        {booking.vehicle && <div><dt><Car aria-hidden /> Автомобиль</dt><dd>{booking.vehicle.make} {booking.vehicle.model}<small>{[booking.vehicle.year, booking.vehicle.plate, booking.vehicle.vin].filter(Boolean).join(" · ")}</small></dd></div>}
        <div className={styles.recordServices}><dt><Wrench aria-hidden /> Услуги</dt><dd>{booking.services.map((service) => service.name).join(", ")}<small><Clock3 aria-hidden /> {durationLabel(booking.durationMinutes)}</small></dd></div>
        {booking.master?.name && <div><dt><UserRound aria-hidden /> Мастер</dt><dd>{booking.master.name}</dd></div>}
      </dl>

      {pending && !cancelled && <div className={styles.pendingNotice}><ShieldCheck aria-hidden /> Администратор проверит условия работ и подтвердит время.</div>}

      {!cancelled ? (
        <div className={styles.recordControls}>
          <div className={styles.manageActions}>
            {onReschedule ? <button type="button" className={styles.secondaryButton} onClick={onReschedule}><RefreshCw aria-hidden /> Перенести</button> : <a className={styles.secondaryButton} href={actionUrl(managementUrl, "reschedule")}><RefreshCw aria-hidden /> Перенести</a>}
            {onCancel ? <button type="button" className={styles.dangerButton} onClick={onCancel}>Отменить запись</button> : <a className={styles.dangerButton} href={actionUrl(managementUrl, "cancel")}>Отменить запись</a>}
            {booking.branch.phone && <a className={styles.phoneLink} href={`tel:${booking.branch.phone.replace(/[^+\d]/g, "")}`}><Phone aria-hidden /> {booking.branch.phone}</a>}
          </div>

          <div className={styles.recordUtilities}>
            <button className={styles.textUtility} type="button" onClick={() => void copyLink()}><Copy aria-hidden /> {copied ? "Ссылка скопирована" : "Скопировать персональную ссылку"}</button>
            {telegramState === "loading" && <span className={styles.telegramState}><LoaderCircle className={styles.searchSpinner} aria-hidden /> Проверяем Telegram…</span>}
            {telegramState === "connected" && <span className={styles.telegramConnected}><MessageCircle aria-hidden /> Напоминания в Telegram подключены</span>}
            {telegramState === "available" && <div className={styles.telegramPrompt}><span>Получайте напоминания о визите в Telegram</span><button type="button" disabled={telegramBusy} onClick={() => void connectTelegram()}>{telegramBusy ? <LoaderCircle className={styles.searchSpinner} aria-hidden /> : <MessageCircle aria-hidden />} Подключить Telegram</button></div>}
            {telegramState === "unavailable" && <span className={styles.telegramState}>Уведомления в Telegram для этого филиала сейчас недоступны.</span>}
            {telegramState === "error" && <span className={styles.telegramError}>Не удалось проверить Telegram. Запись сохранена и доступна по этой ссылке.</span>}
          </div>
        </div>
      ) : <div className={styles.manageActions}><a className={styles.primaryButton} href="/booking">Записаться снова</a></div>}

      <small className={styles.recordSecurity}>Персональная ссылка открывает только эту запись. Не пересылайте её посторонним.</small>
    </article>
  );
}
