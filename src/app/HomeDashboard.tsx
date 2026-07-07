"use client";

import {
  CalendarDays,
  ChevronRight,
  Gauge,
  MessageCircle,
  MoreHorizontal,
  Play,
  Plus,
  Truck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import ShiftButton from "@/components/ShiftButton";
import { type EcoBadgeTone } from "@/components/platform/EcoUI";
import { SERVICE_TIME_ZONE, formatServiceDayMonth, formatServiceTime } from "@/lib/date-time";
import { tryResponseJson } from "@/lib/response-json";

type CurrentShift = { id: string } | null;
type CurrentCashShift = { id: string; status: "open" | "closed" } | null;
type NotificationUrgency = "urgent" | "today" | "soon" | "info";

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
  sumCents: number;
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
  finance: {
    revenueCents: number;
    grossProfitCents: number;
    averageCheckCents: number;
    shipmentsCount: number;
    paidCents: number;
    unpaidCents: number;
    cashCents: number;
    cardCents: number;
    paymentSourceLabel: string;
  };
  cash: {
    status: "open" | "closed";
    openedBy: string | null;
    openedAt: string | null;
    startBalanceCents: number;
    expectedBalanceCents: number;
    expensesCents: number;
    withdrawalsCents: number;
    discrepancyCents: number;
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
  };
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
  };
  suppliers: {
    unpaidInvoices: number;
    amountCents: number;
    rows: SupplierInvoiceItem[];
  };
  diagnostics: {
    active: number;
    withoutPhoto: number;
  };
  messages?: {
    total: number;
    needsReply: number;
    unread: number;
    oldest: {
      client: string;
      hours: number;
      href: string;
    } | null;
  };
  alerts: Array<{ id: string; label: string; href: string; count: number; tone: EcoBadgeTone }>;
  notifications: DashboardNotification[];
  notificationCounts: Record<NotificationUrgency | "total", number>;
  documents: Array<{ id: string; type: string; name: string; date: string; sumCents: number; href: string }>;
};

const SHIFT_EVENT = "eco-shift-changed";

function formatMoneyCents(amountCents: number) {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(amountCents / 100))} ₽`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function formatHours(value?: number | null) {
  if (!value || value <= 0) return "—";
  return `${formatCount(value)} ч`;
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
  | { kind: "record"; key: string; start: number; item: AppointmentItem }
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

function scheduleWindowLabel(value: string) {
  const start = parseClockMinutes(value);
  if (start === null) return value;
  return `${formatClockMinutes(start)}–${formatClockMinutes(start + SCHEDULE_WINDOW_MINUTES)}`;
}

function buildScheduleTimeline(appointments: AppointmentItem[], freeWindows: string[]) {
  const recordItems: ScheduleTimelineItem[] = appointments.map((item, index) => ({
    kind: "record",
    key: `record-${item.id}`,
    start: parseClockMinutes(item.time) ?? 24 * 60 + index,
    item,
  }));
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

  return [...recordItems, ...windowItems].sort((a, b) => a.start - b.start).slice(0, 12);
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

function ErrorState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="eco-ops-empty is-error">
      <strong>{title}</strong>
      <span>{hint}</span>
    </div>
  );
}

function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div className="eco-ops-loading" aria-label="Загрузка">
      {Array.from({ length: rows }).map((_, index) => (
        <span key={index} />
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
  title: string;
  meta: string;
  href: string;
  action: string;
};

function buildRevenueForecast(dashboard: DashboardData | null, cashClosed: boolean) {
  if (!dashboard) {
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
    const low = currentRevenue + averageCheck * recordsWithoutShipment * 0.45;
    const high = currentRevenue + averageCheck * recordsWithoutShipment * 1.15;
    return {
      tone: "success" as const,
      short: `${formatMoneyCents(low)} – ${formatMoneyCents(high)}`,
      value: `${formatMoneyCents(low)} – ${formatMoneyCents(high)}`,
      details: [
        `${formatCount(shipmentCount)} отгрузок уже есть.`,
        `${formatCount(recordsWithoutShipment)} записей без найденной отгрузки.`,
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

function MobileActionRow({
  title,
  value,
  detail,
  href,
  action,
  tone = "neutral",
}: {
  title: string;
  value: ReactNode;
  detail: ReactNode;
  href: string;
  action: string;
  tone?: MobileProblemTone;
}) {
  return (
    <Link href={href} className={`eco-mobile-action-row is-${tone}`}>
      <span>
        <b>{title}</b>
        <small>{detail}</small>
      </span>
      <strong>{value}</strong>
      <em>{action}</em>
    </Link>
  );
}

export default function HomeDashboard({
  role,
  userName,
  needShiftNotice = false,
}: {
  role: string;
  login: string;
  userName: string;
  needShiftNotice?: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [currentShift, setCurrentShift] = useState<CurrentShift>(null);
  const [currentCashShift, setCurrentCashShift] = useState<CurrentCashShift>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  const needsActiveShift = role === "admin" || role === "master";
  const hasActiveShift = !!currentShift || currentCashShift?.status === "open";
  const sectionsLocked = needsActiveShift && !hasActiveShift;

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setLoading(true);
      setDashboardError(null);
      try {
        const [shiftRes, cashRes, dashboardRes] = await Promise.all([
          fetch("/api/shifts/current", { cache: "no-store" }),
          fetch("/api/cash", { cache: "no-store" }),
          fetch("/api/dashboard/operations", { cache: "no-store" }),
        ]);

        if (cancelled) return;
        setCurrentShift(await tryResponseJson<NonNullable<CurrentShift>>(shiftRes));
        const cashData = await tryResponseJson<{ shift?: CurrentCashShift }>(cashRes);
        setCurrentCashShift(cashData?.shift ?? null);
        setDashboard(await tryResponseJson<DashboardData>(dashboardRes));
      } catch {
        if (!cancelled) {
          setDashboardError("Не удалось загрузить операционную сводку.");
          setDashboard(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadSummary();
    const handleShiftChanged = () => void loadSummary();
    window.addEventListener(SHIFT_EVENT, handleShiftChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(SHIFT_EVENT, handleShiftChanged);
    };
  }, []);

  const cashClosed = dashboard?.cash.status !== "open";
  const cashOpenLong = (dashboard?.cash.openedHours ?? 0) >= 10;
  const notifications = dashboard?.notifications ?? [];
  const feedItems = notifications.slice(0, 5);
  const messages = dashboard?.messages ?? { total: 0, needsReply: 0, unread: 0, oldest: null };
  const forecast = buildRevenueForecast(dashboard, cashClosed);
  const scheduleItems = useMemo(
    () => buildScheduleTimeline(dashboard?.appointments.rows ?? [], dashboard?.appointments.freeWindows ?? []),
    [dashboard?.appointments.rows, dashboard?.appointments.freeWindows]
  );
  const blockingProblems = cashClosed ? 1 : 0;
  const shiftStatusLine = sectionsLocked
    ? "Смена не начата · касса закрыта"
    : dashboard?.cash.status === "open"
      ? `Касса открыта${formatTime(dashboard.cash.openedAt) !== "—" ? ` с ${formatTime(dashboard.cash.openedAt)}` : ""}`
      : currentShift
        ? "Смена активна · касса закрыта"
        : "Смена не начата · касса закрыта";
  const mobilePrimaryAction = sectionsLocked
    ? { href: role === "admin" ? "/cash#open" : "#shift-control", label: "Открыть смену" }
    : cashClosed
      ? { href: "/cash#open", label: "Открыть кассу" }
      : { href: "/shipment/new", label: "Новая отгрузка" };
  const attentionItems = useMemo<MobileProblem[]>(() => {
    const items: MobileProblem[] = [];
    if (cashClosed) {
      items.push({
        id: "cash-closed",
        tone: "danger",
        title: "Касса закрыта",
        meta: "Перед продажами нужно открыть смену.",
        href: "/cash#open",
        action: "Открыть",
      });
    } else if (cashOpenLong) {
      items.push({
        id: "cash-open-long",
        tone: "warning",
        title: "Касса открыта давно",
        meta: `${formatHours(Math.floor(dashboard?.cash.openedHours ?? 0))} без закрытия.`,
        href: "/cash#cash-state",
        action: "Проверить",
      });
    }
    if (messages.needsReply > 0) {
      items.push({
        id: "messages",
        tone: "warning",
        title: `${formatCount(messages.needsReply)} сообщений требуют ответа`,
        meta: messages.oldest ? `Самое старое: ${messages.oldest.client} · ${formatHours(messages.oldest.hours)}` : "Есть непрочитанные диалоги.",
        href: "/messages",
        action: "Открыть",
      });
    }
    if ((dashboard?.crm.overdue ?? 0) > 0) {
      items.push({
        id: "crm-overdue",
        tone: "warning",
        title: `${formatCount(dashboard?.crm.overdue ?? 0)} просроченных дел`,
        meta: (dashboard?.crm.oldestOverdueHours ?? 0) > 0 ? `Старшее ${formatHours(dashboard?.crm.oldestOverdueHours)}` : "Нужен контроль дедлайнов.",
        href: "/crm?filter=overdue",
        action: "Смотреть",
      });
    }
    if ((dashboard?.appointments.withoutShipment ?? 0) > 0) {
      items.push({
        id: "appointments-without-shipment",
        tone: "warning",
        title: `${formatCount(dashboard?.appointments.withoutShipment ?? 0)} без найденной отгрузки`,
        meta: "Проверьте журнал или создайте документ.",
        href: "/records?filter=no-shipment",
        action: "Создать",
      });
    }
    if ((dashboard?.appointments.requiresManualLink ?? 0) > 0) {
      items.push({
        id: "appointments-manual-link",
        tone: "warning",
        title: `${formatCount(dashboard?.appointments.requiresManualLink ?? 0)} требуют связи`,
        meta: "Найдены возможные отгрузки, нужно выбрать правильную.",
        href: "/records?filter=shipment-link",
        action: "Связать",
      });
    }
    if ((dashboard?.stock.belowMin ?? 0) > 0) {
      items.push({
        id: "stock-below-min",
        tone: "warning",
        title: `${formatCount(dashboard?.stock.belowMin ?? 0)} товаров ниже минимума`,
        meta: "Нужно проверить пополнение.",
        href: "/inventory/restock?mode=below_min",
        action: "Проверить",
      });
    }
    if ((dashboard?.diagnostics.withoutPhoto ?? 0) > 0) {
      items.push({
        id: "diagnostics-without-photo",
        tone: "neutral",
        title: `${formatCount(dashboard?.diagnostics.withoutPhoto ?? 0)} диагностик без фото / отчёта`,
        meta: "Закройте незавершённые отчёты.",
        href: "/shipment?filter=diagnostics",
        action: "Проверить",
      });
    }
    if ((dashboard?.suppliers.unpaidInvoices ?? 0) > 0) {
      items.push({
        id: "supplier-invoices",
        tone: "warning",
        title: `${formatCount(dashboard?.suppliers.unpaidInvoices ?? 0)} счетов поставщиков`,
        meta: `${formatMoneyCents(dashboard?.suppliers.amountCents ?? 0)} к контролю оплаты.`,
        href: "/finance/invoices",
        action: "Счета",
      });
    }
    return items.slice(0, 6);
  }, [
    cashClosed,
    cashOpenLong,
    dashboard?.appointments.withoutShipment,
    dashboard?.appointments.requiresManualLink,
    dashboard?.cash.openedHours,
    dashboard?.crm.oldestOverdueHours,
    dashboard?.crm.overdue,
    dashboard?.diagnostics.withoutPhoto,
    dashboard?.stock.belowMin,
    dashboard?.suppliers.amountCents,
    dashboard?.suppliers.unpaidInvoices,
    messages.needsReply,
    messages.oldest,
  ]);

  return (
    <main className="eco-ops-dashboard">
      <section className="eco-mobile-control" aria-label={`Мобильный контроль дня для ${userName}`}>
        <header className="eco-mobile-top">
          <div>
            <strong>Там где масло</strong>
            <span>{todayShortPhrase()}</span>
            <small>{shiftStatusLine}</small>
          </div>
          <Link href={mobilePrimaryAction.href} className="eco-mobile-primary">
            {mobilePrimaryAction.label}
          </Link>
        </header>

        {needShiftNotice && (
          <div className="eco-mobile-inline-alert is-warning">
            Для администратора и мастера разделы открываются после начала смены.
          </div>
        )}

        <section className="eco-mobile-card eco-mobile-report">
          <div className="eco-mobile-card-head">
            <h2>Мини-отчёт</h2>
            <span className={`eco-mobile-status is-${cashClosed ? "danger" : "success"}`}>
              {cashClosed ? "касса закрыта" : "касса открыта"}
            </span>
          </div>

          <div className="eco-mobile-revenue">
            <span>Выручка сейчас</span>
            <strong>{loading ? "..." : formatMoneyCents(dashboard?.finance.revenueCents ?? 0)}</strong>
            <small>
              {dashboard?.cash.status === "open" ? "Касса открыта" : "Касса закрыта"} · {formatCount(dashboard?.finance.shipmentsCount ?? 0)} отгрузок · оплачено{" "}
              {formatMoneyCents(dashboard?.finance.paidCents ?? 0)}
            </small>
          </div>

          <div className="eco-mobile-metric-grid">
            <MobileReportMetric label="Прогноз" value={forecast.short} hint={forecast.value} tone={forecast.tone} />
            <MobileReportMetric
              label="Касса / смена"
              value={dashboard?.cash.status === "open" ? "Открыта" : "Закрыта"}
              hint={dashboard?.cash.status === "open" ? `с ${formatTime(dashboard.cash.openedAt)}` : "смена не начата"}
              tone={cashClosed ? "danger" : "success"}
            />
            <MobileReportMetric
              label="Записи сегодня"
              value={formatCount(dashboard?.appointments.totalToday ?? 0)}
              hint={`${formatCount(dashboard?.appointments.withoutShipment ?? 0)} без найденной · ${formatCount(dashboard?.appointments.requiresManualLink ?? 0)} связать`}
            />
            <MobileReportMetric
              label="Ближайшая"
              value={dashboard?.appointments.next ? dashboard.appointments.next.time : "—"}
              hint={dashboard?.appointments.next ? dashboard.appointments.next.client : "записей нет"}
            />
            <MobileReportMetric label="Отгрузки сегодня" value={formatCount(dashboard?.shipments.today ?? 0)} hint={`черновики: ${formatCount(dashboard?.shipments.drafts ?? 0)}`} />
            <MobileReportMetric label="Просрочено" value={formatCount(dashboard?.crm.overdue ?? 0)} hint={(dashboard?.crm.oldestOverdueHours ?? 0) > 0 ? `старшее ${formatHours(dashboard?.crm.oldestOverdueHours)}` : "дел нет"} tone={dashboard?.crm.overdue ? "warning" : "neutral"} />
            <MobileReportMetric label="Блокеры" value={formatCount(blockingProblems)} hint={blockingProblems ? "мешают продажам" : "блокеров нет"} tone={blockingProblems ? "danger" : "success"} />
          </div>
        </section>

        <section className={`eco-mobile-card eco-mobile-forecast is-${forecast.tone}`}>
          <div className="eco-mobile-card-head">
            <h2>Прогноз до конца дня</h2>
            <span>{forecast.tone === "success" ? "диапазон" : forecast.tone === "warning" ? "низкая точность" : "статус"}</span>
          </div>
          <strong>{forecast.value}</strong>
          <ul>
            {forecast.details.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="eco-mobile-card eco-mobile-attention">
          <div className="eco-mobile-card-head">
            <h2>Требует внимания</h2>
            <span>{attentionItems.length ? `${attentionItems.length} из главных` : "чисто"}</span>
          </div>
          {attentionItems.length ? (
            <div className="eco-mobile-problems">
              {attentionItems.map((item) => (
                <Link key={item.id} href={item.href} className={`eco-mobile-problem is-${item.tone}`}>
                  <span className="eco-mobile-problem-dot" />
                  <span>
                    <b>{item.title}</b>
                    <small>{item.meta}</small>
                  </span>
                  <em>{item.action}</em>
                </Link>
              ))}
            </div>
          ) : (
            <div className="eco-mobile-inline-alert is-success">Сейчас нет задач, которые требуют решения.</div>
          )}
        </section>

        <section className="eco-mobile-card eco-mobile-quick">
          <div className="eco-mobile-card-head">
            <h2>Быстрый доступ</h2>
            <span>2 раздела</span>
          </div>
          <div className="eco-mobile-action-list">
            <MobileActionRow
              title="Записи"
              value={formatCount(dashboard?.appointments.totalToday ?? 0)}
              detail={dashboard?.appointments.next ? `Ближайшая: ${dashboard.appointments.next.time} · ${dashboard.appointments.next.client}` : `${formatCount(dashboard?.appointments.withoutShipment ?? 0)} без найденной`}
              href="/records"
              action="Журнал"
              tone={dashboard?.appointments.withoutShipment || dashboard?.appointments.requiresManualLink ? "warning" : "neutral"}
            />
            <MobileActionRow
              title="Отгрузки"
              value={formatCount(dashboard?.shipments.today ?? 0)}
              detail={`Черновики: ${formatCount(dashboard?.shipments.drafts ?? 0)} · ${formatCount(dashboard?.appointments.withoutShipment ?? 0)} без найденной`}
              href="/shipment/new"
              action="Новая"
              tone={dashboard?.appointments.withoutShipment || dashboard?.appointments.requiresManualLink || dashboard?.shipments.drafts ? "warning" : "neutral"}
            />
          </div>
        </section>

        {sectionsLocked && role !== "admin" && (
          <section className="eco-mobile-card eco-mobile-shift" id="shift-control">
            <div>
              <h2>Смена не начата</h2>
              <p>Откройте рабочую смену, чтобы продолжить операции.</p>
            </div>
            <ShiftButton />
          </section>
        )}
      </section>

      <nav className="eco-mobile-bottom-nav" aria-label="Быстрый доступ">
        <Link href="/" className="is-active">
          <Gauge aria-hidden className="eco-icon" />
          <span>Контроль</span>
        </Link>
        <Link href="/messages">
          <MessageCircle aria-hidden className="eco-icon" />
          <span>Сообщения</span>
          {!!messages.needsReply && <b>{messages.needsReply > 99 ? "99+" : messages.needsReply}</b>}
        </Link>
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
      <section className="eco-ops-topbar" aria-label={`Панель владельца для ${userName}`}>
        <div className="eco-ops-topbar-main">
          <h1>Панель владельца</h1>
          <div className="eco-ops-topbar-meta">
            <span>Сегодня: {todayShortPhrase()}</span>
            <span>Организация: {SERVICE_ORGANIZATION_LABEL}</span>
            <span>Смена: {shiftStatusLine}</span>
          </div>
        </div>
        <div className="eco-ops-topbar-actions">
          {sectionsLocked ? (
            role === "admin" ? (
              <Link href="/cash#open" className="eco-ops-btn eco-ops-btn--primary">
                <Play aria-hidden className="eco-icon" />
                Открыть смену
              </Link>
            ) : (
              <a href="#shift-control" className="eco-ops-btn eco-ops-btn--primary">
                <Play aria-hidden className="eco-icon" />
                Открыть смену
              </a>
            )
          ) : null}
          <Link href="/shipment/new" className="eco-ops-btn eco-ops-btn--primary">
            <Plus aria-hidden className="eco-icon" />
            Новая отгрузка
          </Link>
        </div>
      </section>

      {needShiftNotice && (
        <div className="eco-ops-shift-notice">
          Для администратора и мастера остальные разделы открываются только после начала смены.
        </div>
      )}

      {sectionsLocked ? (
        <section className="eco-ops-locked" id="shift-control">
          <h2>Откройте рабочую смену, чтобы начать день.</h2>
          <p>После открытия смены главная покажет журнал, дела клиентов, отгрузки и деньги за сегодня.</p>
          <div>
            {role === "admin" ? (
              <Link href="/cash#open" className="eco-ops-btn eco-ops-btn--primary">
                <Play aria-hidden className="eco-icon" />
                Открыть смену
              </Link>
            ) : (
              <ShiftButton />
            )}
          </div>
        </section>
      ) : (
        <>
          <section className="eco-ops-owner-grid" aria-label="Деньги и внимание владельца">
            <section className="eco-ops-finance-panel">
              <header>
                <div>
                  <h2>Деньги сегодня</h2>
                  <p>
                    {formatCount(dashboard?.finance.shipmentsCount ?? 0)} отгрузок · оплачено {formatMoneyCents(dashboard?.finance.paidCents ?? 0)}
                  </p>
                </div>
                <Link href="/finance" className="eco-ops-btn eco-ops-btn--ghost eco-ops-btn--sm">
                  Финансы <ChevronRight aria-hidden className="eco-icon" />
                </Link>
              </header>
              {dashboardError ? (
                <ErrorState title="Финансы не загрузились" hint={dashboardError} />
              ) : loading && !dashboard ? (
                <LoadingState rows={4} />
              ) : (
                <div className="eco-ops-finance-mini" aria-label="Короткая финансовая сводка">
                  <div className="is-main">
                    <span>Выручка</span>
                    <strong>{formatMoneyCents(dashboard?.finance.revenueCents ?? 0)}</strong>
                  </div>
                  <div>
                    <span>Прибыль</span>
                    <strong>{formatMoneyCents(dashboard?.finance.grossProfitCents ?? 0)}</strong>
                  </div>
                  <div>
                    <span>Не оплачено</span>
                    <strong className={(dashboard?.finance.unpaidCents ?? 0) > 0 ? "is-warning" : ""}>{formatMoneyCents(dashboard?.finance.unpaidCents ?? 0)}</strong>
                  </div>
                </div>
              )}
            </section>

            <section className="eco-ops-attention-panel">
              <header>
                <div>
                  <h2>Требует решения</h2>
                  <p>Касса, клиенты, склад и диагностика в одном списке.</p>
                </div>
                <span>{attentionItems.length ? formatCount(attentionItems.length) : "0"}</span>
              </header>
              {attentionItems.length ? (
                <div className="eco-ops-attention-list">
                  {attentionItems.map((item) => (
                    <Link key={item.id} href={item.href} className={`eco-ops-attention-item is-${item.tone}`}>
                      <span className="eco-ops-attention-dot" />
                      <span>
                        <b>{item.title}</b>
                        <small>{item.meta}</small>
                      </span>
                      <em>{item.action}</em>
                    </Link>
                  ))}
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
              className="eco-ops-card--journal"
            >
              {dashboardError ? (
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
                          const primaryAction = appointmentActions(item)[0];
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
                                <RowAction href={primaryAction.href} tone={primaryAction.tone}>
                                  {primaryAction.label}
                                </RowAction>
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

            <Card
              title="Дела клиентов"
              href="/crm?filter=today"
              action="Все дела"
              className="eco-ops-card--cases"
            >
              {dashboardError ? (
                <ErrorState title="Дела не загрузились" hint={dashboardError} />
              ) : loading && !dashboard ? (
                <LoadingState rows={5} />
              ) : (
                <>
                  <StatStrip
                    items={[
                      { label: "Сегодня", value: dashboard?.crm.today ?? 0 },
                      { label: "Без ответств.", value: dashboard?.crm.noResponsible ?? 0, tone: dashboard?.crm.noResponsible ? "warning" : "muted" },
                      { label: "Расчёт", value: dashboard?.crm.quote ?? 0, tone: dashboard?.crm.quote ? "warning" : "muted" },
                      { label: "Перезвонить", value: dashboard?.crm.callback ?? 0, tone: dashboard?.crm.callback ? "warning" : "muted" },
                      { label: "Запчасти", value: dashboard?.crm.supplies ?? 0, tone: dashboard?.crm.supplies ? "warning" : "muted" },
                    ]}
                    dense
                  />
                  {dashboard?.crm.rows.length ? (
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
                              <em className={item.deadline && new Date(item.deadline).getTime() < Date.now() ? "is-over" : ""}>{formatShortDeadline(item.deadline)}</em>
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
            </Card>

            <Card title="Отгрузки сегодня" href="/shipment" action="Все отгрузки" className="eco-ops-card--shipments">
              {dashboardError ? (
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
                      <table className="eco-ops-table eco-ops-shipments-table">
                        <thead>
                          <tr>
                            <th>Время</th>
                            <th>Документ</th>
                            <th>Клиент</th>
                            <th>Статус</th>
                            <th>Оплата</th>
                            <th className="is-num">Сумма</th>
                            <th>Действия</th>
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
                              <td>
                                <Badge tone={paymentTone(row.paymentStatus) as EcoBadgeTone}>{paymentLabel(row.paymentStatus)}</Badge>
                              </td>
                              <td className="is-num">{formatMoneyCents(row.sumCents)}</td>
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
                      <EmptyState title="Отгрузок сегодня нет" hint="Выручка и прибыль появятся после первых проведённых документов." />
                      <div className="eco-ops-empty-actions">
                        <RowAction href="/shipment/new" tone="primary">Новая отгрузка</RowAction>
                      </div>
                    </>
                  )}
                </>
              )}
            </Card>

          </section>

          <section className="eco-ops-secondary-widgets" aria-label="История дня">
            <Card title="Последние события" href="/notifications" action="Все" flat className="eco-ops-card--events">
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
          </section>

          <section id="shift-control" className="eco-ops-shift-card">
            <div>
              <span className="eco-ops-eyebrow">Текущая рабочая смена</span>
              <h2>{hasActiveShift ? "Смена активна" : "Нет активной смены"}</h2>
            </div>
            <ShiftButton />
          </section>
        </>
      )}
      </div>
    </main>
  );
}
