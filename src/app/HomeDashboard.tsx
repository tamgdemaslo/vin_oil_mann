"use client";

import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  PackagePlus,
  Phone,
  Play,
  Plus,
  Search,
  WalletCards,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
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
    freeWindows: string[];
    next: AppointmentItem | null;
    rows: AppointmentItem[];
  };
  crm: {
    overdue: number;
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

function Card({
  title,
  badge,
  href,
  action = "Открыть",
  children,
  flat = false,
  accent = false,
}: {
  title: string;
  badge?: ReactNode;
  href?: string;
  action?: string;
  children: ReactNode;
  flat?: boolean;
  accent?: boolean;
}) {
  return (
    <section className={`eco-ops-card ${flat ? "is-flat" : ""}`}>
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

function QuickAction({
  href,
  title,
  icon: Icon,
  primary = false,
}: {
  href: string;
  title: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  primary?: boolean;
}) {
  return (
    <Link href={href} className={`eco-ops-qa ${primary ? "is-primary" : ""}`}>
      <span className="eco-ops-qa-icon">
        <Icon aria-hidden className="eco-icon" />
      </span>
      <span>{title}</span>
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

  const isOwner = role === "owner";
  const needsActiveShift = role === "admin" || role === "master";
  const hasActiveShift = !!currentShift || currentCashShift?.status === "open";
  const sectionsLocked = needsActiveShift && !hasActiveShift;

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setLoading(true);
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
  const pageGreeting = sectionsLocked ? `Привет, ${userName}.` : `${isOwner ? "Добрый день" : "Привет"}, ${userName}.`;
  const notifications = dashboard?.notifications ?? [];
  const feedItems = notifications.slice(0, 5);

  return (
    <main className="eco-ops-dashboard">
      <section className="eco-ops-anchor">
        <div className="eco-ops-anchor-inner">
          <div className="eco-ops-eyebrow">Операционный центр дня</div>
          <h1>
            {pageGreeting} <span>{todayShortPhrase()}.</span>
          </h1>
          <p>
            {sectionsLocked || cashClosed
              ? "Смена ещё не открыта — продажи и касса требуют внимания. Откройте день, чтобы начать."
              : "Сводка по кассе, отгрузкам, записям и клиентским делам."}
          </p>
          <div className="eco-ops-anchor-chips">
            {cashClosed && (
              <span className="eco-ops-chip">
                <span className="eco-ops-dot is-danger" /> Касса закрыта
              </span>
            )}
            {!!dashboard?.crm.overdue && (
              <span className="eco-ops-chip">
                <span className="eco-ops-dot is-danger" /> <b>{dashboard.crm.overdue}</b> дела просрочены
              </span>
            )}
            {!!dashboard?.stock.belowMin && (
              <span className="eco-ops-chip">
                <span className="eco-ops-dot is-warning" /> <b>{dashboard.stock.belowMin}</b> ниже минимума
              </span>
            )}
            {!!dashboard?.diagnostics.withoutPhoto && (
              <span className="eco-ops-chip">
                <span className="eco-ops-dot is-info" /> <b>{dashboard.diagnostics.withoutPhoto}</b> диагностик без отчёта
              </span>
            )}
          </div>
        </div>
        <div className="eco-ops-anchor-actions">
          {sectionsLocked ? (
            role === "admin" ? (
              <Link href="/cash#open" className="eco-ops-btn eco-ops-btn--primary eco-ops-btn--lg">
                <Play aria-hidden className="eco-icon" />
                Открыть смену
              </Link>
            ) : (
              <a href="#shift-control" className="eco-ops-btn eco-ops-btn--primary eco-ops-btn--lg">
                <Play aria-hidden className="eco-icon" />
                Открыть смену
              </a>
            )
          ) : (
            <Link href={cashClosed ? "/cash#open" : "/notifications"} className="eco-ops-btn eco-ops-btn--primary eco-ops-btn--lg">
              {cashClosed ? <WalletCards aria-hidden className="eco-icon" /> : <Bell aria-hidden className="eco-icon" />}
              {cashClosed ? "Открыть кассу" : "Уведомления"}
              {!!dashboard?.notificationCounts.total && !cashClosed && <span className="eco-ops-btn-badge">{dashboard.notificationCounts.total}</span>}
            </Link>
          )}
          <Link href="/shipment/new" className="eco-ops-btn eco-ops-btn--lite eco-ops-btn--lg">
            <Plus aria-hidden className="eco-icon" />
            Новая отгрузка
          </Link>
          <div className="eco-ops-anchor-note">
            сегодня · {formatCount(dashboard?.shipments.today ?? 0)} отгрузок · {formatMoneyCents(dashboard?.finance.revenueCents ?? 0)}
          </div>
        </div>
      </section>

      {needShiftNotice && (
        <div className="eco-ops-shift-notice">
          Для администратора и мастера остальные разделы открываются только после начала смены.
        </div>
      )}

      <section className="eco-ops-alerts" aria-label="Важные предупреждения">
        {visibleAlerts.length ? (
          visibleAlerts.map((alert) => (
            <Link key={alert.id} href={alert.href} className={`eco-ops-alert is-${toneClass(alert.tone)}`}>
              <span className="eco-ops-alert-icon">
                <AlertIcon tone={alert.tone} />
              </span>
              <span className="eco-ops-alert-text">{alert.label}</span>
              <strong>{formatCount(alert.count)}</strong>
            </Link>
          ))
        ) : (
          <div className="eco-ops-alert is-neutral">
            <span className="eco-ops-alert-icon">
              <CheckCircle2 aria-hidden className="eco-icon" />
            </span>
            <span className="eco-ops-alert-text">Критичных предупреждений нет</span>
            <strong>0</strong>
          </div>
        )}
      </section>

      <section className="eco-ops-kpis" aria-label="KPI дня">
        <div className="eco-ops-kpi is-hero">
          <span>Выручка сегодня</span>
          <strong>{loading ? "..." : formatMoneyCents(dashboard?.finance.revenueCents ?? 0)}</strong>
          <small>{formatCount(dashboard?.finance.shipmentsCount ?? 0)} отгрузок · оплачено {formatMoneyCents(dashboard?.finance.paidCents ?? 0)}</small>
        </div>
        <div className="eco-ops-kpi">
          <span>Валовая прибыль</span>
          <strong>{loading ? "..." : formatMoneyCents(dashboard?.finance.grossProfitCents ?? 0)}</strong>
          <small>по себестоимости позиций, не чистая прибыль</small>
        </div>
        <div className="eco-ops-kpi">
          <span>Средний чек</span>
          <strong>{dashboard?.finance.shipmentsCount ? formatMoneyCents(dashboard.finance.averageCheckCents) : "—"}</strong>
          <small>за сегодняшний день</small>
        </div>
        <div className="eco-ops-kpi">
          <span>Записи сегодня</span>
          <strong className={!dashboard?.appointments.totalToday ? "is-muted" : ""}>{formatCount(dashboard?.appointments.totalToday ?? 0)}</strong>
          <small>{dashboard?.appointments.next ? `ближайшая в ${dashboard.appointments.next.time}` : "Сегодня записей нет"}</small>
        </div>
        <div className="eco-ops-kpi is-alarm">
          <span>Дела просрочены</span>
          <strong className={dashboard?.crm.overdue ? "is-danger" : ""}>{formatCount(dashboard?.crm.overdue ?? 0)}</strong>
          <small>{formatCount(dashboard?.crm.today ?? 0)} дела на сегодня</small>
        </div>
        <div className="eco-ops-kpi is-alarm">
          <span>Касса</span>
          <strong className={cashClosed ? "is-danger is-word" : cashOpenLong ? "is-warning is-word" : "is-word"}>
            {dashboard?.cash.status === "open" ? "Открыта" : "Закрыта"}
          </strong>
          <small>{dashboard?.cash.status === "open" ? `с ${formatTime(dashboard.cash.openedAt)}` : "Касса закрыта"}</small>
        </div>
      </section>

      {sectionsLocked ? (
        role === "admin" ? null : (
          <section className="eco-ops-locked" id="shift-control">
            <h2>Открой рабочую смену, чтобы начать день.</h2>
            <p>После открытия смены станут доступны отгрузки, касса, приёмка и рабочие операции.</p>
            <div>
              <ShiftButton />
            </div>
          </section>
        )
      ) : (
        <>
          <section className="eco-ops-main-grid">
            <div className="eco-ops-col">
              <Card
                title="Дела клиентов"
                badge={<Badge tone={dashboard?.crm.overdue ? "danger" : "neutral"}>{formatCount(dashboard?.crm.overdue ?? 0)} просрочено</Badge>}
                href="/crm?filter=today"
                accent
              >
                <StatStrip
                  items={[
                    { label: "На сегодня", value: dashboard?.crm.today ?? 0 },
                    { label: "Ждут расчёт", value: dashboard?.crm.quote ?? 0, tone: dashboard?.crm.quote ? "warning" : "muted" },
                    { label: "Ждём расходники", value: dashboard?.crm.supplies ?? 0, tone: dashboard?.crm.supplies ? "warning" : "muted" },
                    { label: "Перезвонить", value: dashboard?.crm.callback ?? 0, tone: dashboard?.crm.callback ? "warning" : "muted" },
                    { label: "Без ответств.", value: dashboard?.crm.noResponsible ?? 0, tone: dashboard?.crm.noResponsible ? "danger" : "muted" },
                  ]}
                />
                <div>
                  {dashboard?.crm.rows.length ? (
                    dashboard.crm.rows.slice(0, 5).map((item) => (
                      <div key={item.id} className="eco-ops-crm-row-wrap">
                        <div className="eco-ops-crm-person">
                          <div className="eco-ops-crm-name">{item.client}</div>
                          {item.phone ? (
                            <Link href={`tel:${item.phone}`} className="eco-ops-crm-phone">
                              <Phone aria-hidden className="eco-icon" />
                              {item.phone}
                            </Link>
                          ) : (
                            <div className="eco-ops-crm-phone">телефон не указан</div>
                          )}
                        </div>
                        <Link href={`/crm?deal=${item.id}`} className="eco-ops-crm-row" aria-label={`Открыть дело клиента ${item.client}`}>
                          <span>
                            <span className="eco-ops-crm-task">{item.title}</span>
                            <span className="eco-ops-crm-meta">
                              <Badge tone={item.status.toLowerCase().includes("расход") ? "info" : item.status.toLowerCase().includes("ответ") ? "warning" : "neutral"}>
                                {item.status}
                              </Badge>
                            </span>
                          </span>
                          <span>
                            <span className={`eco-ops-crm-deadline ${item.deadline && new Date(item.deadline).getTime() < Date.now() ? "is-over" : ""}`}>
                              {formatShortDeadline(item.deadline)}
                            </span>
                            <span className="eco-ops-resp">
                              <span>{initials(item.responsible)}</span>
                              <small>{item.responsible}</small>
                            </span>
                          </span>
                          <span className="eco-ops-crm-open">
                            Открыть <ChevronRight aria-hidden className="eco-icon" />
                          </span>
                        </Link>
                      </div>
                    ))
                  ) : (
                    <EmptyState title="CRM-дел на сегодня нет" hint="Новые обращения и напоминания появятся в этом блоке." />
                  )}
                </div>
              </Card>

              <Card title="Активные отгрузки" badge={<Badge>сегодня</Badge>} href="/shipment" action="Все отгрузки">
                <StatStrip
                  items={[
                    { label: "Сегодня", value: dashboard?.shipments.today ?? 0 },
                    { label: "Черновики", value: dashboard?.shipments.drafts ?? 0 },
                    { label: "Проведённые", value: dashboard?.shipments.applicable ?? 0 },
                    { label: "Неоплаченные", value: dashboard?.shipments.unpaid ?? 0, tone: dashboard?.shipments.unpaid ? "warning" : "muted" },
                    { label: "Без диагн.", value: dashboard?.shipments.withoutDiagnostic ?? 0 },
                    { label: "Без предчека", value: dashboard?.shipments.withoutPrecheck ?? 0 },
                  ]}
                  dense
                />
                {dashboard?.shipments.rows.length ? (
                  <div className="eco-ops-table-scroll">
                    <table className="eco-ops-table">
                      <thead>
                        <tr>
                          <th>Время</th>
                          <th>Документ</th>
                          <th>Клиент</th>
                          <th>Статус</th>
                          <th>Оплата</th>
                          <th className="is-num">Сумма</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.shipments.rows.slice(0, 8).map((row) => (
                          <tr key={row.id} onClick={() => { window.location.href = `/shipment/${row.id}`; }}>
                            <td className="eco-ops-time">{formatTime(row.moment)}</td>
                            <td>
                              <span className="eco-ops-doc">{row.name}</span>
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState title="Сегодня отгрузок нет" hint="Выручка и прибыль появятся после проведённых отгрузок." />
                )}
              </Card>

              <div className="eco-ops-mini3">
                <Card title="Последние документы">
                  <div>
                    {dashboard?.documents.length ? (
                      dashboard.documents.slice(0, 3).map((doc) => (
                        <Link href={doc.href} key={doc.id} className="eco-ops-doc-row">
                          <span>
                            <b>{doc.name}</b>
                            <small>{doc.type} · {doc.date}</small>
                          </span>
                          <strong>{formatMoneyCents(doc.sumCents)}</strong>
                        </Link>
                      ))
                    ) : (
                      <EmptyState title="Документов пока нет" hint="Приёмки и списания появятся после создания документов." />
                    )}
                  </div>
                </Card>
                <Card title="Счета поставщиков">
                  <div>
                    {dashboard?.suppliers.rows.length ? (
                      dashboard.suppliers.rows.slice(0, 2).map((invoice) => (
                        <Link href="/finance/invoices?status=unpaid" key={invoice.id} className="eco-ops-doc-row">
                          <span>
                            <b>{invoice.supplier}</b>
                            <small>{invoice.number} · {invoice.status}</small>
                          </span>
                          <strong>{formatMoneyCents(invoice.amountCents)}</strong>
                        </Link>
                      ))
                    ) : (
                      <EmptyState title="Неоплаченных счетов нет" hint="Счета поставщиков появятся после приёмок." />
                    )}
                  </div>
                </Card>
                <Card title="Диагностики">
                  <div className="eco-ops-diag-stats">
                    <div>
                      <span>В работе</span>
                      <strong>{dashboard?.diagnostics.active ?? 0}</strong>
                    </div>
                    <div>
                      <span>Без фото / отчёта</span>
                      <strong className="is-warning">{dashboard?.diagnostics.withoutPhoto ?? 0}</strong>
                    </div>
                  </div>
                </Card>
              </div>
            </div>

            <aside className="eco-ops-col">
              <Card title="Записи сегодня" href="/records" action="Журнал" flat>
                <div className="eco-ops-records-slim">
                  <strong>{dashboard?.appointments.totalToday ?? 0}</strong>
                  <span>записей<br />на сегодня</span>
                  <div>
                    <small>Свободные окна</small>
                    <b>{dashboard?.appointments.freeWindows.slice(0, 3).join(" · ") || "—"}</b>
                  </div>
                </div>
                <StatStrip
                  items={[
                    { label: "Подтверждено", value: dashboard?.appointments.confirmedToday ?? 0 },
                    {
                      label: "Без отгрузки",
                      value: dashboard?.appointments.withoutShipment ?? 0,
                      tone: dashboard?.appointments.withoutShipment ? "warning" : "muted",
                    },
                  ]}
                  dense
                />
                {dashboard?.appointments.next && (
                  <div className="eco-ops-next-record">
                    <span>Ближайшая запись</span>
                    <strong>{dashboard.appointments.next.time} · {dashboard.appointments.next.client}</strong>
                    <small>{dashboard.appointments.next.vehicle || "авто не указано"} · {dashboard.appointments.next.service}</small>
                  </div>
                )}
                {dashboard?.appointments.rows.length ? (
                  <div className="eco-ops-appointment-list">
                    {dashboard.appointments.rows.slice(0, 3).map((item) => (
                      <Link key={item.id} href={item.hasShipment && item.shipmentId ? `/shipment/${item.shipmentId}` : `/shipment/new?recordId=${encodeURIComponent(item.id)}`}>
                        <span className="eco-ops-time">{item.time || "—"}</span>
                        <span className="eco-ops-appointment-main">
                          <b>{item.client}</b>
                          <small>{item.vehicle || "авто не указано"} · {item.service}</small>
                        </span>
                        <Badge tone={item.hasShipment ? "success" : "warning"}>{item.hasShipment ? "есть отгрузка" : "без отгрузки"}</Badge>
                        <em>{item.hasShipment ? "Открыть" : "Создать отгрузку"}</em>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Сегодня записей нет" hint="Ближайшие записи и свободные окна появятся после синхронизации журнала." />
                )}
              </Card>

              <Card
                title="Касса сегодня"
                badge={<Badge tone={cashClosed ? "danger" : cashOpenLong ? "warning" : "success"} dot>{cashClosed ? "закрыта" : "открыта"}</Badge>}
                href="/cash#cash-state"
                action="К кассе"
              >
                <div className="eco-ops-card-body">
                  {cashClosed ? (
                    <div className="eco-ops-cash-alarm">
                      <WalletCards aria-hidden className="eco-icon" />
                      <div>
                        <strong>Касса закрыта</strong>
                        <span>Откройте смену перед продажами и расходами.</span>
                      </div>
                    </div>
                  ) : cashOpenLong ? (
                    <div className="eco-ops-cash-alarm is-warning">
                      <AlertTriangle aria-hidden className="eco-icon" />
                      <div>
                        <strong>Смена открыта давно</strong>
                        <span>{Math.floor(dashboard?.cash.openedHours ?? 0)} ч. Проверьте закрытие кассы.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="eco-ops-cash-alarm is-success">
                      <CheckCircle2 aria-hidden className="eco-icon" />
                      <div>
                        <strong>Касса открыта</strong>
                        <span>Смена началась в {formatTime(dashboard?.cash.openedAt)}.</span>
                      </div>
                    </div>
                  )}
                  <div className="eco-ops-cash-actions">
                    <Link href="/cash#open" className="eco-ops-btn eco-ops-btn--primary">Открыть кассу</Link>
                    <div>
                      <Link href="/cash#close" className="eco-ops-btn eco-ops-btn--ghost">Закрыть кассу</Link>
                      <Link href="/cash#expense" className="eco-ops-btn eco-ops-btn--ghost">Добавить расход</Link>
                    </div>
                  </div>
                  <div className="eco-ops-cash-grid">
                    <div className="eco-ops-cash-metric">
                      <span>Открыл</span>
                      <strong>{dashboard?.cash.openedBy || "—"}</strong>
                    </div>
                    <div className="eco-ops-cash-metric">
                      <span>Время открытия</span>
                      <strong>{formatTime(dashboard?.cash.openedAt)}</strong>
                    </div>
                    <div className="eco-ops-cash-metric">
                      <span>Стартовый остаток</span>
                      <strong>{formatMoneyCents(dashboard?.cash.startBalanceCents ?? 0)}</strong>
                    </div>
                    <div className="eco-ops-cash-metric">
                      <span>Ожидаемый остаток</span>
                      <strong>{formatMoneyCents(dashboard?.cash.expectedBalanceCents ?? 0)}</strong>
                    </div>
                    <div className="eco-ops-cash-metric">
                      <span>Расходы</span>
                      <strong>{formatMoneyCents(dashboard?.cash.expensesCents ?? 0)}</strong>
                    </div>
                    <div className="eco-ops-cash-metric">
                      <span>Изъятия</span>
                      <strong>{formatMoneyCents(dashboard?.cash.withdrawalsCents ?? 0)}</strong>
                    </div>
                    <div className="eco-ops-cash-metric is-wide">
                      <span>Расхождение</span>
                      <strong className={(dashboard?.cash.discrepancyCents ?? 0) ? "is-danger" : ""}>
                        {formatMoneyCents(dashboard?.cash.discrepancyCents ?? 0)}
                      </strong>
                    </div>
                  </div>
                </div>
              </Card>

              <Card title="Быстрые действия" flat>
                <div className="eco-ops-qa-grid">
                  <QuickAction href="/shipment/new" title="Новая отгрузка" icon={Plus} primary />
                  <QuickAction href="/inventory/products" title="Найти товар" icon={Search} />
                  <QuickAction href="/records" title="Создать запись" icon={CalendarClock} />
                  <QuickAction href="/crm?action=create" title="Дело клиента" icon={Phone} />
                  <QuickAction href="/inventory/receipts" title="Создать приёмку" icon={PackagePlus} />
                  <QuickAction href="/cash#expense" title="Добавить расход" icon={CircleDollarSign} />
                </div>
              </Card>

              <Card title="Лента событий" href="/notifications" action="Все" flat>
                <div className="eco-ops-feed">
                  {feedItems.length ? (
                    feedItems.map((item) => (
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

              <Card title="Склад / дефицит" href="/inventory/restock?mode=below_min" flat>
                <StatStrip
                  items={[
                    { label: "Ниже минимума", value: dashboard?.stock.belowMin ?? 0, tone: dashboard?.stock.belowMin ? "danger" : "muted" },
                    { label: "Счета к оплате", value: dashboard?.suppliers.unpaidInvoices ?? 0, tone: dashboard?.suppliers.unpaidInvoices ? "warning" : "muted" },
                  ]}
                />
                <div>
                  {dashboard?.stock.rows.length ? (
                    dashboard.stock.rows.slice(0, 5).map((row) => (
                      <Link href={`/inventory/products?q=${encodeURIComponent(row.name)}`} key={row.id} className="eco-ops-stock-row">
                        <span>{row.name}</span>
                        <strong>
                          <b>{row.available}</b>
                          <i>/</i>
                          <em>{row.minimum}</em>
                        </strong>
                      </Link>
                    ))
                  ) : (
                    <EmptyState title="Дефицита ниже минимума нет" hint="Складские предупреждения появятся при снижении остатка." />
                  )}
                </div>
              </Card>
            </aside>
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
    </main>
  );
}
