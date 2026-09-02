"use client";

import {
  Banknote,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Gauge,
  MessageCircle,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Truck,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import MyPayrollCard, { type EmployeePayrollData, type EmployeePayrollPeriod } from "@/components/dashboard/MyPayrollCard";
import { type EcoBadgeTone } from "@/components/platform/EcoUI";
import { loadDashboardClientBundle } from "@/lib/dashboard-client";
import type { DashboardVariant } from "@/lib/dashboard-variant";
import { SERVICE_TIME_ZONE, formatServiceDayMonth, formatServiceTime } from "@/lib/date-time";

type UserRole = "owner" | "admin" | "master";

function usesOperationalDayCenter(role: UserRole): boolean {
  return role === "admin" || role === "master";
}

type CurrentCashShift = {
  id: string;
  status: "open" | "closed";
  openedAt?: string;
} | null;
type NotificationUrgency = "urgent" | "today" | "soon" | "info";
type DashboardLoadState = "loading" | "ready" | "refreshing" | "partial" | "stale" | "error";
type EmployeePayrollQuery = { period: EmployeePayrollPeriod; dateFrom?: string; dateTo?: string };

type DashboardNotification = {
  id: string;
  urgency: NotificationUrgency;
  title: string;
  description: string;
  deadline?: string | null;
  entityLabel: string;
  entityHref: string;
  actionLabel: string;
};

type AppointmentItem = {
  id: string;
  time: string;
  endTime?: string;
  durationMinutes?: number;
  client: string;
  phone?: string;
  vehicle: string;
  service: string;
  status: string;
  shipmentId: string | null;
  hasShipment?: boolean;
  shipmentStatus?: string;
};

type CrmItem = {
  id: string;
  client: string;
  phone: string;
  title: string;
  status: string;
  deadline: string | null;
  responsible: string;
};

type ShipmentItem = {
  id: string;
  name: string;
  moment: string;
  client: string;
  store: string;
  creator: string;
  applicable: boolean;
  sumCents: number | null;
  paymentStatus: "paid" | "unpaid" | "unknown";
  hasDiagnostic: boolean;
};

type StockItem = {
  id: string;
  name: string;
  available: number;
  minimum: number;
  store: string;
};

type SupplierInvoiceItem = {
  id: string;
  number: string;
  supplier: string;
  dueDate: string | null;
  amountCents: number;
  status: string;
};

type DashboardData = {
  today: string;
  audience: UserRole;
  capabilities: {
    canViewFinance: boolean;
    canViewClientOperations: boolean;
    canManageCash: boolean;
  };
  finance: {
    revenueCents: number;
    grossProfitCents: number | null;
    missingCostLines: number;
    averageCheckCents: number;
    shipmentsCount: number;
    paidCents: number;
    unpaidCents: number;
    cashCents: number;
    cardCents: number;
    paymentSourceLabel: string;
  } | null;
  cash: {
    status: "open" | "closed";
    openedBy: string | null;
    openedAt: string | null;
    startBalanceCents: number | null;
    expectedBalanceCents: number | null;
    expensesCents: number | null;
    withdrawalsCents: number | null;
    discrepancyCents: number | null;
    openedHours: number;
  };
  appointments: {
    totalToday: number;
    confirmedToday: number;
    withoutShipment: number;
    requiresManualLink?: number;
    matchedByRules?: number;
    freeWindows: string[];
    next: AppointmentItem | null;
    rows: AppointmentItem[];
  };
  crm: {
    overdue: number;
    oldestOverdueHours?: number;
    today: number;
    quote: number;
    supplies: number;
    callback: number;
    noResponsible: number;
    rows: CrmItem[];
  } | null;
  shipments: {
    today: number;
    drafts: number;
    applicable: number;
    unpaid: number;
    withoutDiagnostic: number;
    withoutPrecheck: number;
    rows: ShipmentItem[];
  };
  stock: {
    belowMin: number;
    rows: StockItem[];
  } | null;
  suppliers: {
    unpaidInvoices: number;
    amountCents: number;
    rows: SupplierInvoiceItem[];
  } | null;
  diagnostics: {
    active: number;
    withoutPhoto: number;
  };
  messages: {
    total: number;
    needsReply: number;
    unread: number;
    oldest: {
      client: string;
      hours: number;
      href: string;
    } | null;
  } | null;
  alerts: Array<{ id: string; label: string; href: string; count: number; tone: EcoBadgeTone }>;
  notifications: DashboardNotification[];
  notificationCounts: Record<NotificationUrgency | "total", number>;
  documents: Array<{ id: string; type: string; name: string; date: string; sumCents: number; href: string }>;
};

const CASH_SHIFT_EVENT = "eco-cash-shift-changed";

function formatMoneyCents(amountCents: number | null) {
  if (amountCents == null) return "—";
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(amountCents / 100))} ₽`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function formatHours(value?: number | null) {
  if (!value || value <= 0) return "—";
  return `${formatCount(value)} ч`;
}

async function readDashboardResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null) as { error?: unknown } | T | null;
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload ? payload.error : null;
    throw new Error(typeof error === "string" ? error : fallback);
  }
  if (!payload) throw new Error(fallback);
  return payload as T;
}

function todayShortPhrase() {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: SERVICE_TIME_ZONE,
    day: "numeric",
    month: "long",
    weekday: "long",
  })
    .format(new Date())
    .replace(/^./, (char) => char.toUpperCase());
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  return formatServiceTime(value);
}

function formatShortDeadline(value?: string | null) {
  if (!value) return "—";
  const day = formatServiceDayMonth(value);
  const time = formatServiceTime(value);
  if (day === "—" && time === "—") return "—";
  if (time === "—") return day;
  return `${day} · ${time}`;
}

const SCHEDULE_WINDOW_MINUTES = 60;

type ScheduleTimelineItem =
  | { kind: "record"; key: string; start: number; end: number; item: AppointmentItem }
  | { kind: "window"; key: string; start: number; end: number; label: string };

function parseClockMinutes(value?: string | null) {
  const match = String(value ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatClockMinutes(value: number) {
  const safeValue = Math.max(0, Math.min(24 * 60 - 1, Math.round(value)));
  const hours = Math.floor(safeValue / 60);
  const minutes = safeValue % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatTimelineBoundary(value: number) {
  return value >= 24 * 60 ? "24:00" : formatClockMinutes(value);
}

function scheduleWindowLabel(value: string) {
  const start = parseClockMinutes(value);
  if (start === null) return value;
  return `${formatClockMinutes(start)}–${formatClockMinutes(start + SCHEDULE_WINDOW_MINUTES)}`;
}

function buildScheduleTimeline(appointments: AppointmentItem[], freeWindows: string[]) {
  const recordItems: ScheduleTimelineItem[] = appointments.map((item, index) => {
    const start = parseClockMinutes(item.time) ?? 24 * 60 + index;
    const duration = Math.max(30, Math.min(480, Number(item.durationMinutes) || 60));
    return {
      kind: "record",
      key: `record-${item.id}`,
      start,
      end: start + duration,
      item,
    };
  });
  const windowItems: ScheduleTimelineItem[] = freeWindows.flatMap((window, index) => {
    const start = parseClockMinutes(window);
    if (start === null) return [];
    return [
      {
        kind: "window",
        key: `window-${window}-${index}`,
        start,
        end: start + SCHEDULE_WINDOW_MINUTES,
        label: scheduleWindowLabel(window),
      },
    ];
  });

  return [...recordItems, ...windowItems].sort((a, b) => a.start - b.start).slice(0, 100);
}

type PositionedScheduleItem = {
  slot: ScheduleTimelineItem;
  lane: number;
  laneCount: number;
};

function positionScheduleItems(items: ScheduleTimelineItem[]): PositionedScheduleItem[] {
  const result: PositionedScheduleItem[] = [];
  let cluster: ScheduleTimelineItem[] = [];
  let clusterEnd = -1;

  function flushCluster() {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const positioned = cluster.map((slot) => {
      let lane = laneEnds.findIndex((end) => end <= slot.start);
      if (lane === -1) lane = laneEnds.length;
      laneEnds[lane] = slot.end;
      return { slot, lane };
    });
    const laneCount = Math.max(1, laneEnds.length);
    result.push(...positioned.map((item) => ({ ...item, laneCount })));
    cluster = [];
    clusterEnd = -1;
  }

  for (const slot of items.filter((item) => item.start < 24 * 60).sort((a, b) => a.start - b.start)) {
    if (cluster.length && slot.start >= clusterEnd) flushCluster();
    cluster.push(slot);
    clusterEnd = Math.max(clusterEnd, slot.end);
  }
  flushCluster();
  return result;
}

function currentServiceClockMinutes() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SERVICE_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hours = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minutes = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hours * 60 + minutes;
}

function initials(value?: string | null) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] || "—").slice(0, 2).toUpperCase();
}

function toneClass(tone?: EcoBadgeTone | NotificationUrgency) {
  if (tone === "urgent") return "danger";
  if (tone === "today") return "warning";
  if (tone === "soon") return "info";
  if (tone === "rust") return "rust";
  return tone || "neutral";
}

function paymentLabel(status: ShipmentItem["paymentStatus"]) {
  if (status === "paid") return "оплачено";
  if (status === "unpaid") return "не оплачено";
  return "оплата не указана";
}

function paymentTone(status: ShipmentItem["paymentStatus"]) {
  if (status === "paid") return "success";
  if (status === "unpaid") return "warning";
  return "neutral";
}

const SERVICE_ORGANIZATION_LABEL = "Там где масло";

function recordHref(item: AppointmentItem) {
  return `/records?recordId=${encodeURIComponent(item.id)}`;
}

function recordCreateHref() {
  return "/records?new=1";
}

function appointmentShipmentHref(item: AppointmentItem) {
  return item.hasShipment && item.shipmentId
    ? `/shipment/${item.shipmentId}`
    : `/shipment/new?recordId=${encodeURIComponent(item.id)}`;
}

function crmHref(item: CrmItem) {
  return `/crm?dealId=${encodeURIComponent(item.id)}`;
}

function messagesHref(phone?: string | null) {
  return phone ? `/messages?phone=${encodeURIComponent(phone)}` : "/messages";
}

function appointmentStatusKey(status?: string | null) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (/отмен|cancel/.test(normalized)) return "cancelled";
  if (/не приех|no.?show/.test(normalized)) return "no_show";
  if (/уех|left/.test(normalized)) return "left";
  if (/готов|done/.test(normalized)) return "done";
  if (/работ|in.?work/.test(normalized)) return "in_work";
  if (/мест|ожида|waiting/.test(normalized)) return "waiting";
  if (/приех|arrived/.test(normalized)) return "arrived";
  if (/подтверж|confirm/.test(normalized)) return "confirmed";
  return "planned";
}

function appointmentTone(status?: string | null): EcoBadgeTone {
  const key = appointmentStatusKey(status);
  if (key === "cancelled") return "neutral";
  if (key === "no_show") return "warning";
  if (key === "done" || key === "confirmed") return "success";
  if (key === "arrived" || key === "waiting") return "info";
  if (key === "in_work") return "warning";
  return "neutral";
}

function appointmentActions(item: AppointmentItem) {
  const key = appointmentStatusKey(item.status);
  const shipmentAction = item.hasShipment ? "Открыть" : "Создать";
  if (key === "left") {
    return [
      { label: shipmentAction, href: appointmentShipmentHref(item), tone: "primary" as const },
      { label: "Закрыто", href: recordHref(item), tone: "quiet" as const },
    ];
  }
  if (key === "arrived" || key === "waiting") {
    return [
      { label: key === "waiting" ? "В работу" : "На месте", href: recordHref(item), tone: "primary" as const },
      { label: shipmentAction, href: appointmentShipmentHref(item), tone: "quiet" as const },
      { label: "Написать", href: messagesHref(item.phone), tone: "quiet" as const },
    ];
  }
  if (key === "in_work" || key === "done") {
    return [
      { label: key === "done" ? "Уехал" : "Готово", href: recordHref(item), tone: "primary" as const },
      { label: shipmentAction, href: appointmentShipmentHref(item), tone: "quiet" as const },
    ];
  }
  if (key === "cancelled" || key === "no_show") {
    return [
      { label: "Открыть", href: recordHref(item), tone: "quiet" as const },
      { label: "Перенести", href: recordHref(item), tone: "quiet" as const },
    ];
  }
  return [
    { label: "Приехал", href: recordHref(item), tone: "primary" as const },
    { label: "Написать", href: messagesHref(item.phone), tone: "quiet" as const },
    { label: shipmentAction, href: appointmentShipmentHref(item), tone: "quiet" as const },
    { label: "Перенести", href: recordHref(item), tone: "quiet" as const },
  ];
}

function Card({
  title,
  badge,
  href,
  action = "Открыть",
  children,
  flat = false,
  accent = false,
  className = "",
}: {
  title: string;
  badge?: ReactNode;
  href?: string;
  action?: string;
  children: ReactNode;
  flat?: boolean;
  accent?: boolean;
  className?: string;
}) {
  return (
    <section className={`eco-ops-card ${flat ? "is-flat" : ""} ${className}`}>
      <div className="eco-ops-card-head">
        <div className="eco-ops-card-title">
          {accent && <span className="eco-ops-lead-accent" />}
          <h3>{title}</h3>
          {badge}
        </div>
        {href && (
          <Link href={href} className="eco-ops-btn eco-ops-btn--ghost eco-ops-btn--sm">
            {action} <ChevronRight aria-hidden className="eco-icon" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: EcoBadgeTone | NotificationUrgency;
  dot?: boolean;
}) {
  const normalized = toneClass(tone);
  return (
    <span className={`eco-ops-badge is-${normalized}`}>
      {dot && <span className={`eco-ops-dot is-${normalized}`} />}
      {children}
    </span>
  );
}

function StatStrip({
  items,
  dense = false,
}: {
  items: Array<{ label: string; value: ReactNode; tone?: "danger" | "warning" | "success" | "muted" }>;
  dense?: boolean;
}) {
  return (
    <div className={`eco-ops-statstrip ${dense ? "is-dense" : ""}`}>
      {items.map((item) => (
        <div key={item.label} className="eco-ops-statcell">
          <div className="eco-ops-statkey">{item.label}</div>
          <div className={`eco-ops-statval ${item.tone ? `is-${item.tone}` : ""}`}>{item.value}</div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="eco-ops-empty">
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}

function ErrorState({ title, hint, onRetry }: { title: string; hint: string; onRetry?: () => void }) {
  return (
    <div className="eco-ops-empty is-error" role="alert">
      <strong>{title}</strong>
      <span>{hint}</span>
      {onRetry && (
        <button type="button" className="eco-ops-btn eco-ops-btn--ghost eco-ops-btn--sm" onClick={onRetry}>
          <RefreshCw aria-hidden className="eco-icon" />
          Повторить
        </button>
      )}
    </div>
  );
}

function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="eco-ops-loading" role="status" aria-live="polite" aria-label="Загрузка данных">
      <span className="eco-visually-hidden">Загружаем актуальные данные…</span>
      {Array.from({ length: rows }).map((_, index) => (
        <span key={index} aria-hidden />
      ))}
    </div>
  );
}

function RowAction({
  href,
  children,
  tone = "quiet",
}: {
  href: string;
  children: ReactNode;
  tone?: "primary" | "quiet" | "danger";
}) {
  return (
    <Link href={href} className={`eco-ops-row-action is-${tone}`}>
      {children}
    </Link>
  );
}

function CommandSignal({
  label,
  value,
  detail,
  href,
  tone = "neutral",
  primary = false,
  icon: Icon,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  href?: string;
  tone?: EcoBadgeTone;
  primary?: boolean;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const content = (
    <>
      <span className="eco-ops-signal-icon">
        <Icon aria-hidden className="eco-icon" />
      </span>
      <span className="eco-ops-signal-copy">
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </span>
      {href && <ChevronRight aria-hidden className="eco-icon eco-ops-signal-arrow" />}
    </>
  );

  return href ? (
    <Link href={href} className={`eco-ops-signal is-${tone} ${primary ? "is-primary" : ""}`}>
      {content}
    </Link>
  ) : (
    <div className={`eco-ops-signal is-${tone} ${primary ? "is-primary" : ""}`}>{content}</div>
  );
}

function urgencyDot(urgency: NotificationUrgency) {
  if (urgency === "urgent") return "danger";
  if (urgency === "today") return "warning";
  if (urgency === "soon") return "info";
  return "idle";
}

type MobileProblemTone = "danger" | "warning" | "info" | "neutral" | "success";

type MobileProblem = {
  id: string;
  tone: MobileProblemTone;
  severity: number;
  deadlineWeight: number;
  impact: number;
  title: string;
  meta: string;
  href: string;
  action: string;
};

function buildRevenueForecast(dashboard: DashboardData | null, cashClosed: boolean) {
  if (!dashboard?.finance) {
    return {
      tone: "neutral" as const,
      short: "Загрузка",
      value: "Загрузка",
      details: ["Получаем кассу, записи и отгрузки."],
    };
  }

  if (cashClosed) {
    return {
      tone: "warning" as const,
      short: "нет данных",
      value: "Прогноз: нет данных",
      details: ["Касса закрыта.", "Потенциальная выручка появится после расчётов / отгрузок."],
    };
  }

  const currentRevenue = dashboard.finance.revenueCents;
  const shipmentCount = dashboard.finance.shipmentsCount;
  const averageCheck = dashboard.finance.averageCheckCents;
  const recordsWithoutShipment = dashboard.appointments.withoutShipment;

  if (shipmentCount >= 2 && averageCheck > 0 && recordsWithoutShipment > 0) {
    const low = currentRevenue + averageCheck * recordsWithoutShipment * 0.5;
    const high = currentRevenue + averageCheck * recordsWithoutShipment;
    return {
      tone: "success" as const,
      short: `${formatMoneyCents(low)} – ${formatMoneyCents(high)}`,
      value: `${formatMoneyCents(low)} – ${formatMoneyCents(high)}`,
      details: [
        `Основа: ${formatCount(shipmentCount)} проведённых отгрузок и текущий средний чек.`,
        `Диапазон предполагает реализацию 50–100% из ${formatCount(recordsWithoutShipment)} записей без отгрузки.`,
      ],
    };
  }

  if (shipmentCount >= 2) {
    return {
      tone: "info" as const,
      short: `около ${formatMoneyCents(currentRevenue)}`,
      value: `Около ${formatMoneyCents(currentRevenue)}`,
      details: ["Данных по чекам достаточно.", "Записей без найденной отгрузки сейчас нет."],
    };
  }

  return {
    tone: "warning" as const,
    short: "низкая точность",
    value: "Прогноз: низкая точность",
    details: [
      `${formatCount(dashboard.appointments.totalToday)} записей сегодня, у ${formatCount(recordsWithoutShipment)} нет найденной отгрузки.`,
      "Потенциальная выручка появится после расчётов / отгрузок.",
    ],
  };
}

function MobileReportMetric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: MobileProblemTone;
}) {
  return (
    <div className={`eco-mobile-metric is-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function problemPriorityLabel(tone: MobileProblemTone) {
  if (tone === "danger") return "Срочно";
  if (tone === "warning") return "Сегодня";
  if (tone === "info") return "Скоро";
  if (tone === "success") return "Готово";
  return "К сведению";
}

function MobileWorkRow({ slot }: { slot: ScheduleTimelineItem }) {
  if (slot.kind === "window") {
    return (
      <Link href={recordCreateHref()} className="eco-mobile-work-row is-window">
        <span className="eco-mobile-work-time">{formatClockMinutes(slot.start)}</span>
        <span className="eco-mobile-work-copy">
          <b>Свободное окно</b>
          <small>{slot.label} · можно записать клиента</small>
        </span>
        <Badge tone="success">Окно</Badge>
        <ChevronRight aria-hidden className="eco-icon eco-mobile-work-arrow" />
      </Link>
    );
  }

  return (
    <Link href={recordHref(slot.item)} className="eco-mobile-work-row">
      <span className="eco-mobile-work-time">{slot.item.time || "—"}</span>
      <span className="eco-mobile-work-copy">
        <b>{slot.item.client}</b>
        <small>{[slot.item.vehicle || "авто не указано", slot.item.service].filter(Boolean).join(" · ")}</small>
      </span>
      <Badge tone={appointmentTone(slot.item.status)}>{slot.item.status || "Запланирована"}</Badge>
      <ChevronRight aria-hidden className="eco-icon eco-mobile-work-arrow" />
    </Link>
  );
}

function payrollDateLabel(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}

function shipmentWord(value: number) {
  const mod100 = Math.abs(value) % 100;
  const mod10 = mod100 % 10;
  if (mod100 > 10 && mod100 < 20) return "отгрузок";
  if (mod10 === 1) return "отгрузка";
  if (mod10 > 1 && mod10 < 5) return "отгрузки";
  return "отгрузок";
}

function useAnimatedCents(value: number) {
  const [displayValue, setDisplayValue] = useState(0);
  const previousValueRef = useRef(0);

  useEffect(() => {
    const from = previousValueRef.current;
    previousValueRef.current = value;
    if (from === value) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const reducedMotionFrame = window.requestAnimationFrame(() => setDisplayValue(value));
      return () => window.cancelAnimationFrame(reducedMotionFrame);
    }

    let frame = 0;
    const startedAt = performance.now();
    const duration = 520;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplayValue(Math.round(from + (value - from) * eased));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return displayValue;
}

function AdminPayrollOverview({
  data,
  loading,
  error,
  onRefresh,
}: {
  data: EmployeePayrollData | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const todayCents = useAnimatedCents(data?.today.earnedCents ?? 0);
  const weekCents = useAnimatedCents(data?.summary.earnedCents ?? 0);
  const monthCents = useAnimatedCents(data?.month.earnedCents ?? 0);
  const selectedItem = useMemo(
    () => data?.items.find((item) => item.id === selectedItemId) ?? null,
    [data?.items, selectedItemId]
  );
  const ratio = data?.summary.earnedCents
    ? Math.min(1, Math.max(0, data.today.earnedCents / data.summary.earnedCents))
    : 0;
  const progressStyle = { "--admin-payroll-progress": ratio } as CSSProperties;

  return (
    <section className="eco-admin-payroll" aria-busy={loading}>
      <header className="eco-admin-payroll__head">
        <div className="eco-admin-payroll__title">
          <span className="eco-admin-payroll__icon" aria-hidden><Banknote size={19} /></span>
          <div>
            <span>Моя зарплата</span>
            <h2>Сегодня, неделя и месяц</h2>
          </div>
        </div>
        {data && (
          <span className={`eco-admin-payroll__status ${data.status === "CONFIRMED" ? "is-confirmed" : ""}`}>
            {data.status === "CONFIRMED" ? "Подтверждено" : "Предварительно"}
          </span>
        )}
      </header>

      {error && !data ? (
        <div className="eco-admin-payroll__state is-error" role="alert">
          <strong>Не удалось загрузить начисления</strong>
          <span>{error}</span>
          <button type="button" onClick={onRefresh}>Повторить</button>
        </div>
      ) : !data ? (
        <div className="eco-admin-payroll__skeleton" aria-label="Загружаем начисления">
          <span /><span /><span />
        </div>
      ) : (
        <>
          {error && <p className="eco-admin-payroll__inline-error">Не удалось обновить расчёт. Показаны последние загруженные данные.</p>}
          <div className="eco-admin-payroll__metrics">
            <div className="is-today">
              <span>За сегодня</span>
              <strong aria-label={formatMoneyCents(data.today.earnedCents)}>{formatMoneyCents(todayCents)}</strong>
              <small>{formatCount(data.today.shipmentCount)} {shipmentWord(data.today.shipmentCount)} с начислением</small>
            </div>
            <div>
              <span>С начала недели</span>
              <strong aria-label={formatMoneyCents(data.summary.earnedCents)}>{formatMoneyCents(weekCents)}</strong>
              <small>{payrollDateLabel(data.period.from)} — {payrollDateLabel(data.period.to)}</small>
            </div>
            <div>
              <span>С начала месяца</span>
              <strong aria-label={formatMoneyCents(data.month.earnedCents)}>{formatMoneyCents(monthCents)}</strong>
              <small>Начислено за текущий месяц</small>
            </div>
          </div>

          <div className="eco-admin-payroll__footer">
            <div className="eco-admin-payroll__scale" style={progressStyle}>
              <div className="eco-admin-payroll__scale-copy">
                <span>Сегодня в сумме недели</span>
                <strong>{data.summary.earnedCents > 0 ? `${Math.round(ratio * 100)}%` : "Нет начислений"}</strong>
              </div>
              <div className="eco-admin-payroll__track" aria-hidden>
                <span />
              </div>
            </div>

            <button
              type="button"
              className="eco-admin-payroll__toggle"
              aria-expanded={detailsOpen}
              aria-controls="admin-payroll-details"
              onClick={() => setDetailsOpen((current) => !current)}
            >
              <span>
                <b>Начисления по заказам</b>
                <small>{formatCount(data.summary.shipmentCount)} {shipmentWord(data.summary.shipmentCount)} за неделю</small>
              </span>
              <span className="eco-admin-payroll__toggle-action">
                {detailsOpen ? "Скрыть" : "Показать"}
                <ChevronDown aria-hidden size={17} />
              </span>
            </button>
          </div>

          <div id="admin-payroll-details" className={`eco-admin-payroll__details ${detailsOpen ? "is-open" : ""}`}>
            <div>
              {data.items.length ? (
                <div className="eco-admin-payroll__list">
                  {data.items.map((item) => {
                    const isSelected = selectedItemId === item.id;
                    return (
                      <div key={item.id} className={`eco-admin-payroll__entry ${isSelected ? "is-open" : ""}`}>
                        <button
                          type="button"
                          className="eco-admin-payroll__row"
                          aria-expanded={isSelected}
                          onClick={() => setSelectedItemId((current) => current === item.id ? null : item.id)}
                        >
                          <time>{item.date === data.period.to ? formatTime(item.moment) : payrollDateLabel(item.date)}</time>
                          <span>
                            <b>{item.shipmentNumber}</b>
                            <small>{item.clientName || "Клиент не указан"}</small>
                          </span>
                          <strong>{formatMoneyCents(item.earnedCents)}</strong>
                          <ChevronDown aria-hidden size={17} />
                        </button>
                        {isSelected && selectedItem && (
                          <div className="eco-admin-payroll__breakdown">
                            {selectedItem.components.length ? selectedItem.components.map((component, index) => (
                              <div key={`${component.label}-${index}`}>
                                <span>
                                  <b>{component.label}</b>
                                  <small>{component.ruleLabel} · {component.basisLabel}</small>
                                </span>
                                <strong>{formatMoneyCents(component.amountCents)}</strong>
                              </div>
                            )) : (
                              <p>Начисление рассчитано итоговой суммой без разбивки на позиции.</p>
                            )}
                            <footer>
                              <span>Итого за заказ <b>{formatMoneyCents(selectedItem.earnedCents)}</b></span>
                              <Link href={`/shipment/${selectedItem.id}`}>Открыть отгрузку <ChevronRight aria-hidden size={16} /></Link>
                            </footer>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="eco-admin-payroll__state">
                  <strong>За неделю пока нет начислений по отгрузкам</strong>
                  <span>Строки появятся после проведённых отгрузок с настроенными правилами расчёта.</span>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function AdminJournalSection({ dashboard, scheduleItems }: { dashboard: DashboardData; scheduleItems: ScheduleTimelineItem[] }) {
  const [nowMinutes, setNowMinutes] = useState<number | null>(null);
  const visibleItems = scheduleItems.filter((slot) => slot.start < 24 * 60);
  const earliestStart = visibleItems.length ? Math.min(...visibleItems.map((slot) => slot.start)) : 9 * 60;
  const latestEnd = visibleItems.length ? Math.max(...visibleItems.map((slot) => slot.end)) : 20 * 60;
  const dayStart = Math.max(0, Math.min(9 * 60, Math.floor(earliestStart / 60) * 60));
  const dayEnd = Math.min(24 * 60, Math.max(20 * 60, Math.ceil(latestEnd / 60) * 60));
  const totalMinutes = Math.max(60, dayEnd - dayStart);
  const markers = Array.from({ length: Math.floor(totalMinutes / 30) + 1 }, (_, index) => dayStart + index * 30);
  const positionedItems = positionScheduleItems(visibleItems);
  const freeCount = visibleItems.filter((slot) => slot.kind === "window").length;
  const busyCount = visibleItems.filter((slot) => slot.kind === "record").length;
  const timelineStyle = { "--journal-total-minutes": totalMinutes } as CSSProperties;

  useEffect(() => {
    const updateNow = () => setNowMinutes(currentServiceClockMinutes());
    const initialTimer = window.setTimeout(updateNow, 0);
    const interval = window.setInterval(updateNow, 60_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, []);

  return (
    <Card
      title="Журнал сегодня"
      href="/records"
      action="Весь журнал"
      badge={<Badge tone={dashboard.appointments.withoutShipment ? "warning" : "neutral"}>{formatCount(dashboard.appointments.totalToday)} записей</Badge>}
      className="eco-admin-day-section is-journal"
    >
      <div className="eco-admin-journal-statusbar">
        <div className="eco-admin-journal-legend" aria-label="Занятость журнала">
          <span className="is-busy"><i aria-hidden />Занято <b>{formatCount(busyCount)}</b></span>
          <span className="is-free"><i aria-hidden />Свободно <b>{formatCount(freeCount)}</b></span>
          {dashboard.appointments.withoutShipment > 0 && (
            <span className="is-warning">Без отгрузки <b>{formatCount(dashboard.appointments.withoutShipment)}</b></span>
          )}
        </div>
        <strong>{formatClockMinutes(dayStart)}–{formatTimelineBoundary(dayEnd)}</strong>
      </div>
      {visibleItems.length ? (
        <div className="eco-admin-journal-timeline" style={timelineStyle}>
          <div className="eco-admin-journal-scale" aria-hidden>
            {markers.map((minute) => (
              <span
                key={`scale-${minute}`}
                className={minute % 60 === 0 ? "is-hour" : "is-half"}
                style={{ "--journal-offset": minute - dayStart } as CSSProperties}
              >
                {minute % 60 === 0 ? formatClockMinutes(minute) : "30"}
              </span>
            ))}
          </div>
          <div className="eco-admin-journal-canvas">
            {markers.map((minute) => (
              <span
                key={`line-${minute}`}
                className={`eco-admin-journal-line ${minute % 60 === 0 ? "is-hour" : "is-half"}`}
                style={{ "--journal-offset": minute - dayStart } as CSSProperties}
                aria-hidden
              />
            ))}
            {nowMinutes !== null && nowMinutes >= dayStart && nowMinutes <= dayEnd && (
              <span
                className="eco-admin-journal-now"
                style={{ "--journal-offset": nowMinutes - dayStart } as CSSProperties}
                aria-label={`Сейчас ${formatClockMinutes(nowMinutes)}`}
              >
                <b>Сейчас</b>
              </span>
            )}
            {positionedItems.map(({ slot, lane, laneCount }) => {
              const slotStyle = {
                "--journal-offset": Math.max(0, slot.start - dayStart),
                "--journal-duration": Math.min(slot.end, dayEnd) - Math.max(slot.start, dayStart),
                "--journal-left": `${(lane / laneCount) * 100}%`,
                "--journal-width": `${100 / laneCount}%`,
              } as CSSProperties;
              if (slot.kind === "window") {
                return (
                  <Link
                    key={slot.key}
                    href={recordCreateHref()}
                    className="eco-admin-journal-slot is-free"
                    style={slotStyle}
                    aria-label={`${slot.label}, свободно, записать клиента`}
                  >
                    <span className="eco-admin-journal-slot__time">{slot.label}</span>
                    <strong><Plus aria-hidden size={15} /> Свободно</strong>
                    <small>Записать клиента</small>
                  </Link>
                );
              }
              const isCompact = slot.end - slot.start < 75;
              return (
                <Link
                  key={slot.key}
                  href={recordHref(slot.item)}
                  className={`eco-admin-journal-slot is-busy ${isCompact ? "is-compact" : ""}`}
                  style={slotStyle}
                  aria-label={`${slot.item.time}–${slot.item.endTime || formatClockMinutes(slot.end)}, занято, ${slot.item.client}`}
                >
                  <span className="eco-admin-journal-slot__time">
                    {slot.item.time || formatClockMinutes(slot.start)}–{slot.item.endTime || formatClockMinutes(slot.end)}
                    <em>{slot.item.status || "Запланирована"}</em>
                  </span>
                  <strong>{slot.item.client}</strong>
                  <small>{[slot.item.service, slot.item.vehicle].filter(Boolean).join(" · ")}</small>
                </Link>
              );
            })}
          </div>
        </div>
      ) : (
        <EmptyState title="Записей на сегодня нет" hint="Создайте запись или добавьте свободное окно в журнале." />
      )}
    </Card>
  );
}

function AdminCasesSection({ dashboard, now }: { dashboard: DashboardData; now: number | null }) {
  const crm = dashboard.crm;
  return (
    <Card
      title="Дела клиентов"
      href={crm ? "/crm?filter=today" : undefined}
      action="Все дела"
      badge={crm
        ? <Badge tone={crm.overdue ? "warning" : "neutral"}>{formatCount(crm.overdue)} просрочено</Badge>
        : <Badge tone="neutral">Только администратор</Badge>}
      className="eco-admin-day-section is-cases"
    >
      {crm ? (
        <>
          <StatStrip
            items={[
              { label: "Сегодня", value: crm.today },
              { label: "Просрочено", value: crm.overdue, tone: crm.overdue ? "warning" : "muted" },
              { label: "Перезвонить", value: crm.callback },
            ]}
            dense
          />
          {crm.rows.length ? (
            <div className="eco-admin-day-list">
              {crm.rows.slice(0, 6).map((item) => (
                <Link key={item.id} href={crmHref(item)} className="eco-admin-day-row is-case">
                  <span className="eco-admin-day-avatar" aria-hidden>{initials(item.responsible)}</span>
                  <span className="eco-admin-day-row__copy">
                    <b>{item.client}</b>
                    <small>{item.title}</small>
                  </span>
                  <span className={`eco-admin-day-deadline ${item.deadline && new Date(item.deadline).getTime() < (now ?? 0) ? "is-over" : ""}`}>
                    {formatShortDeadline(item.deadline)}
                  </span>
                  <ChevronRight aria-hidden size={17} />
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState title="Актуальных дел нет" hint="Сегодняшние и просроченные дела клиентов появятся здесь." />
          )}
        </>
      ) : (
        <EmptyState title="Дела скрыты для этой роли" hint="Клиентские задачи доступны администратору филиала." />
      )}
    </Card>
  );
}

function AdminShipmentsSection({ dashboard }: { dashboard: DashboardData }) {
  return (
    <Card
      title="Отгрузки сегодня"
      href="/shipment"
      action="Все отгрузки"
      badge={<Badge tone={dashboard.shipments.unpaid || dashboard.shipments.drafts ? "warning" : "neutral"}>{formatCount(dashboard.shipments.today)} всего</Badge>}
      className="eco-admin-day-section is-shipments"
    >
      <StatStrip
        items={[
          { label: "Всего", value: dashboard.shipments.today },
          { label: "Черновики", value: dashboard.shipments.drafts, tone: dashboard.shipments.drafts ? "warning" : "muted" },
          { label: "Не оплачены", value: dashboard.shipments.unpaid, tone: dashboard.shipments.unpaid ? "warning" : "muted" },
        ]}
        dense
      />
      {dashboard.shipments.rows.length ? (
        <div className="eco-admin-day-list">
          {dashboard.shipments.rows.slice(0, 7).map((item) => (
            <Link key={item.id} href={`/shipment/${item.id}`} className={`eco-admin-day-row is-shipment ${item.sumCents === null ? "is-no-amount" : ""}`}>
              <time>{formatTime(item.moment)}</time>
              <span className="eco-admin-day-row__copy">
                <b>{item.name}</b>
                <small>{item.client || "Клиент не указан"}</small>
              </span>
              <Badge tone={item.applicable ? "success" : "warning"}>{item.applicable ? "Проведена" : "Черновик"}</Badge>
              {item.sumCents !== null && <strong className="eco-admin-day-amount">{formatMoneyCents(item.sumCents)}</strong>}
              <ChevronRight aria-hidden size={17} />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="Отгрузок сегодня нет" hint="Новая отгрузка появится здесь сразу после создания." />
      )}
    </Card>
  );
}

function AdminDayCenter({
  userName,
  dashboard,
  payroll,
  payrollError,
  dashboardError,
  loadState,
  loading,
  refreshing,
  lastUpdatedAt,
  scheduleItems,
  sectionsLocked,
  canOpenCashShift,
  needCashShiftNotice,
  onRefresh,
}: {
  userName: string;
  dashboard: DashboardData | null;
  payroll: EmployeePayrollData | null;
  payrollError: string | null;
  dashboardError: string | null;
  loadState: DashboardLoadState;
  loading: boolean;
  refreshing: boolean;
  lastUpdatedAt: number | null;
  scheduleItems: ScheduleTimelineItem[];
  sectionsLocked: boolean;
  canOpenCashShift: boolean;
  needCashShiftNotice: boolean;
  onRefresh: () => void;
}) {
  return (
    <main className="eco-ops-dashboard eco-admin-day-center" aria-busy={loading || refreshing}>
      <div className="eco-visually-hidden" role="status" aria-live="polite">
        {loading ? "Загружаем операционный центр." : refreshing ? "Обновляем операционный центр." : "Операционный центр обновлён."}
      </div>
      <header className="eco-admin-day-head">
        <div>
          <span className="eco-ops-eyebrow">Рабочий день · {userName}</span>
          <h1>Операционный центр дня</h1>
          <p>{todayShortPhrase()}</p>
        </div>
        <button type="button" className="eco-admin-day-refresh" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw aria-hidden size={16} className={refreshing ? "eco-spin" : ""} />
          <span>{lastUpdatedAt ? `Обновлено ${formatTime(new Date(lastUpdatedAt).toISOString())}` : "Обновить"}</span>
        </button>
      </header>

      <AdminPayrollOverview data={payroll} loading={loading || refreshing} error={payrollError} onRefresh={onRefresh} />

      {loadState === "stale" && dashboard && (
        <div className="eco-admin-day-notice" role="alert">
          Не удалось обновить рабочие данные. Ниже показана последняя загруженная версия.
        </div>
      )}

      {sectionsLocked && (
        <section id="cash-shift-control" className="eco-admin-day-shift">
          <div>
            <strong>Сначала откройте кассовую смену</strong>
            <span>{needCashShiftNotice ? "Вы вернулись из раздела, доступного только при открытой кассе. " : ""}После открытия появятся журнал, дела клиентов и отгрузки.</span>
          </div>
          {canOpenCashShift ? (
            <Link href="/cash#open" className="eco-ops-btn eco-ops-btn--primary">Открыть кассовую смену</Link>
          ) : (
            <span className="eco-admin-day-shift__restricted">Кассовую смену открывает администратор</span>
          )}
        </section>
      )}

      {!dashboard ? (
        <section className="eco-admin-day-section eco-ops-card">
          {dashboardError ? (
            <ErrorState title="Рабочие данные не загрузились" hint={dashboardError} onRetry={onRefresh} />
          ) : (
            <LoadingState rows={5} />
          )}
        </section>
      ) : !sectionsLocked ? (
        <section className="eco-admin-day-sections" aria-label="Рабочие разделы на сегодня">
          <AdminJournalSection dashboard={dashboard} scheduleItems={scheduleItems} />
          <AdminCasesSection dashboard={dashboard} now={lastUpdatedAt} />
          <AdminShipmentsSection dashboard={dashboard} />
        </section>
      ) : null}
    </main>
  );
}

export default function HomeDashboard({
  role,
  userName,
  dashboardVariant,
  needCashShiftNotice = false,
}: {
  role: UserRole;
  userName: string;
  dashboardVariant: DashboardVariant;
  needCashShiftNotice?: boolean;
}) {
  const [loadState, setLoadState] = useState<DashboardLoadState>("loading");
  const [currentCashShift, setCurrentCashShift] = useState<CurrentCashShift>(null);
  const [cashAvailable, setCashAvailable] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [employeePayroll, setEmployeePayroll] = useState<EmployeePayrollData | null>(null);
  const [adminPayroll, setAdminPayroll] = useState<EmployeePayrollData | null>(null);
  const [adminPayrollError, setAdminPayrollError] = useState<string | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const dashboardRef = useRef<DashboardData | null>(null);
  const employeePayrollRef = useRef<EmployeePayrollData | null>(null);
  const employeePayrollQueryRef = useRef<EmployeePayrollQuery>({ period: "today" });
  const mountedRef = useRef(true);

  const isDayCenterRole = usesOperationalDayCenter(role);
  const isEmployeeDashboard = dashboardVariant === "EMPLOYEE" && !isDayCenterRole;
  const needsOpenCashShift = isDayCenterRole;
  const hasOpenCashShift = currentCashShift?.status === "open" || dashboard?.cash.status === "open";
  const cashShiftStatusKnown = cashAvailable || Boolean(dashboard);
  const sectionsLocked = needsOpenCashShift && cashShiftStatusKnown && !hasOpenCashShift;
  const cashShiftStatusUnavailable = needsOpenCashShift && !cashShiftStatusKnown;
  const loading = loadState === "loading";
  const refreshing = loadState === "refreshing";

  const loadSummary = useCallback(async (force = false, employeeQuery = employeePayrollQueryRef.current) => {
    setLoadState((isEmployeeDashboard ? employeePayrollRef.current : dashboardRef.current) ? "refreshing" : "loading");
    setDashboardError(null);
    try {
      if (isEmployeeDashboard) {
        const params = new URLSearchParams({ period: employeeQuery.period });
        if (employeeQuery.dateFrom) params.set("dateFrom", employeeQuery.dateFrom);
        if (employeeQuery.dateTo) params.set("dateTo", employeeQuery.dateTo);
        const payrollResponse = await fetch(`/api/dashboard/my-payroll?${params.toString()}`, { cache: "no-store" });
        const payroll = await readDashboardResponse<EmployeePayrollData>(payrollResponse, "Не удалось загрузить расчёт.");
        if (!mountedRef.current) return;
        employeePayrollRef.current = payroll;
        setEmployeePayroll(payroll);
        setDashboard(null);
        setCurrentCashShift(null);
        setCashAvailable(false);
        setPartialErrors([]);
        setLastUpdatedAt(Date.now());
        setLoadState("ready");
        return;
      }
      const payrollPromise: Promise<{ data: EmployeePayrollData | null; error: string | null }> = isDayCenterRole
        ? fetch("/api/dashboard/my-payroll?period=week", { cache: "no-store" })
            .then((response) => readDashboardResponse<EmployeePayrollData>(response, "Не удалось загрузить начисления."))
            .then((data) => ({ data, error: null }))
            .catch((error: unknown) => ({
              data: null,
              error: error instanceof Error ? error.message : "Не удалось загрузить начисления.",
            }))
        : Promise.resolve({ data: null, error: null });
      const [bundle, payrollResult] = await Promise.all([
        loadDashboardClientBundle<DashboardData, { shift?: CurrentCashShift }>({ force }),
        payrollPromise,
      ]);
      if (!mountedRef.current) return;
      dashboardRef.current = bundle.dashboard;
      setDashboard(bundle.dashboard);
      if (isDayCenterRole) {
        if (payrollResult.data) {
          setAdminPayroll(payrollResult.data);
        }
        setAdminPayrollError(payrollResult.error);
      }
      setCurrentCashShift(bundle.cash?.shift ?? null);
      setCashAvailable(bundle.cashAvailable);
      setPartialErrors(bundle.partialErrors);
      setLastUpdatedAt(bundle.loadedAt);
      setLoadState(bundle.partialErrors.length ? "partial" : "ready");
    } catch (error) {
      if (!mountedRef.current) return;
      const message = error instanceof Error ? error.message : "Не удалось загрузить операционную сводку.";
      setDashboardError(message);
      setLoadState(dashboardRef.current ? "stale" : "error");
    }
  }, [isDayCenterRole, isEmployeeDashboard]);

  const changeEmployeePayrollPeriod = useCallback((period: EmployeePayrollPeriod, range?: { dateFrom: string; dateTo: string }) => {
    const next: EmployeePayrollQuery = range ? { period, ...range } : { period };
    employeePayrollQueryRef.current = next;
    void loadSummary(true, next);
  }, [loadSummary]);

  useEffect(() => {
    mountedRef.current = true;
    const initialTimer = window.setTimeout(() => void loadSummary(), 0);
    const handleShiftChanged = () => void loadSummary(true);
    const handleFocus = () => void loadSummary(true);
    const refreshTimer = window.setInterval(() => void loadSummary(true), 60_000);
    window.addEventListener(CASH_SHIFT_EVENT, handleShiftChanged);
    window.addEventListener("focus", handleFocus);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(initialTimer);
      window.clearInterval(refreshTimer);
      window.removeEventListener(CASH_SHIFT_EVENT, handleShiftChanged);
      window.removeEventListener("focus", handleFocus);
    };
  }, [loadSummary]);

  const cashClosed = dashboard?.cash.status === "closed";
  const cashOpenLong = (dashboard?.cash.openedHours ?? 0) >= 10;
  const notifications = dashboard?.notifications ?? [];
  const feedItems = notifications.slice(0, 5);
  const messages = dashboard?.messages;
  const forecast = buildRevenueForecast(dashboard, cashClosed);
  const scheduleItems = useMemo(
    () => buildScheduleTimeline(dashboard?.appointments.rows ?? [], dashboard?.appointments.freeWindows ?? []),
    [dashboard?.appointments.rows, dashboard?.appointments.freeWindows]
  );
  const cashShiftStatusLine = loading && !dashboard
    ? "Получаем актуальное состояние дня"
    : cashShiftStatusUnavailable
      ? "Статус кассовой смены временно недоступен"
      : sectionsLocked
    ? "Кассовая смена закрыта"
    : dashboard?.cash.status === "open"
      ? `Касса открыта${formatTime(dashboard.cash.openedAt) !== "—" ? ` с ${formatTime(dashboard.cash.openedAt)}` : ""}`
      : "Касса закрыта";
  const mobilePrimaryAction = !dashboard
    ? null
    : sectionsLocked
    ? { href: role === "admin" ? "/cash#open" : "/", label: "Кассовая смена закрыта" }
    : cashClosed
      ? { href: "/cash#open", label: "Открыть кассу" }
      : { href: "/shipment/new", label: "Новая отгрузка" };
  const attentionItems = useMemo<MobileProblem[]>(() => {
    if (!dashboard) return [];
    const urgencyWeight: Record<NotificationUrgency, number> = { urgent: 0, today: 1, soon: 2, info: 3 };
    const items = dashboard.notifications.map((item) => ({
      id: item.id,
      tone: item.urgency === "urgent" ? "danger" as const : item.urgency === "today" ? "warning" as const : item.urgency === "soon" ? "info" as const : "neutral" as const,
      severity: urgencyWeight[item.urgency],
      deadlineWeight: item.deadline ? new Date(item.deadline).getTime() || Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER,
      impact: item.entityLabel === "Касса" ? 0 : item.entityLabel === "CRM-дело" ? 1 : item.entityLabel === "Запись" ? 2 : 3,
      title: item.title,
      meta: item.description,
      href: item.entityHref,
      action: item.actionLabel,
    }));
    if (messages?.needsReply) {
      items.push({
        id: "messages-needs-reply",
        tone: "warning",
        severity: 1,
        deadlineWeight: messages.oldest ? -messages.oldest.hours : Number.MAX_SAFE_INTEGER,
        impact: 1,
        title: `${formatCount(messages.needsReply)} сообщений требуют ответа`,
        meta: messages.oldest ? `Самое старое: ${messages.oldest.client} · ${formatHours(messages.oldest.hours)}` : "Есть непрочитанные диалоги.",
        href: "/messages",
        action: "Ответить",
      });
    }
    return items.sort((a, b) => a.severity - b.severity || a.deadlineWeight - b.deadlineWeight || a.impact - b.impact);
  }, [dashboard, messages]);
  const visibleAttentionItems = attentionItems.slice(0, role === "owner" ? 4 : 5);
  const hiddenAttentionCount = Math.max(0, attentionItems.length - visibleAttentionItems.length);
  const daySignals = dashboard ? [
    {
      id: "cash",
      label: "Кассовая смена",
      value: dashboard.cash.status === "open" ? "Открыта" : "Закрыта",
      detail: cashShiftStatusLine,
      href: "/cash#cash-state",
      tone: cashClosed ? ("danger" as const) : cashOpenLong ? ("warning" as const) : ("success" as const),
      icon: Gauge,
    },
    {
      id: "records",
      label: role === "master" ? "Работы сегодня" : "Журнал",
      value: formatCount(dashboard.appointments.totalToday),
      detail: dashboard.appointments.next
        ? `${dashboard.appointments.next.time} · ${dashboard.appointments.next.client}`
        : `${formatCount(dashboard.appointments.withoutShipment)} без отгрузки`,
      href: "/records",
      tone: dashboard.appointments.withoutShipment || dashboard.appointments.requiresManualLink ? ("warning" as const) : ("neutral" as const),
      icon: CalendarDays,
    },
    role === "master"
      ? {
          id: "diagnostics",
          label: "Диагностики",
          value: formatCount(dashboard.diagnostics.active),
          detail: `${formatCount(dashboard.diagnostics.withoutPhoto)} без полного отчёта`,
          href: "/shipment?filter=diagnostics",
          tone: dashboard.diagnostics.withoutPhoto ? ("warning" as const) : ("neutral" as const),
          icon: Wrench,
        }
      : {
          id: "messages",
          label: "Сообщения",
          value: formatCount(messages?.needsReply ?? 0),
          detail: messages?.needsReply
            ? messages.oldest
              ? `${messages.oldest.client} · ${formatHours(messages.oldest.hours)}`
              : `${formatCount(messages.unread)} непрочитанных`
            : "ответы не ждут",
          href: "/messages",
          tone: messages?.needsReply ? ("warning" as const) : ("neutral" as const),
          icon: MessageCircle,
        },
    {
      id: "shipments",
      label: "Отгрузки",
      value: formatCount(dashboard.shipments.today),
      detail: role === "master"
        ? `${formatCount(dashboard.shipments.withoutDiagnostic)} без диагностики`
        : `${formatCount(dashboard.shipments.drafts)} черновиков · ${formatCount(dashboard.shipments.unpaid)} без оплаты`,
      href: "/shipment",
      tone: dashboard.shipments.drafts || dashboard.shipments.unpaid ? ("warning" as const) : ("neutral" as const),
      icon: Truck,
    },
  ] : [];
  const primarySignalId = sectionsLocked
    ? "cash"
    : daySignals.find((signal) => signal.tone === "danger")?.id ?? "records";

  if (isEmployeeDashboard) {
    return (
      <main className="eco-employee-dashboard" aria-busy={loading || refreshing}>
        <div className="eco-visually-hidden" role="status" aria-live="polite">
          {loading ? "Загружаем личный расчёт." : refreshing ? "Обновляем личный расчёт." : "Личный расчёт обновлён."}
        </div>
        <MyPayrollCard
          data={employeePayroll}
          loading={loading || refreshing}
          error={dashboardError}
          onRefresh={() => void loadSummary(true)}
          onPeriodChange={changeEmployeePayrollPeriod}
        />
      </main>
    );
  }

  if (isDayCenterRole) {
    return (
      <AdminDayCenter
        userName={userName}
        dashboard={dashboard}
        payroll={adminPayroll}
        payrollError={adminPayrollError}
        dashboardError={dashboardError}
        loadState={loadState}
        loading={loading}
        refreshing={refreshing}
        lastUpdatedAt={lastUpdatedAt}
        scheduleItems={scheduleItems}
        sectionsLocked={sectionsLocked}
        canOpenCashShift={role === "admin"}
        needCashShiftNotice={needCashShiftNotice}
        onRefresh={() => void loadSummary(true)}
      />
    );
  }

  return (
    <main className={`eco-ops-dashboard is-role-${role}`} aria-busy={loading || refreshing}>
      <div className="eco-visually-hidden" role="status" aria-live="polite">
        {loading ? "Загружаем операционную сводку." : refreshing ? "Обновляем операционную сводку." : loadState === "stale" ? "Показаны ранее загруженные данные." : "Операционная сводка обновлена."}
      </div>
      <section className="eco-mobile-control" aria-label={`Мобильный контроль дня для ${userName}`}>
        <header className="eco-mobile-top">
          <div>
            <h1>{role === "owner" ? "Контроль владельца" : "Рабочий день"}</h1>
            <span>{todayShortPhrase()}</span>
            <small>{cashShiftStatusLine}</small>
          </div>
          {mobilePrimaryAction ? (
            <Link href={mobilePrimaryAction.href} className="eco-mobile-primary">
              {mobilePrimaryAction.label}
            </Link>
          ) : (
            <span className="eco-mobile-primary is-disabled" aria-hidden>Загрузка…</span>
          )}
        </header>

        {loadState === "stale" && dashboard && (
          <div className="eco-mobile-inline-alert is-warning" role="alert">
            <span>Не удалось обновить данные. Показана сводка на {lastUpdatedAt ? formatTime(new Date(lastUpdatedAt).toISOString()) : "предыдущее обновление"}.</span>
            <button type="button" onClick={() => void loadSummary(true)}>Повторить</button>
          </div>
        )}
        {loadState === "partial" && partialErrors.length > 0 && (
          <div className="eco-mobile-inline-alert is-warning" role="status">
            Часть статусов недоступна: {partialErrors.join(" ")}
          </div>
        )}

        {!dashboard ? (
          <section className="eco-mobile-card eco-mobile-report">
            <div className="eco-mobile-card-head"><h2>Сводка дня</h2><span>нет данных</span></div>
            {dashboardError ? (
              <ErrorState title="Сводка не загрузилась" hint={dashboardError} onRetry={() => void loadSummary(true)} />
            ) : (
              <LoadingState rows={5} />
            )}
          </section>
        ) : sectionsLocked ? (
          <section className="eco-mobile-card eco-mobile-gate">
            <div className="eco-mobile-card-head">
              <h2>Сначала откройте кассовую смену</h2>
              <span>1 действие</span>
            </div>
            <p>{needCashShiftNotice ? "Вы вернулись из раздела, доступного только при открытой кассе. " : ""}После открытия появятся журнал, работы и операционные показатели.</p>
          </section>
        ) : (
          <>
            <section className="eco-mobile-card eco-mobile-attention">
              <div className="eco-mobile-card-head">
                <h2>Требует внимания</h2>
                <span>{attentionItems.length ? `${visibleAttentionItems.length} из ${attentionItems.length}` : "чисто"}</span>
              </div>
              {attentionItems.length ? (
                <div className="eco-mobile-problems">
                  {visibleAttentionItems.map((item) => (
                    <Link key={item.id} href={item.href} className={`eco-mobile-problem is-${item.tone}`}>
                      <span className={`eco-mobile-problem-priority is-${item.tone}`}>{problemPriorityLabel(item.tone)}</span>
                      <span className="eco-mobile-problem-copy">
                        <b>{item.title}</b>
                        <small>{item.meta}</small>
                      </span>
                      <span className="eco-mobile-problem-action">
                        <span>{item.action}</span>
                        <ChevronRight aria-hidden className="eco-icon" />
                      </span>
                    </Link>
                  ))}
                  {hiddenAttentionCount > 0 && (
                    <Link href="/notifications" className="eco-mobile-more-link">Ещё {hiddenAttentionCount} задач</Link>
                  )}
                </div>
              ) : (
                <div className="eco-mobile-inline-alert is-success">Сейчас нет задач, которые требуют решения.</div>
              )}
            </section>

            <section className="eco-mobile-card eco-mobile-work">
              <div className="eco-mobile-card-head">
                <h2>{role === "master" ? "Работы сегодня" : "Журнал сегодня"}</h2>
                <Link href="/records">Все записи <ChevronRight aria-hidden className="eco-icon" /></Link>
              </div>
              {scheduleItems.length ? (
                <div className="eco-mobile-work-list">
                  {scheduleItems.slice(0, 3).map((slot) => <MobileWorkRow key={slot.key} slot={slot} />)}
                </div>
              ) : (
                <div className="eco-mobile-inline-alert">Записей пока нет. Свободное время можно добавить в журнале.</div>
              )}
            </section>

            <section className="eco-mobile-card eco-mobile-report">
              <div className="eco-mobile-card-head">
                <h2>{role === "owner" ? "Коротко о деньгах" : "Коротко о работах"}</h2>
                <span>{lastUpdatedAt ? `обновлено ${formatTime(new Date(lastUpdatedAt).toISOString())}` : "актуально"}</span>
              </div>

              {role === "owner" && dashboard.finance && (
                <div className="eco-mobile-revenue">
                  <span>Выручка сейчас</span>
                  <strong>{formatMoneyCents(dashboard.finance.revenueCents)}</strong>
                  <small>{formatCount(dashboard.finance.shipmentsCount)} отгрузок · оплачено {formatMoneyCents(dashboard.finance.paidCents)}</small>
                </div>
              )}

              <div className="eco-mobile-metric-grid is-compact">
                {role === "owner" && dashboard.finance && (
                  <>
                    <MobileReportMetric label="Прибыль" value={formatMoneyCents(dashboard.finance.grossProfitCents)} hint="по проведённым документам" />
                    <MobileReportMetric label="Не оплачено" value={formatMoneyCents(dashboard.finance.unpaidCents)} hint="ожидает оплаты" tone={dashboard.finance.unpaidCents ? "warning" : "neutral"} />
                  </>
                )}
                {role === "master" && (
                  <>
                    <MobileReportMetric label="Работы сегодня" value={formatCount(dashboard.appointments.totalToday)} hint={`${formatCount(dashboard.appointments.withoutShipment)} без отгрузки`} />
                    <MobileReportMetric label="Диагностики" value={formatCount(dashboard.diagnostics.active)} hint={`${formatCount(dashboard.diagnostics.withoutPhoto)} без отчёта`} tone={dashboard.diagnostics.withoutPhoto ? "warning" : "neutral"} />
                    <MobileReportMetric label="Отгрузки" value={formatCount(dashboard.shipments.today)} hint={`${formatCount(dashboard.shipments.withoutDiagnostic)} без диагностики`} tone={dashboard.shipments.withoutDiagnostic ? "warning" : "neutral"} />
                  </>
                )}
              </div>

              {role === "owner" && dashboard.finance && (
                <details className={`eco-mobile-forecast-details is-${forecast.tone}`}>
                  <summary>
                    <span>Оценка до конца дня</span>
                    <strong>{forecast.short}</strong>
                    <ChevronRight aria-hidden className="eco-icon eco-mobile-forecast-toggle" />
                  </summary>
                  <ul>
                    {forecast.details.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </details>
              )}
            </section>
          </>
        )}
      </section>

      <nav className="eco-mobile-bottom-nav" aria-label="Быстрый доступ">
        <Link href="/" className="is-active" aria-current="page">
          <Gauge aria-hidden className="eco-icon" />
          <span>Контроль</span>
        </Link>
        {role === "master" ? (
          <Link href="/shipment?filter=diagnostics">
            <Wrench aria-hidden className="eco-icon" />
            <span>Диагностики</span>
            {!!dashboard?.diagnostics.withoutPhoto && <b>{dashboard.diagnostics.withoutPhoto > 99 ? "99+" : dashboard.diagnostics.withoutPhoto}</b>}
          </Link>
        ) : (
          <Link href="/messages">
            <MessageCircle aria-hidden className="eco-icon" />
            <span>Сообщения</span>
            {!!messages?.needsReply && <b>{messages.needsReply > 99 ? "99+" : messages.needsReply}</b>}
          </Link>
        )}
        <Link href="/records">
          <CalendarDays aria-hidden className="eco-icon" />
          <span>Записи</span>
        </Link>
        <Link href="/shipment">
          <Truck aria-hidden className="eco-icon" />
          <span>Отгрузки</span>
        </Link>
        <Link href="/cabinet">
          <MoreHorizontal aria-hidden className="eco-icon" />
          <span>Ещё</span>
        </Link>
      </nav>

      <div className="eco-ops-desktop">
        <section className={`eco-ops-command ${cashClosed ? "is-blocked" : "is-ready"}`} aria-label={`Операционный центр дня для ${userName}`}>
          <div className="eco-ops-command-top">
            <div className="eco-ops-command-main">
              <span className="eco-ops-command-context">{SERVICE_ORGANIZATION_LABEL} · {todayShortPhrase()}</span>
              <h1>{role === "owner" ? "Контроль бизнеса сегодня" : "Рабочий день"}</h1>
              <p>
                {role === "owner" ? "Деньги, отклонения и решения по филиалу." : "Ближайшие работы, отгрузки и незавершённые диагностики."}
              </p>
              {lastUpdatedAt && (
                <span className="eco-ops-updated">Обновлено в {formatTime(new Date(lastUpdatedAt).toISOString())}{refreshing ? " · обновляем…" : ""}</span>
              )}
            </div>
            <div className="eco-ops-command-actions">
              {sectionsLocked ? (
                <Link href="/cash#open" className="eco-ops-btn eco-ops-btn--primary">
                  <Play aria-hidden className="eco-icon" />
                  Открыть кассовую смену
                </Link>
              ) : null}
              {dashboard && !sectionsLocked && role !== "master" && (
                <Link href="/shipment/new" className="eco-ops-btn eco-ops-btn--primary">
                  <Plus aria-hidden className="eco-icon" />
                  Новая отгрузка
                </Link>
              )}
              {dashboard && !sectionsLocked && role !== "master" && (
                <Link href={recordCreateHref()} className="eco-ops-btn eco-ops-btn--ghost">
                  <CalendarDays aria-hidden className="eco-icon" />
                  Записать
                </Link>
              )}
              {dashboard && !sectionsLocked && role === "master" && (
                <Link href="/shipment?filter=diagnostics" className="eco-ops-btn eco-ops-btn--primary">
                  <Wrench aria-hidden className="eco-icon" />
                  Работы смены
                </Link>
              )}
              <button
                type="button"
                onClick={() => void loadSummary(true)}
                className="eco-ops-btn eco-ops-btn--ghost eco-ops-icon-button"
                disabled={refreshing}
                aria-label="Обновить операционную сводку"
                title="Обновить"
              >
                <RefreshCw aria-hidden className={`eco-icon ${refreshing ? "is-spinning" : ""}`} />
              </button>
            </div>
          </div>
          {dashboard ? (
            <div className="eco-ops-signal-grid" aria-label="Ключевые сигналы дня">
              {daySignals.map((signal) => (
                <CommandSignal key={signal.id} {...signal} primary={signal.id === primarySignalId} />
              ))}
            </div>
          ) : dashboardError ? (
            <ErrorState title="Сводка не загрузилась" hint={dashboardError} onRetry={() => void loadSummary(true)} />
          ) : (
            <LoadingState rows={2} />
          )}
        </section>

      {loadState === "stale" && dashboard && (
        <div className="eco-ops-shift-notice is-warning" role="alert">
          Не удалось обновить сводку. Показаны данные на {lastUpdatedAt ? formatTime(new Date(lastUpdatedAt).toISOString()) : "предыдущее обновление"}.
        </div>
      )}
      {loadState === "partial" && partialErrors.length > 0 && (
        <div className="eco-ops-shift-notice is-warning" role="status">Часть статусов недоступна: {partialErrors.join(" ")}</div>
      )}

      {dashboard && (sectionsLocked ? (
        <section className="eco-ops-locked">
          <h2>Откройте кассовую смену, чтобы начать день.</h2>
          <p>{needCashShiftNotice ? "Вы вернулись из раздела, доступного только при открытой кассе. " : ""}После открытия кассовой смены появятся работы, отгрузки и диагностики.</p>
        </section>
      ) : (
        <>
          <section className={`eco-ops-owner-grid ${role !== "owner" ? "is-single" : ""}`} aria-label={role === "owner" ? "Деньги и внимание владельца" : "Очередь работ мастера"}>
            {role === "owner" && dashboard.finance && <section className="eco-ops-finance-panel">
              <header>
                <div>
                  <h2>Деньги сегодня</h2>
                  <p>
                    {formatCount(dashboard.finance.shipmentsCount)} отгрузок · оплачено {formatMoneyCents(dashboard.finance.paidCents)} · {dashboard.finance.paymentSourceLabel}
                  </p>
                </div>
                <Link href="/finance" className="eco-ops-btn eco-ops-btn--ghost eco-ops-btn--sm">
                  Финансы <ChevronRight aria-hidden className="eco-icon" />
                </Link>
              </header>
              <div className="eco-ops-finance-ledger" aria-label="Короткая финансовая сводка">
                  <div className="is-main">
                    <span>Выручка</span>
                    <strong>{formatMoneyCents(dashboard.finance.revenueCents)}</strong>
                  </div>
                  <div>
                    <span>Прибыль</span>
                    <strong>{formatMoneyCents(dashboard.finance.grossProfitCents)}</strong>
                  </div>
                  <div>
                    <span>Средний чек</span>
                    <strong>{formatMoneyCents(dashboard.finance.averageCheckCents)}</strong>
                  </div>
                  <div>
                    <span>Не оплачено</span>
                    <strong className={dashboard.finance.unpaidCents > 0 ? "is-warning" : ""}>{formatMoneyCents(dashboard.finance.unpaidCents)}</strong>
                  </div>
                  <div>
                    <span>Ожидается в кассе</span>
                    <strong>{formatMoneyCents(dashboard.cash.expectedBalanceCents ?? 0)}</strong>
                  </div>
              </div>
            </section>}

            <section className="eco-ops-attention-panel">
              <header>
                <div>
                  <h2>Требует решения</h2>
                  <p>{role === "owner" ? "Деньги, клиенты, склад и диагностика по приоритету." : "Записи и диагностики по сроку и влиянию."}</p>
                </div>
                <span>{attentionItems.length ? formatCount(attentionItems.length) : "0"}</span>
              </header>
              {attentionItems.length ? (
                <div className="eco-ops-attention-list">
                  {visibleAttentionItems.map((item) => (
                    <Link key={item.id} href={item.href} className={`eco-ops-attention-item is-${item.tone}`}>
                      <span className={`eco-ops-attention-priority is-${item.tone}`}>{problemPriorityLabel(item.tone)}</span>
                      <span className="eco-ops-attention-copy">
                        <b>{item.title}</b>
                        <small>{item.meta}</small>
                      </span>
                      <span className="eco-ops-attention-action">
                        <span>{item.action}</span>
                        <ChevronRight aria-hidden className="eco-icon" />
                      </span>
                    </Link>
                  ))}
                  {hiddenAttentionCount > 0 && (
                    <Link href="/notifications" className="eco-ops-attention-more">Ещё {hiddenAttentionCount} задач</Link>
                  )}
                </div>
              ) : (
                <div className="eco-ops-attention-empty">
                  <strong>Блокеров и срочных задач нет</strong>
                  <span>Можно смотреть журнал и отгрузки без красного шума.</span>
                </div>
              )}
            </section>
          </section>

          <section className="eco-ops-day-grid" aria-label="Рабочий слой дня">
            <Card
              title="Журнал сегодня"
              href="/records"
              action="Журнал"
              badge={
                <Badge tone={dashboard?.appointments.withoutShipment || dashboard?.appointments.requiresManualLink ? "warning" : "neutral"}>
                  {formatCount((dashboard?.appointments.withoutShipment ?? 0) + (dashboard?.appointments.requiresManualLink ?? 0))} к проверке
                </Badge>
              }
              className="eco-ops-card--journal"
            >
              {dashboardError && !dashboard ? (
                <ErrorState title="Журнал не загрузился" hint={dashboardError} />
              ) : loading && !dashboard ? (
                <LoadingState rows={5} />
              ) : (
                <>
                  <StatStrip
                    items={[
                      { label: "Всего", value: dashboard?.appointments.totalToday ?? 0 },
                      { label: "Подтверждены", value: dashboard?.appointments.confirmedToday ?? 0 },
                      {
                        label: "Без отгрузки",
                        value: dashboard?.appointments.withoutShipment ?? 0,
                        tone: dashboard?.appointments.withoutShipment ? "warning" : "muted",
                      },
                      {
                        label: "Связать",
                        value: dashboard?.appointments.requiresManualLink ?? 0,
                        tone: dashboard?.appointments.requiresManualLink ? "warning" : "muted",
                      },
                    ]}
                    dense
                  />
                  {scheduleItems.length ? (
                    <div className="eco-ops-schedule">
                      <div className="eco-ops-schedule-summary">
                        <div>
                          <span>Ближайшая запись</span>
                          <strong>
                            {dashboard?.appointments.next
                              ? `${dashboard.appointments.next.time} · ${dashboard.appointments.next.client}`
                              : "Записей нет"}
                          </strong>
                          <small>
                            {dashboard?.appointments.next
                              ? `${dashboard.appointments.next.vehicle || "авто не указано"} · ${dashboard.appointments.next.service}`
                              : "Можно ставить новые окна в журнал."}
                          </small>
                        </div>
                        <div>
                          <span>Свободные окна</span>
                          <strong>{formatCount(dashboard?.appointments.freeWindows.length ?? 0)}</strong>
                          <small>
                            {(dashboard?.appointments.freeWindows ?? []).slice(0, 3).map(scheduleWindowLabel).join(" · ") || "окон нет"}
                          </small>
                        </div>
                      </div>
                      <div className="eco-ops-timeline" aria-label="Расписание и свободные окна">
                        {scheduleItems.map((slot) => {
                          if (slot.kind === "window") {
                            return (
                              <article key={slot.key} className="eco-ops-timeline-item is-window">
                                <div className="eco-ops-timeline-time">
                                  <strong>{formatClockMinutes(slot.start)}</strong>
                                  <span>{formatClockMinutes(slot.end)}</span>
                                </div>
                                <div className="eco-ops-timeline-rail" aria-hidden>
                                  <span className="eco-ops-timeline-dot is-window" />
                                </div>
                                <div className="eco-ops-timeline-card">
                                  <div className="eco-ops-timeline-card-head">
                                    <b>Свободное окно</b>
                                    <Badge tone="success">окно</Badge>
                                  </div>
                                  <span>{slot.label} · можно записать клиента</span>
                                </div>
                                <div className="eco-ops-row-actions">
                                  <RowAction href={recordCreateHref()} tone="quiet">Записать</RowAction>
                                </div>
                              </article>
                            );
                          }

                          const item = slot.item;
                          const allActions = appointmentActions(item);
                          const visibleActions = allActions.slice(0, 2);
                          return (
                            <article key={slot.key} className={`eco-ops-timeline-item is-record is-${appointmentStatusKey(item.status)}`}>
                              <div className="eco-ops-timeline-time">
                                <strong>{item.time || "—"}</strong>
                                <span>{item.status || "запись"}</span>
                              </div>
                              <div className="eco-ops-timeline-rail" aria-hidden>
                                <span className={`eco-ops-timeline-dot is-${toneClass(appointmentTone(item.status))}`} />
                              </div>
                              <div className="eco-ops-timeline-card">
                                <div className="eco-ops-timeline-card-head">
                                  <Link href={recordHref(item)}>{item.client}</Link>
                                  <Badge tone={appointmentTone(item.status)} dot>{item.status || "Запланирована"}</Badge>
                                </div>
                                <span>{[item.phone, item.vehicle || "авто не указано", item.service].filter(Boolean).join(" · ")}</span>
                                <small className={item.hasShipment ? "" : "is-warning"}>
                                  {item.shipmentStatus || (item.hasShipment ? "Отгрузка связана" : "Отгрузка не найдена")}
                                </small>
                              </div>
                              <div className="eco-ops-row-actions">
                                {visibleActions.map((action) => (
                                  <RowAction key={`${item.id}-${action.label}`} href={action.href} tone={action.tone}>
                                    {action.label}
                                  </RowAction>
                                ))}
                                {allActions.length > visibleActions.length && (
                                  <RowAction href={recordHref(item)} tone="quiet">
                                    Ещё {allActions.length - visibleActions.length}
                                  </RowAction>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <>
                      <EmptyState title="Записей на сегодня нет" hint="Журнал останется первым блоком, как только появятся записи." />
                      <div className="eco-ops-empty-actions">
                        <RowAction href={recordCreateHref()} tone="primary">Создать запись</RowAction>
                      </div>
                    </>
                  )}
                </>
              )}
            </Card>

            {role !== "master" && dashboard.crm && <Card
              title="Дела клиентов"
              href="/crm?filter=today"
              action="Все дела"
              badge={
                <Badge tone={dashboard?.crm?.overdue ? "warning" : "neutral"}>
                  {formatCount(dashboard?.crm?.overdue ?? 0)} просрочено
                </Badge>
              }
              className="eco-ops-card--cases"
            >
              {dashboardError && !dashboard ? (
                <ErrorState title="Дела не загрузились" hint={dashboardError} />
              ) : loading && !dashboard ? (
                <LoadingState rows={5} />
              ) : (
                <>
                  <StatStrip
                    items={[
                      { label: "Сегодня", value: dashboard?.crm?.today ?? 0 },
                      { label: "Без ответств.", value: dashboard?.crm?.noResponsible ?? 0, tone: dashboard?.crm?.noResponsible ? "warning" : "muted" },
                      { label: "Расчёт", value: dashboard?.crm?.quote ?? 0, tone: dashboard?.crm?.quote ? "warning" : "muted" },
                      { label: "Перезвонить", value: dashboard?.crm?.callback ?? 0, tone: dashboard?.crm?.callback ? "warning" : "muted" },
                      { label: "Запчасти", value: dashboard?.crm?.supplies ?? 0, tone: dashboard?.crm?.supplies ? "warning" : "muted" },
                    ]}
                    dense
                  />
                  {dashboard.crm.rows.length ? (
                    <div className="eco-ops-case-list">
                      {dashboard.crm.rows.slice(0, 6).map((item) => (
                        <article key={item.id} className="eco-ops-case-row">
                          <div className="eco-ops-case-person">
                            <Link href={crmHref(item)}>{item.client}</Link>
                            <span>{item.phone || "телефон не указан"}</span>
                          </div>
                          <div className="eco-ops-case-task">
                            <strong>{item.title}</strong>
                            <span>
                              <Badge tone={item.status.toLowerCase().includes("расход") ? "info" : item.status.toLowerCase().includes("ответ") ? "warning" : "neutral"}>
                                {item.status}
                              </Badge>
                              <em className={item.deadline && new Date(item.deadline).getTime() < (lastUpdatedAt ?? 0) ? "is-over" : ""}>{formatShortDeadline(item.deadline)}</em>
                            </span>
                          </div>
                          <div className="eco-ops-case-owner">
                            <span>{initials(item.responsible)}</span>
                            <small>{item.responsible}</small>
                          </div>
                          <div className="eco-ops-row-actions">
                            <RowAction href={crmHref(item)} tone="primary">Открыть</RowAction>
                            {item.phone && (
                              <a href={`tel:${item.phone}`} className="eco-ops-row-action is-quiet">
                                Позвонить
                              </a>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="Актуальных дел нет" hint="Просроченные, сегодняшние и старые клиентские дела появятся здесь." />
                  )}
                </>
              )}
            </Card>}

            <Card
              title="Отгрузки сегодня"
              href="/shipment"
              action="Все отгрузки"
              badge={
                <Badge tone={dashboard?.shipments.unpaid || dashboard?.shipments.drafts ? "warning" : "neutral"}>
                  {formatCount((dashboard?.shipments.unpaid ?? 0) + (dashboard?.shipments.drafts ?? 0))} не закрыто
                </Badge>
              }
              className="eco-ops-card--shipments"
            >
              {dashboardError && !dashboard ? (
                <ErrorState title="Отгрузки не загрузились" hint={dashboardError} />
              ) : loading && !dashboard ? (
                <LoadingState rows={5} />
              ) : (
                <>
                  <StatStrip
                    items={[
                      { label: "Всего", value: dashboard?.shipments.today ?? 0 },
                      { label: "Черновики", value: dashboard?.shipments.drafts ?? 0, tone: dashboard?.shipments.drafts ? "warning" : "muted" },
                      { label: "Проведённые", value: dashboard?.shipments.applicable ?? 0 },
                      { label: "Неоплаченные", value: dashboard?.shipments.unpaid ?? 0, tone: dashboard?.shipments.unpaid ? "warning" : "muted" },
                      { label: "Без диагн.", value: dashboard?.shipments.withoutDiagnostic ?? 0 },
                      { label: "Без предчека", value: dashboard?.shipments.withoutPrecheck ?? 0 },
                    ]}
                    dense
                  />
                  {dashboard?.shipments.rows.length ? (
                    <div className="eco-ops-table-scroll">
                      <p className="eco-ops-table-scroll-hint">Прокрутите таблицу в сторону, чтобы увидеть все столбцы →</p>
                      <table className="eco-ops-table eco-ops-shipments-table">
                        <caption className="eco-visually-hidden">Отгрузки за сегодня: документы, статусы, оплата и диагностика</caption>
                        <thead>
                          <tr>
                            <th scope="col">Время</th>
                            <th scope="col">Документ</th>
                            <th scope="col">Клиент</th>
                            <th scope="col">Статус</th>
                            {role !== "master" && <th scope="col">Оплата</th>}
                            <th scope="col">Диагностика</th>
                            {role !== "master" && <th scope="col" className="is-num">Сумма</th>}
                            <th scope="col">Действия</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dashboard.shipments.rows.slice(0, 7).map((row) => (
                            <tr key={row.id}>
                              <td className="eco-ops-time">{formatTime(row.moment)}</td>
                              <td>
                                <Link href={`/shipment/${row.id}`} className="eco-ops-doc">{row.name}</Link>
                                <span className="eco-ops-doc-sub">{row.creator || row.store || "локальная БД"}</span>
                              </td>
                              <td>{row.client}</td>
                              <td>
                                <Badge tone={row.applicable ? "success" : "warning"} dot>
                                  {row.applicable ? "проведена" : "черновик"}
                                </Badge>
                              </td>
                              {role !== "master" && <td>
                                <Badge tone={paymentTone(row.paymentStatus) as EcoBadgeTone}>{paymentLabel(row.paymentStatus)}</Badge>
                              </td>}
                              <td>
                                <Badge tone={row.hasDiagnostic ? "success" : "warning"}>{row.hasDiagnostic ? "есть" : "нет"}</Badge>
                              </td>
                              {role !== "master" && <td className="is-num">{formatMoneyCents(row.sumCents ?? 0)}</td>}
                              <td>
                                <div className="eco-ops-row-actions is-table">
                                  <RowAction href={`/shipment/${row.id}`} tone="primary">Открыть</RowAction>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <>
                      <EmptyState
                        title="Отгрузок сегодня нет"
                        hint={role === "master" ? "Новые работы и диагностики появятся здесь после создания отгрузки." : "Операционные показатели появятся после первых проведённых документов."}
                      />
                      <div className="eco-ops-empty-actions">
                        <RowAction href={role === "master" ? "/records" : "/shipment/new"} tone="primary">
                          {role === "master" ? "К журналу" : "Новая отгрузка"}
                        </RowAction>
                      </div>
                    </>
                  )}
                </>
              )}
            </Card>

          </section>

          <section className="eco-ops-secondary-widgets" aria-label="История дня">
            <Card
              title="Последние события"
              href="/notifications"
              action="Все"
              badge={<Badge tone={feedItems.length ? "info" : "neutral"}>{formatCount(feedItems.length)}</Badge>}
              flat
              className="eco-ops-card--events"
            >
              <div className="eco-ops-feed">
                {feedItems.length ? (
                  feedItems.slice(0, 5).map((item) => (
                    <Link key={item.id} href={item.entityHref} className="eco-ops-feed-item">
                      <span className="eco-ops-feed-time">{item.deadline ? formatTime(item.deadline) : "сейчас"}</span>
                      <span className={`eco-ops-dot is-${urgencyDot(item.urgency)}`} />
                      <span>
                        <b>{item.title}</b>
                        <small>{item.description}</small>
                      </span>
                    </Link>
                  ))
                ) : (
                  <EmptyState title="Событий нет" hint="Когда появятся дедлайны или просрочки, они будут здесь." />
                )}
              </div>
            </Card>
            {role !== "master" && dashboard.stock && dashboard.suppliers && <Card
              title="Склад и счета"
              href="/inventory/restock"
              action="К пополнению"
              badge={
                <Badge tone={dashboard.stock.belowMin || dashboard.suppliers.unpaidInvoices ? "warning" : "neutral"}>
                  {formatCount(dashboard.stock.belowMin + dashboard.suppliers.unpaidInvoices)}
                </Badge>
              }
              flat
              className="eco-ops-card--supply"
            >
              <div className="eco-ops-compact-stack">
                <div className="eco-ops-compact-head">
                  <strong>Ниже минимума</strong>
                  <span>{formatCount(dashboard.stock.belowMin)}</span>
                </div>
                {dashboard.stock.rows.length ? (
                  <div className="eco-ops-compact-list">
                    {dashboard.stock.rows.slice(0, 4).map((item) => (
                      <Link key={item.id} href="/inventory/restock?mode=below_min" className="eco-ops-compact-row">
                        <span>
                          <b>{item.name}</b>
                          <small>{item.store}</small>
                        </span>
                        <strong>{formatCount(item.available)} / {formatCount(item.minimum)}</strong>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Критичных остатков нет" hint="Товары ниже минимума появятся здесь." />
                )}
                <div className="eco-ops-compact-head">
                  <strong>Счета поставщиков</strong>
                  <span>{formatMoneyCents(dashboard.suppliers.amountCents)}</span>
                </div>
                {dashboard.suppliers.rows.length ? (
                  <div className="eco-ops-compact-list">
                    {dashboard.suppliers.rows.slice(0, 3).map((item) => (
                      <Link key={item.id} href="/finance/invoices?status=unpaid" className="eco-ops-compact-row">
                        <span>
                          <b>{item.supplier}</b>
                          <small>{item.number} · срок {item.dueDate || "не указан"}</small>
                        </span>
                        <strong>{formatMoneyCents(item.amountCents)}</strong>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Неоплаченных счетов нет" hint="Счета к оплате появятся здесь." />
                )}
              </div>
            </Card>}
          </section>
        </>
      ))}
      </div>
    </main>
  );
}
