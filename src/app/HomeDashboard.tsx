"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ShiftButton from "@/components/ShiftButton";
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
};

type SummaryCardProps = {
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "accent" | "success";
};

const SHIFT_EVENT = "eco-shift-changed";

function SummaryCard({ label, value, hint, tone = "default" }: SummaryCardProps) {
  const toneClass =
    tone === "accent"
      ? "border-amber-200 bg-amber-50/80 dark:border-amber-900/60 dark:bg-amber-950/30"
      : tone === "success"
        ? "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/60 dark:bg-emerald-950/30"
        : "border-white/60 bg-white/75 dark:border-zinc-800 dark:bg-zinc-900/70";

  return (
    <div className={`rounded-2xl border p-4 shadow-sm backdrop-blur ${toneClass}`}>
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-3 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{value}</p>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{hint}</p>
    </div>
  );
}

function formatMoney(amountCents: number) {
  return `${(amountCents / 100).toFixed(2)} ₽`;
}

function formatRole(role: string) {
  if (role === "owner") return "Владелец";
  if (role === "admin") return "Администратор";
  return "Мастер";
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
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
        const [shiftRes, payrollRes, shiftsRes, bonusesRes, cashRes] = await Promise.all([
          fetch("/api/shifts/current", { cache: "no-store" }),
          fetch(`/api/payroll?${params.toString()}`),
          fetch("/api/shifts", { cache: "no-store" }),
          fetch(`/api/bonus-penalties?${params.toString()}`),
          fetch("/api/cash", { cache: "no-store" }),
        ]);

        if (cancelled) return;
        const shiftData = await tryResponseJson<NonNullable<CurrentShift>>(shiftRes);
        setCurrentShift(shiftData);
        setPayroll(await tryResponseJson<PayrollResponse>(payrollRes));
        const shiftsData = await tryResponseJson<ShiftSummary[]>(shiftsRes);
        setRecentShifts(Array.isArray(shiftsData) ? shiftsData.slice(0, 5) : []);
        const bonusesData = await tryResponseJson<BonusPenalty[]>(bonusesRes);
        setRecentBonuses(Array.isArray(bonusesData) ? bonusesData.slice(0, 5) : []);
        const cashData = await tryResponseJson<{ shift?: CurrentCashShift }>(cashRes);
        setCurrentCashShift(cashData?.shift ?? null);
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    }

    loadSummary();
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
  const latestShift = recentShifts[0] ?? null;
  const latestBonus = recentBonuses[0] ?? null;
  const personShiftCount = personSummary?.shiftsCount ?? 0;
  const hasPayrollData = isOwner ? payrollEntries.length > 0 : !!personSummary;
  const primaryActionHref = sectionsLocked ? "#shift-control" : "/shipment/new";
  const primaryActionLabel = sectionsLocked ? "Перейти к смене" : "Создать отгрузку";
  const heroStatus = summaryLoading
    ? "Обновляем данные"
    : currentShift
      ? `Смена активна с ${formatTime(currentShift.startedAt)}`
      : currentCashShift?.status === "open"
        ? `Кассовая смена активна с ${formatTime(currentCashShift.openedAt)}`
        : "Смена не начата";
  const heroHint = summaryLoading
    ? "Собираем текущие показатели по сотруднику и сменам."
    : hasActiveShift
      ? currentShift
        ? `Рабочий день ${currentShift.shiftDate}. Основные разделы уже доступны.`
        : "Кассовая смена открыта. Основные разделы уже доступны."
      : needsActiveShift
        ? "Начните смену, чтобы открыть рабочие разделы и продолжить работу."
        : "Можно сразу переходить к отгрузкам, кассе и другим операциям.";
  const salaryValue = summaryLoading
    ? "Обновляем"
    : hasPayrollData
      ? formatMoney(isOwner ? totalSalaryCents : personSummary?.totalCents ?? 0)
      : "Нет данных";
  const salaryHint = summaryLoading
    ? "Показатели за текущий месяц."
    : hasPayrollData
      ? isOwner
        ? `${payrollEntries.length} сотруд. в расчете`
        : `${personShiftCount} смен за период`
      : isOwner
        ? "Расчет по сотрудникам пока пуст."
        : "Начисления появятся после первых смен.";
  const shiftsValue = summaryLoading
    ? "Обновляем"
    : `${isOwner ? totalShiftCount : personShiftCount} смен`;
  const shiftsHint = latestShift
    ? `${latestShift.shiftDate} · ${formatTime(latestShift.startedAt)}-${formatTime(latestShift.endedAt)}`
    : "Нет завершенных смен за текущий период";
  const bonusValue = summaryLoading
    ? "Обновляем"
    : hasPayrollData
      ? formatMoney(isOwner ? totalBonusPenaltyCents : personSummary?.bonusPenaltyCents ?? 0)
      : "Нет данных";
  const bonusHint = latestBonus
    ? `Последняя запись · ${latestBonus.date}`
    : "Корректировок за текущий месяц пока нет";

  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <section className="overflow-hidden rounded-[2rem] border border-amber-200/60 bg-gradient-to-br from-amber-50 via-white to-zinc-50 p-5 shadow-sm dark:border-amber-900/40 dark:from-zinc-900 dark:via-zinc-950 dark:to-zinc-900 sm:p-6">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                {formatRole(role)}
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
                {userName}, что происходит сейчас
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {heroHint}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {sectionsLocked ? (
                <a
                  href={primaryActionHref}
                  className="rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
                >
                  {primaryActionLabel}
                </a>
              ) : (
                <Link
                  href={primaryActionHref}
                  className="rounded-full bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
                >
                  {primaryActionLabel}
                </Link>
              )}
              <Link
                href="/shipment"
                className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                  sectionsLocked
                    ? "pointer-events-none border-zinc-200 bg-zinc-100 text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-600"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
                }`}
              >
                Отгрузки
              </Link>
            </div>
          </div>

          {needShiftNotice && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              Для администратора и мастера остальные разделы открываются только после начала смены.
            </div>
          )}

          <div className="rounded-3xl border border-white/60 bg-white/75 p-5 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
                  Статус дня
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
                  {heroStatus}
                </h2>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{heroHint}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                    hasActiveShift
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  }`}
                >
                  {hasActiveShift ? "Активная смена" : "Нет активной смены"}
                </span>
                <span className="inline-flex rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                  Период: {monthRange.dateFrom} - {monthRange.dateTo}
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <SummaryCard
              label={isOwner ? "ФОТ за месяц" : "Начислено за месяц"}
              value={salaryValue}
              hint={salaryHint}
              tone="accent"
            />
            <SummaryCard
              label={isOwner ? "Смены за месяц" : "Мои смены"}
              value={shiftsValue}
              hint={shiftsHint}
              tone={currentShift ? "success" : "default"}
            />
            <SummaryCard
              label="Бонусы и штрафы"
              value={bonusValue}
              hint={bonusHint}
            />
          </div>
        </div>
      </section>

      <section id="shift-control">
        <div className="rounded-3xl border border-zinc-200 bg-white/95 p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/90 sm:p-6">
          <div className="mb-5">
            <h2 className="text-xl font-semibold text-zinc-950 dark:text-zinc-50">
              Текущая смена
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {needsActiveShift
                ? "Без активной смены рабочие разделы останутся заблокированными. Начните работу отсюда."
                : "Состояние смены обновляется здесь и синхронизируется с остальными рабочими разделами."}
            </p>
          </div>
          <div className="max-w-md">
            <ShiftButton />
          </div>
          {!summaryLoading && !latestShift && !currentShift && (
            <div className="mt-4 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300">
              История смен пока пустая. После первой смены здесь появится актуальный статус и
              последние записи.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
