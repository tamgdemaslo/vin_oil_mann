"use client";

import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Gauge,
  MessageCircle,
  MoreHorizontal,
  PackagePlus,
  Play,
  Plus,
  Truck,
  WalletCards,
  XCircle,
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
  if (status === "unpaid") return "danger";
  return "neutral";
}

const SERVICE_ORGANIZATION_LABEL = "Там где масло";

function marginPercent(revenueCents?: number, grossProfitCents?: number) {
  if (!revenueCents || revenueCents <= 0) return "—";
  return `${Math.round(((grossProfitCents ?? 0) / revenueCents) * 100)}%`;
}

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
  if (key === "no_show") return "danger";
  if (key === "done" || key === "confirmed") return "success";
  if (key === "arrived" || key === "waiting") return "info";
  if (key === "in_work") return "warning";
  return "neutral";
}

function shipmentTone(item: AppointmentItem): EcoBadgeTone {
  if (item.hasShipment) return "success";
  return item.shipmentStatus?.toLowerCase().includes("связ") ? "warning" : "danger";
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

function AlertIcon({ tone }: { tone: EcoBadgeTone }) {
  if (tone === "danger") return <XCircle aria-hidden className="eco-icon" />;
  if (tone === "warning") return <AlertTriangle aria-hidden className="eco-icon" />;
  if (tone === "info") return <ClipboardList aria-hidden className="eco-icon" />;
  return <Bell aria-hidden className="eco-icon" />;
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

  const visibleAlerts = useMemo(() => (dashboard?.alerts ?? []).filter((alert) => alert.count > 0).slice(0, 5), [dashboard]);
  const cashClosed = dashboard?.cash.status !== "open";
  const cashOpenLong = (dashboard?.cash.openedHours ?? 0) >= 10;
  const notifications = dashboard?.notifications ?? [];
  const feedItems = notifications.slice(0, 5);
  const messages = dashboard?.messages ?? { total: 0, needsReply: 0, unread: 0, oldest: null };
  const forecast = buildRevenueForecast(dashboard, cashClosed);
  const criticalProblems =
    (cashClosed ? 1 : 0) + (dashboard?.crm.overdue ? 1 : 0) + (messages.needsReply ? 1 : 0);
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
  const mobileProblems = useMemo<MobileProblem[]>(() => {
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
        tone: "danger",
        title: `${formatCount(messages.needsReply)} сообщений требуют ответа`,
        meta: messages.oldest ? `Самое старое: ${messages.oldest.client} · ${formatHours(messages.oldest.hours)}` : "Есть непрочитанные диалоги.",
        href: "/messages",
        action: "Открыть",
      });
    }
    if ((dashboard?.crm.overdue ?? 0) > 0) {
      items.push({
        id: "crm-overdue",
        tone: "danger",
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
        tone: "info",
        title: `${formatCount(dashboard?.diagnostics.withoutPhoto ?? 0)} диагностик без фото / отчёта`,
        meta: "Закройте незавершённые отчёты.",
        href: "/shipment?filter=diagnostics",
        action: "Проверить",
      });
    }
    return items.slice(0, 5);
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
            <MobileReportMetric label="Сообщения" value={formatCount(messages.total)} hint={`${formatCount(messages.needsReply)} требуют ответа`} tone={messages.needsReply ? "danger" : "neutral"} />
            <MobileReportMetric label="Просрочено" value={formatCount(dashboard?.crm.overdue ?? 0)} hint={(dashboard?.crm.oldestOverdueHours ?? 0) > 0 ? `старшее ${formatHours(dashboard?.crm.oldestOverdueHours)}` : "дел нет"} tone={dashboard?.crm.overdue ? "danger" : "neutral"} />
            <MobileReportMetric label="Критичные проблемы" value={formatCount(criticalProblems)} hint={criticalProblems ? "нужны действия" : "критичных нет"} tone={criticalProblems ? "danger" : "success"} />
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
            <span>{mobileProblems.length ? `${mobileProblems.length} из главных` : "чисто"}</span>
          </div>
          {mobileProblems.length ? (
            <div className="eco-mobile-problems">
              {mobileProblems.map((item) => (
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
            <div className="eco-mobile-inline-alert is-success">Критичных проблем сейчас нет.</div>
          )}
        </section>

        <section className="eco-mobile-card eco-mobile-quick">
          <div className="eco-mobile-card-head">
            <h2>Быстрый доступ</h2>
            <span>3 раздела</span>
          </div>
          <div className="eco-mobile-action-list">
            <MobileActionRow
              title="Сообщения"
              value={formatCount(messages.total)}
              detail={messages.oldest ? `${formatCount(messages.needsReply)} требуют ответа · ${messages.oldest.client} · ${formatHours(messages.oldest.hours)}` : `${formatCount(messages.needsReply)} требуют ответа`}
              href="/messages"
              action="Открыть"
              tone={messages.needsReply ? "danger" : "neutral"}
            />
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
      <section className="eco-ops-topbar" aria-label={`Операционный центр дня для ${userName}`}>
        <div className="eco-ops-topbar-main">
          <h1>Операционный центр дня</h1>
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
          <Link href={recordCreateHref()} className="eco-ops-btn">
            <CalendarClock aria-hidden className="eco-icon" />
            Создать запись
          </Link>
          <Link href={cashClosed ? "/cash#open" : "/cash#cash-state"} className="eco-ops-btn">
            <WalletCards aria-hidden className="eco-icon" />
            Открыть кассу
          </Link>
          <Link href="/messages" className="eco-ops-btn">
            <MessageCircle aria-hidden className="eco-icon" />
            Сообщения
            {!!messages.needsReply && <span className="eco-ops-btn-badge">{messages.needsReply > 99 ? "99+" : messages.needsReply}</span>}
          </Link>
        </div>
      </section>

      {needShiftNotice && (
        <div className="eco-ops-shift-notice">
          Для администратора и мастера остальные разделы открываются только после начала смены.
        </div>
      )}

      <section className="eco-ops-alert-strip" aria-label="Важные предупреждения">
        <span className="eco-ops-alert-strip-title">Внимание</span>
        {visibleAlerts.length ? (
          <div className="eco-ops-alert-strip-list">
            {visibleAlerts.map((alert) => (
            <Link key={alert.id} href={alert.href} className={`eco-ops-alert-chip is-${toneClass(alert.tone)}`}>
              <AlertIcon tone={alert.tone} />
              <span>{alert.label}</span>
              <strong>{formatCount(alert.count)}</strong>
            </Link>
            ))}
          </div>
        ) : (
          <div className="eco-ops-alert-strip-list">
            <div className="eco-ops-alert-chip is-neutral">
              <CheckCircle2 aria-hidden className="eco-icon" />
              <span>Критичных предупреждений нет</span>
              <strong>0</strong>
            </div>
          </div>
        )}
      </section>

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
          <section className="eco-ops-day-grid" aria-label="Операционный центр дня">
            <Card
              title="Журнал сегодня"
              badge={<Badge tone={(dashboard?.appointments.withoutShipment ?? 0) > 0 ? "warning" : "neutral"}>{formatCount(dashboard?.appointments.totalToday ?? 0)} записей</Badge>}
              href="/records"
              action="Журнал"
              accent
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
                  {dashboard?.appointments.next && (
                    <div className="eco-ops-next-record is-strong">
                      <span>Ближайшая запись</span>
                      <strong>{dashboard.appointments.next.time} · {dashboard.appointments.next.client}</strong>
                      <small>{dashboard.appointments.next.vehicle || "авто не указано"} · {dashboard.appointments.next.service}</small>
                    </div>
                  )}
                  {dashboard?.appointments.rows.length ? (
                    <div className="eco-ops-journal-list">
                      {dashboard.appointments.rows.slice(0, 6).map((item) => (
                        <article key={item.id} className={`eco-ops-journal-row is-${appointmentStatusKey(item.status)}`}>
                          <div className="eco-ops-journal-time">
                            <strong>{item.time || "—"}</strong>
                            <Badge tone={appointmentTone(item.status)} dot>{item.status || "Запланирована"}</Badge>
                          </div>
                          <div className="eco-ops-journal-main">
                            <Link href={recordHref(item)}>{item.client}</Link>
                            <span>{[item.phone, item.vehicle || "авто не указано", item.service].filter(Boolean).join(" · ")}</span>
                          </div>
                          <div className="eco-ops-journal-shipment">
                            <Badge tone={shipmentTone(item)}>{item.shipmentStatus || (item.hasShipment ? "Отгрузка связана" : "Отгрузка не найдена")}</Badge>
                            {!item.hasShipment && <small>Создать или связать</small>}
                          </div>
                          <div className="eco-ops-row-actions">
                            {appointmentActions(item).map((action) => (
                              <RowAction key={`${item.id}-${action.label}`} href={action.href} tone={action.tone}>
                                {action.label}
                              </RowAction>
                            ))}
                          </div>
                        </article>
                      ))}
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
              badge={<Badge tone={dashboard?.crm.overdue ? "danger" : "neutral"}>{formatCount(dashboard?.crm.overdue ?? 0)} просрочено</Badge>}
              href="/crm?filter=today"
              action="Все дела"
              accent
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
                      { label: "Ждут ответ", value: messages.needsReply, tone: messages.needsReply ? "danger" : "muted" },
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
                            <RowAction href={messagesHref(item.phone)}>Написать</RowAction>
                            {item.phone && (
                              <a href={`tel:${item.phone}`} className="eco-ops-row-action is-quiet">
                                Позвонить
                              </a>
                            )}
                            <RowAction href={crmHref(item)}>Закрыть</RowAction>
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

            <Card title="Отгрузки сегодня" badge={<Badge>сегодня</Badge>} href="/shipment" action="Все отгрузки" className="eco-ops-card--shipments">
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
                      { label: "Неоплаченные", value: dashboard?.shipments.unpaid ?? 0, tone: dashboard?.shipments.unpaid ? "danger" : "muted" },
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
                                  {row.paymentStatus !== "paid" && <RowAction href={`/shipment/${row.id}#payment`}>Оплата</RowAction>}
                                  <RowAction href={`/shipment/${row.id}/precheck`}>Предчек</RowAction>
                                  <RowAction href={`/shipment/${row.id}#diagnostic`}>Диагн.</RowAction>
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

            <Card title="Прибыль сегодня" badge={<Badge tone={dashboard?.shipments.unpaid ? "warning" : "neutral"}>{formatCount(dashboard?.shipments.unpaid ?? 0)} неоплачено</Badge>} href="/finance" action="Финансы" className="eco-ops-card--profit">
              {dashboardError ? (
                <ErrorState title="Финансы не загрузились" hint={dashboardError} />
              ) : loading && !dashboard ? (
                <LoadingState rows={4} />
              ) : (
                <div className="eco-ops-profit-body">
                  <div className="eco-ops-profit-hero">
                    <div>
                      <span>Выручка</span>
                      <strong>{formatMoneyCents(dashboard?.finance.revenueCents ?? 0)}</strong>
                    </div>
                    <div>
                      <span>Валовая прибыль</span>
                      <strong>{formatMoneyCents(dashboard?.finance.grossProfitCents ?? 0)}</strong>
                    </div>
                  </div>
                  <div className="eco-ops-profit-grid">
                    <div>
                      <span>Маржа</span>
                      <strong>{marginPercent(dashboard?.finance.revenueCents, dashboard?.finance.grossProfitCents)}</strong>
                    </div>
                    <div>
                      <span>Средний чек</span>
                      <strong>{dashboard?.finance.shipmentsCount ? formatMoneyCents(dashboard.finance.averageCheckCents) : "—"}</strong>
                    </div>
                    <div>
                      <span>Оплачено</span>
                      <strong>{formatMoneyCents(dashboard?.finance.paidCents ?? 0)}</strong>
                    </div>
                    <div>
                      <span>Неоплачено</span>
                      <strong className={(dashboard?.finance.unpaidCents ?? 0) > 0 ? "is-danger" : ""}>{formatMoneyCents(dashboard?.finance.unpaidCents ?? 0)}</strong>
                    </div>
                    <div>
                      <span>Расходы</span>
                      <strong>{formatMoneyCents(dashboard?.cash.expensesCents ?? 0)}</strong>
                    </div>
                    <div>
                      <span>Прогноз</span>
                      <strong className={forecast.tone === "warning" ? "is-warning" : ""}>{forecast.short}</strong>
                    </div>
                  </div>
                  {!dashboard?.finance.shipmentsCount && (
                    <p className="eco-ops-profit-note">Сегодня ещё нет проведённых отгрузок.</p>
                  )}
                </div>
              )}
            </Card>
          </section>

          <section className="eco-ops-secondary-widgets" aria-label="Вторичные показатели">
            <Link href={cashClosed ? "/cash#open" : "/cash#cash-state"} className={`eco-ops-secondary-widget is-${cashClosed ? "danger" : cashOpenLong ? "warning" : "success"}`}>
              <WalletCards aria-hidden className="eco-icon" />
              <span>Касса</span>
              <strong>{dashboard?.cash.status === "open" ? `открыта с ${formatTime(dashboard.cash.openedAt)}` : "закрыта"}</strong>
              <small>{dashboard?.cash.status === "open" ? `Остаток: ${formatMoneyCents(dashboard.cash.expectedBalanceCents)}` : "Открыть перед продажами"}</small>
            </Link>
            <Link href="/inventory/restock?mode=below_min" className={`eco-ops-secondary-widget is-${dashboard?.stock.belowMin ? "warning" : "neutral"}`}>
              <PackagePlus aria-hidden className="eco-icon" />
              <span>Склад</span>
              <strong>{formatCount(dashboard?.stock.belowMin ?? 0)} ниже минимума</strong>
              <small>{formatCount(dashboard?.suppliers.unpaidInvoices ?? 0)} счетов поставщиков</small>
            </Link>
            <Link href="/shipment?filter=diagnostics" className={`eco-ops-secondary-widget is-${dashboard?.diagnostics.withoutPhoto ? "info" : "neutral"}`}>
              <ClipboardList aria-hidden className="eco-icon" />
              <span>Диагностики</span>
              <strong>{formatCount(dashboard?.diagnostics.active ?? 0)} в работе</strong>
              <small>{formatCount(dashboard?.diagnostics.withoutPhoto ?? 0)} без фото / отчёта</small>
            </Link>
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
