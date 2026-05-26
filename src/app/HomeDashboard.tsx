"use client";

import {
  ChevronRight,
  CircleDollarSign,
  PackagePlus,
  Play,
  Plus,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import ShiftButton from "@/components/ShiftButton";
import { EcoBadge, EcoCard, EcoKpi, EcoStatusDot } from "@/components/platform/EcoUI";
import { tryResponseJson } from "@/lib/response-json";
import { getCurrentMonthRange } from "./cabinet/useOwnerUsers";

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
  startBalanceCents?: number;
  startBalance?: number;
} | null;

type PayrollByLogin = {
  shiftTotalCents: number;
  pieceworkCents: number;
  bonusPenaltyCents: number;
  totalCents: number;
  shiftsCount: number;
};

type PayrollResponse = {
  byLogin: Record<string, PayrollByLogin>;
};

type ShiftSummary = {
  shiftDate: string;
  startedAt: string;
  endedAt: string | null;
};

type BonusPenalty = {
  date: string;
  type: string;
  amountCents?: number;
  comment?: string;
};

type DemandApiRow = {
  id: string;
  name: string;
  moment: string;
  applicable: boolean;
  sum: number;
  agentName?: string;
  organizationName?: string;
  storeName?: string;
  ecoUserName?: string;
};

type DemandListResponse = {
  rows?: DemandApiRow[];
};

const SHIFT_EVENT = "eco-shift-changed";

function formatMoneyCents(amountCents: number) {
  return `${new Intl.NumberFormat("ru-RU").format(Math.round(amountCents / 100))} ₽`;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("ru-RU").format(Math.round(value));
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" });
}

function todayPhrase() {
  return new Date().toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "long",
  });
}

function statusTone(applicable: boolean) {
  return applicable ? "success" : "warning";
}

function statusLabel(applicable: boolean) {
  return applicable ? "проведена" : "черновик";
}

function MiniMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <div>
      <div className="eco-page-kicker">{label}</div>
      <div
        className="l-money"
        style={{
          color: tone === "success" ? "var(--eco-success)" : tone === "warning" ? "var(--eco-warning)" : "var(--eco-ink)",
          fontSize: 16,
          fontWeight: 700,
          marginTop: 4,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function PanelMini({
  title,
  rows,
  href,
}: {
  title: string;
  rows: Array<{ label: string; side: string; meta: string; tone?: "success" | "warning" | "danger" | "neutral" }>;
  href: string;
}) {
  return (
    <EcoCard padded={false}>
      <div className="eco-card__head">
        <span style={{ fontSize: 14, fontWeight: 600 }}> {title}</span>
        <Link href={href} className="eco-btn eco-btn--ghost eco-btn--sm">
          Открыть <ChevronRight aria-hidden className="eco-icon" />
        </Link>
      </div>
      <div>
        {rows.length > 0 ? (
          rows.map((row) => (
            <div key={`${row.label}-${row.side}`} className="eco-panel-row">
              <EcoStatusDot tone={row.tone === "neutral" ? "neutral" : row.tone ?? "neutral"} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    color: "var(--eco-ink)",
                    fontSize: 12.5,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.label}
                </div>
                <div style={{ color: "var(--eco-muted)", fontSize: 11, marginTop: 1 }}>{row.meta}</div>
              </div>
              <div className="l-mono" style={{ color: "var(--eco-ink-2)", fontSize: 12, fontWeight: 500 }}>
                {row.side}
              </div>
            </div>
          ))
        ) : (
          <div className="eco-panel-row">
            <EcoStatusDot tone="neutral" />
            <div style={{ color: "var(--eco-muted)", fontSize: 12 }}>Нет данных из реального источника.</div>
          </div>
        )}
      </div>
    </EcoCard>
  );
}

export default function HomeDashboard({
  role,
  login,
  userName,
  needShiftNotice = false,
}: {
  role: string;
  login: string;
  userName: string;
  needShiftNotice?: boolean;
}) {
  const monthRange = useMemo(() => getCurrentMonthRange(), []);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [currentShift, setCurrentShift] = useState<CurrentShift>(null);
  const [currentCashShift, setCurrentCashShift] = useState<CurrentCashShift>(null);
  const [payroll, setPayroll] = useState<PayrollResponse | null>(null);
  const [recentShifts, setRecentShifts] = useState<ShiftSummary[]>([]);
  const [recentBonuses, setRecentBonuses] = useState<BonusPenalty[]>([]);
  const [recentDemands, setRecentDemands] = useState<DemandApiRow[]>([]);

  const isOwner = role === "owner";
  const needsActiveShift = role === "admin" || role === "master";
  const hasActiveShift = !!currentShift || currentCashShift?.status === "open";
  const sectionsLocked = needsActiveShift && !hasActiveShift;

  useEffect(() => {
    let cancelled = false;

    async function loadSummary() {
      setSummaryLoading(true);
      try {
        const params = new URLSearchParams({
          dateFrom: monthRange.dateFrom,
          dateTo: monthRange.dateTo,
        });
        const [shiftRes, payrollRes, shiftsRes, bonusesRes, cashRes, demandsRes] = await Promise.all([
          fetch("/api/shifts/current", { cache: "no-store" }),
          fetch(`/api/payroll?${params.toString()}`),
          fetch("/api/shifts", { cache: "no-store" }),
          fetch(`/api/bonus-penalties?${params.toString()}`),
          fetch("/api/cash", { cache: "no-store" }),
          fetch("/api/demands?limit=6"),
        ]);

        if (cancelled) return;
        setCurrentShift(await tryResponseJson<NonNullable<CurrentShift>>(shiftRes));
        setPayroll(await tryResponseJson<PayrollResponse>(payrollRes));
        const shiftsData = await tryResponseJson<ShiftSummary[]>(shiftsRes);
        setRecentShifts(Array.isArray(shiftsData) ? shiftsData.slice(0, 5) : []);
        const bonusesData = await tryResponseJson<BonusPenalty[]>(bonusesRes);
        setRecentBonuses(Array.isArray(bonusesData) ? bonusesData.slice(0, 5) : []);
        const cashData = await tryResponseJson<{ shift?: CurrentCashShift }>(cashRes);
        setCurrentCashShift(cashData?.shift ?? null);
        const demandData = await tryResponseJson<DemandListResponse>(demandsRes);
        setRecentDemands(Array.isArray(demandData?.rows) ? demandData.rows.slice(0, 6) : []);
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    }

    void loadSummary();
    const handleShiftChanged = () => {
      void loadSummary();
    };
    window.addEventListener(SHIFT_EVENT, handleShiftChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(SHIFT_EVENT, handleShiftChanged);
    };
  }, [monthRange]);

  const payrollEntries = payroll?.byLogin ? Object.entries(payroll.byLogin) : [];
  const personSummary = payroll?.byLogin?.[login] ?? null;
  const totalSalaryCents = payrollEntries.reduce((sum, [, item]) => sum + item.totalCents, 0);
  const totalShiftCount = payrollEntries.reduce((sum, [, item]) => sum + item.shiftsCount, 0);
  const totalBonusPenaltyCents = payrollEntries.reduce(
    (sum, [, item]) => sum + item.bonusPenaltyCents,
    0
  );
  const hasPayrollData = isOwner ? payrollEntries.length > 0 : !!personSummary;
  const visibleSalaryCents = isOwner ? totalSalaryCents : personSummary?.totalCents ?? 0;
  const visibleShiftCount = isOwner ? totalShiftCount : personSummary?.shiftsCount ?? 0;
  const recentRevenueCents = recentDemands.reduce((sum, row) => sum + (row.sum || 0), 0);
  const cashOpen = currentCashShift?.status === "open";
  const cashStartCents =
    typeof currentCashShift?.startBalanceCents === "number"
      ? currentCashShift.startBalanceCents
      : typeof currentCashShift?.startBalance === "number"
        ? currentCashShift.startBalance * 100
        : 0;

  const pageGreeting = sectionsLocked
    ? `Привет, ${userName}.`
    : `${isOwner ? "Добрый день" : "Привет"}, ${userName}.`;

  const shiftRows = recentShifts.slice(0, 4).map((shift) => ({
    label: shift.shiftDate,
    side: `${formatTime(shift.startedAt)} → ${formatTime(shift.endedAt)}`,
    meta: shift.endedAt ? "смена закрыта" : "смена активна",
    tone: shift.endedAt ? ("neutral" as const) : ("success" as const),
  }));

  const bonusRows = recentBonuses.slice(0, 4).map((item) => ({
    label: item.comment || item.type,
    side: typeof item.amountCents === "number" ? formatMoneyCents(item.amountCents) : formatDate(item.date),
    meta: item.date,
    tone: item.type?.toLowerCase().includes("штраф") ? ("warning" as const) : ("success" as const),
  }));

  return (
    <main className="eco-page">
      <div className="eco-page-head">
        <div>
          <div className="eco-page-kicker">Главная</div>
          <h1 className="eco-page-title">
            {pageGreeting} <span className="muted">{sectionsLocked ? "Смена ещё не открыта." : `Сегодня ${todayPhrase()}.`}</span>
          </h1>
        </div>
        <div className="eco-actions">
          <Link
            href={sectionsLocked ? "#shift-control" : "/shipment/new"}
            className="eco-btn eco-btn--primary"
          >
            {sectionsLocked ? <Play aria-hidden className="eco-icon" /> : <Plus aria-hidden className="eco-icon" />}
            {sectionsLocked ? "Открыть смену" : "Новая отгрузка"}
          </Link>
          <Link href="/shipment" className="eco-btn">
            Отгрузки <ChevronRight aria-hidden className="eco-icon" />
          </Link>
        </div>
      </div>

      {needShiftNotice && (
        <div className="mb-4">
          <EcoBadge tone="warning" dot>
            Для администратора и мастера остальные разделы открываются только после начала смены.
          </EcoBadge>
        </div>
      )}

      {sectionsLocked ? (
        <div className="eco-home-main-grid">
          <section id="shift-control" className="eco-dark-start">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
              <EcoStatusDot tone="neutral" />
              <span style={{ color: "#9A9A9A", fontSize: 11, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}>
                Смена ещё не открыта
              </span>
            </div>
            <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.05, maxWidth: 520 }}>
              Открой рабочую смену,
              <br />
              <span style={{ color: "#9A9A9A" }}>чтобы начать день<span style={{ color: "var(--eco-rust)" }}>.</span></span>
            </div>
            <p style={{ color: "#C9C5BD", fontSize: 14, lineHeight: 1.55, marginTop: 24, maxWidth: 560 }}>
              Пока смена закрыта, рабочие операции остаются заблокированными. После открытия смены станут доступны отгрузки,
              касса, приёмка и списание.
            </p>
            <div style={{ marginTop: 32, maxWidth: 320 }}>
              <ShiftButton />
            </div>
          </section>

          <EcoCard padded={false}>
            <div className="eco-card__head">
              <span style={{ fontSize: 14, fontWeight: 600 }}>Доступно без смены</span>
            </div>
            <div className="eco-action-list">
              <Link href="/crm" className="eco-action-link">
                <span className="eco-action-icon"><Search aria-hidden className="eco-icon" /></span>
                <span style={{ flex: 1 }}>
                  <strong style={{ display: "block", fontSize: 13 }}>CRM и клиенты</strong>
                  <small style={{ color: "var(--eco-muted)" }}>просмотр воронки и контактов</small>
                </span>
                <ChevronRight aria-hidden className="eco-icon" />
              </Link>
              <Link href="/records" className="eco-action-link">
                <span className="eco-action-icon"><ChevronRight aria-hidden className="eco-icon" /></span>
                <span style={{ flex: 1 }}>
                  <strong style={{ display: "block", fontSize: 13 }}>Журнал записей</strong>
                  <small style={{ color: "var(--eco-muted)" }}>расписание и онлайн-клиенты</small>
                </span>
                <ChevronRight aria-hidden className="eco-icon" />
              </Link>
            </div>
          </EcoCard>
        </div>
      ) : (
        <div className="eco-home-stack">
          <div className="eco-home-kpi-grid">
            <EcoKpi
              label="Выручка · последние"
              value={summaryLoading ? "Обновляем" : recentDemands.length ? formatMoneyCents(recentRevenueCents) : "Нет данных"}
              sub={recentDemands.length ? `${recentDemands.length} последних отгрузок` : "Источник: /api/demands"}
              tone="rust"
            />
            <EcoKpi
              label="Зарплатный фонд"
              value={summaryLoading ? "Обновляем" : hasPayrollData ? formatMoneyCents(visibleSalaryCents) : "Нет данных"}
              sub={hasPayrollData ? `${payrollEntries.length || 1} сотруд. в расчете` : "Появится после смен"}
            />
            <EcoKpi
              label="Касса сейчас"
              value={cashOpen ? "Открыта" : "Закрыта"}
              sub={cashOpen ? `с ${formatTime(currentCashShift?.openedAt)}` : "нет активной кассовой смены"}
              tone={cashOpen ? "success" : "neutral"}
            />
            <EcoKpi
              label="Зарплата · корректировки"
              value={summaryLoading ? "Обновляем" : hasPayrollData ? formatMoneyCents(totalBonusPenaltyCents) : "Нет данных"}
              sub="бонусы и штрафы за период"
            />
            <EcoKpi
              label="Отгрузок · период"
              value={summaryLoading ? "Обновляем" : formatCount(visibleShiftCount || recentDemands.length)}
              sub={visibleShiftCount ? "смены в payroll" : "последние документы"}
            />
          </div>

          <div className="eco-home-main-grid">
            <EcoCard padded={false}>
              <div className="eco-card__head">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Последние отгрузки</span>
                  <EcoBadge tone="neutral">live data</EcoBadge>
                </div>
                <Link href="/shipment" className="eco-btn eco-btn--ghost eco-btn--sm">
                  Все отгрузки <ChevronRight aria-hidden className="eco-icon" />
                </Link>
              </div>
              <div className="eco-table-wrap" style={{ border: 0, borderRadius: 0 }}>
                <table className="eco-table">
                  <thead>
                    <tr>
                      <th>Время</th>
                      <th>№ отгрузки</th>
                      <th>Клиент / склад</th>
                      <th>Создал</th>
                      <th>Статус</th>
                      <th style={{ textAlign: "right" }}>Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDemands.length > 0 ? (
                      recentDemands.map((row) => (
                        <tr key={row.id}>
                          <td className="muted l-mono">{formatTime(row.moment)}</td>
                          <td>
                            <Link href={`/shipment/${row.id}`} className="l-mono" style={{ color: "var(--eco-ink)", fontWeight: 600 }}>
                              {row.name}
                            </Link>
                          </td>
                          <td>
                            <div style={{ color: "var(--eco-ink)", fontWeight: 500 }}>{row.agentName || "—"}</div>
                            <div style={{ color: "var(--eco-muted)", fontSize: 11, marginTop: 1 }}>{row.storeName || row.organizationName || "—"}</div>
                          </td>
                          <td style={{ color: "var(--eco-muted)" }}>{row.ecoUserName || "—"}</td>
                          <td>
                            <EcoBadge tone={statusTone(row.applicable)} dot>
                              {statusLabel(row.applicable)}
                            </EcoBadge>
                          </td>
                          <td className="l-money" style={{ color: "var(--eco-ink)", fontWeight: 600, textAlign: "right" }}>
                            {formatMoneyCents(row.sum)}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} style={{ color: "var(--eco-muted)", textAlign: "center" }}>
                          Последние отгрузки не загрузились из реального API.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </EcoCard>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <EcoCard padded={false}>
                <div className="eco-card__head">
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Касса смены</span>
                  <EcoBadge tone={cashOpen ? "success" : "neutral"} dot>
                    {cashOpen ? "активна" : "закрыта"}
                  </EcoBadge>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: 20 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div>
                      <div className="eco-page-kicker">Открыто</div>
                      <div className="l-mono" style={{ fontSize: 13, fontWeight: 500, marginTop: 6 }}>{formatTime(currentCashShift?.openedAt)}</div>
                    </div>
                    <div>
                      <div className="eco-page-kicker">Стартовый остаток</div>
                      <div className="l-money" style={{ fontSize: 13, fontWeight: 500, marginTop: 6 }}>{formatMoneyCents(cashStartCents)}</div>
                    </div>
                  </div>
                  <div style={{ height: 1, background: "repeating-linear-gradient(90deg, var(--eco-line-dashed) 0 4px, transparent 4px 8px)" }} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <MiniMetric label="Рабочая смена" value={currentShift ? "активна" : "—"} tone={currentShift ? "success" : undefined} />
                    <MiniMetric label="Период" value={`${monthRange.dateFrom.slice(5)} → ${monthRange.dateTo.slice(5)}`} />
                  </div>
                  <Link href="/cash" className="eco-btn eco-btn--primary" style={{ justifyContent: "space-between" }}>
                    Открыть кассу <ChevronRight aria-hidden className="eco-icon" />
                  </Link>
                </div>
              </EcoCard>

              <EcoCard padded={false}>
                <div className="eco-card__head">
                  <span style={{ fontSize: 14, fontWeight: 600 }}>Быстрые действия</span>
                </div>
                <div className="eco-action-list">
                  {[
                    { href: "/shipment/new", label: "Новая отгрузка", desc: "VIN, подбор, позиции", icon: Plus, accent: true },
                    { href: "/inventory/receipts", label: "Создать приёмку", desc: "товар от поставщика", icon: PackagePlus },
                    { href: "/inventory/products", label: "Найти товар", desc: "локальный склад", icon: Search },
                    { href: "/cash", label: cashOpen ? "Закрыть смену" : "Открыть кассу", desc: "сверка кассы", icon: CircleDollarSign },
                  ].map((action) => {
                    const Icon = action.icon;
                    return (
                      <Link key={action.href} href={action.href} className="eco-action-link">
                        <span className={`eco-action-icon ${action.accent ? "is-accent" : ""}`}>
                          <Icon aria-hidden className="eco-icon" />
                        </span>
                        <span style={{ flex: 1 }}>
                          <strong style={{ display: "block", fontSize: 13 }}>{action.label}</strong>
                          <small style={{ color: "var(--eco-muted)" }}>{action.desc}</small>
                        </span>
                        <ChevronRight aria-hidden className="eco-icon" style={{ color: "var(--eco-faint)" }} />
                      </Link>
                    );
                  })}
                </div>
              </EcoCard>
            </div>
          </div>

          <div className="eco-home-mini-grid">
            <PanelMini title="Смены сотрудников · последние" rows={shiftRows} href="/cabinet/shifts" />
            <PanelMini title="Корректировки · период" rows={bonusRows} href="/salary" />
            <PanelMini
              title="Склад · быстрый контроль"
              href="/inventory/products"
              rows={[
                { label: "Справочник товаров", side: "Склад", meta: "карточки, остатки и фото", tone: "neutral" },
                { label: "Пополнение остатков", side: "Заказ", meta: "дефицит и поставщики", tone: "warning" },
                { label: "Приёмка и списание", side: "Док-ты", meta: "локальная база склада", tone: "success" },
              ]}
            />
          </div>

          <EcoCard id="shift-control" padded={false}>
            <div className="eco-card__head">
              <span style={{ fontSize: 14, fontWeight: 600 }}>Текущая смена</span>
              <EcoBadge tone={hasActiveShift ? "success" : "neutral"} dot>
                {hasActiveShift ? "активна" : "нет активной смены"}
              </EcoBadge>
            </div>
            <div style={{ maxWidth: 420, padding: 20 }}>
              <ShiftButton />
            </div>
          </EcoCard>
        </div>
      )}
    </main>
  );
}
