"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { getCurrentMonthRange, useOwnerUsers } from "../useOwnerUsers";
import PieceworkRulesEditor from "./PieceworkRulesEditor";

type PayrollByLogin = {
  shiftTotalCents: number;
  pieceworkCents: number;
  bonusPenaltyCents: number;
  paidOutCents: number;
  remainingCents: number;
  totalCents: number;
  shiftsCount: number;
};

type Payroll = {
  dateFrom: string;
  dateTo: string;
  byLogin: Record<string, PayrollByLogin>;
  vehicleHistory?: VehicleRecord[];
};

type ShiftRateItem = {
  login: string;
  name: string;
  amountCents: number | null;
};

type VehicleRecord = {
  demandId: string;
  demandName: string;
  date: string;
  agentName: string;
  earningsByLogin: Record<string, number>;
  pieceworkBreakdownByLogin: Record<
    string,
    { category: "work" | "product"; label: string; quantity: number; amountCents: number }[]
  >;
};

function formatMoney(amountCents: number) {
  return `${(amountCents / 100).toFixed(2)} ₽`;
}

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatPieceworkDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;

  const formattedDate = new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    ...(parsed.getFullYear() !== new Date().getFullYear() ? { year: "numeric" as const } : {}),
  }).format(parsed);

  const today = new Date();
  const todayKey = formatLocalDateKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatLocalDateKey(yesterday);

  if (value === todayKey) return `Сегодня, ${formattedDate}`;
  if (value === yesterdayKey) return `Вчера, ${formattedDate}`;

  return formattedDate;
}

function formatRateInput(amountCents: number | null) {
  if (amountCents == null) return "";
  return Number.isInteger(amountCents / 100)
    ? String(amountCents / 100)
    : (amountCents / 100).toFixed(2);
}

export default function AnalyticsBlock({
  role = "owner",
  login = "",
  embedded,
  showPieceworkRules = true,
}: {
  role?: string;
  login?: string;
  embedded?: boolean;
  showPieceworkRules?: boolean;
} = {}) {
  const defaults = getCurrentMonthRange();
  const isOwner = role === "owner";
  const [data, setData] = useState<Payroll | null>(null);
  const [loading, setLoading] = useState(false);
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [userFilter, setUserFilter] = useState("");
  const autoLoadedRef = useRef(false);
  const { users } = useOwnerUsers(isOwner);
  const [rates, setRates] = useState<ShiftRateItem[]>([]);
  const [rateInputs, setRateInputs] = useState<Record<string, string>>({});
  const [savingLogin, setSavingLogin] = useState<string | null>(null);
  const [applyingLogin, setApplyingLogin] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    setErrorMessage(null);
    const params = new URLSearchParams({ dateFrom, dateTo });
    if (isOwner && userFilter) params.set("user", userFilter);
    fetch(`/api/payroll?${params.toString()}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          let errorText = "Не удалось загрузить расчет";
          try {
            const payload = await r.json();
            if (typeof payload?.error === "string" && payload.error.trim()) {
              errorText = payload.error;
            }
          } catch {}
          throw new Error(errorText);
        }
        return r.json();
      })
      .then((payload) => setData(payload))
      .catch((error: unknown) => {
        setData(null);
        setErrorMessage(error instanceof Error ? error.message : "Не удалось загрузить расчет");
      })
      .finally(() => setLoading(false));
  }, [dateFrom, dateTo, isOwner, userFilter]);

  const loadRates = useCallback(() => {
    setErrorMessage(null);
    fetch("/api/shift-rates", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Не удалось загрузить ставки смен");
        return r.json();
      })
      .then((payload) => {
        const nextRates = Array.isArray(payload?.rates)
          ? (payload.rates as ShiftRateItem[])
          : typeof payload?.login === "string"
            ? [
                {
                  login: payload.login,
                  name: payload.login,
                  amountCents:
                    typeof payload?.amountCents === "number" || payload?.amountCents == null
                      ? payload.amountCents
                      : null,
                },
              ]
            : [];
        setRates(nextRates);
        setRateInputs(
          Object.fromEntries(nextRates.map((rate) => [rate.login, formatRateInput(rate.amountCents)]))
        );
      })
      .catch((error: unknown) => {
        setRates([]);
        setErrorMessage((prev) => prev ?? (error instanceof Error ? error.message : "Не удалось загрузить ставки"));
      });
  }, []);

  useEffect(() => {
    if (autoLoadedRef.current || !dateFrom || !dateTo) return;
    autoLoadedRef.current = true;
    const timer = window.setTimeout(() => {
      load();
      if (isOwner || login) loadRates();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dateFrom, dateTo, isOwner, load, loadRates, login]);

  const entries = data?.byLogin
    ? Object.entries(data.byLogin)
        .filter(([userLogin]) => isOwner || userLogin === login)
        .sort(([, a], [, b]) => b.totalCents - a.totalCents)
    : [];
  const userNames = new Map(users.map((user) => [user.login, user.name]));

  async function saveRate(userLogin: string) {
    const rub = parseFloat(rateInputs[userLogin] ?? "");
    if (Number.isNaN(rub) || rub < 0) return;
    setSavingLogin(userLogin);
    setSaveMessage(null);
    try {
      const r = await fetch("/api/shift-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userLogin, amountCents: Math.round(rub * 100) }),
      });
      if (r.ok) {
        setSaveMessage(`Ставка для ${userNames.get(userLogin) ?? userLogin} сохранена`);
        loadRates();
        load();
      }
    } finally {
      setSavingLogin(null);
    }
  }

  async function applyRateToCurrentMonth(userLogin: string) {
    const rub = parseFloat(rateInputs[userLogin] ?? "");
    if (Number.isNaN(rub) || rub < 0) return;
    setApplyingLogin(userLogin);
    setSaveMessage(null);
    try {
      const r = await fetch("/api/shift-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userLogin,
          amountCents: Math.round(rub * 100),
          effectiveFrom: defaults.dateFrom,
          applyToMonth: true,
        }),
      });
      if (r.ok) {
        setSaveMessage(
          `Ставка для ${userNames.get(userLogin) ?? userLogin} применена ко всему текущему месяцу`
        );
        loadRates();
        load();
      }
    } finally {
      setApplyingLogin(null);
    }
  }

  return (
    <>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
        />
        {isOwner && (
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800"
          >
            <option value="">Все сотрудники</option>
            {users.map((user) => (
              <option key={user.login} value={user.login}>
                {user.name}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={load}
          disabled={loading || !dateFrom || !dateTo}
          className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
        >
          {loading ? "…" : "Показать"}
        </button>
      </div>
      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        По умолчанию аналитика открывается за текущий месяц по всем сотрудникам.
      </p>

      {errorMessage && (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      {data && (
        <div className="mt-6 space-y-6">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {isOwner ? "Кто и за что получает" : "Подробный расчет зарплаты"}
                </h3>
                <p className="text-sm text-zinc-500">
                  {isOwner
                    ? "Разбивка по ставкам, сдельной части, бонусам и штрафам за выбранный период."
                    : "Ваши ставки, сдельная часть, бонусы и штрафы за выбранный период."}
                </p>
              </div>
              {saveMessage && <p className="text-sm text-emerald-600">{saveMessage}</p>}
            </div>
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              {entries.map(([userLogin, row]) => {
                const rate = rates.find((item) => item.login === userLogin)?.amountCents ?? null;
                const pieceworkItems =
                  data?.vehicleHistory
                    ?.filter((vehicle) => (vehicle.earningsByLogin[userLogin] ?? 0) > 0)
                    .sort(
                      (a, b) =>
                        (b.earningsByLogin[userLogin] ?? 0) - (a.earningsByLogin[userLogin] ?? 0)
                    ) ?? [];
                const workPieceworkTotal = pieceworkItems.reduce((sum, vehicle) => {
                  const breakdown = vehicle.pieceworkBreakdownByLogin[userLogin] ?? [];
                  return (
                    sum +
                    breakdown
                      .filter((item) => item.category === "work")
                      .reduce((itemSum, item) => itemSum + item.amountCents, 0)
                  );
                }, 0);
                const productPieceworkTotal = pieceworkItems.reduce((sum, vehicle) => {
                  const breakdown = vehicle.pieceworkBreakdownByLogin[userLogin] ?? [];
                  return (
                    sum +
                    breakdown
                      .filter((item) => item.category === "product")
                      .reduce((itemSum, item) => itemSum + item.amountCents, 0)
                  );
                }, 0);
                const pieceworkGroups = Object.values(
                  pieceworkItems.reduce<
                    Record<
                      string,
                      {
                        date: string;
                        totalCents: number;
                        workTotalCents: number;
                        productTotalCents: number;
                        items: VehicleRecord[];
                      }
                    >
                  >((groups, vehicle) => {
                    const key = vehicle.date;
                    const breakdown = vehicle.pieceworkBreakdownByLogin[userLogin] ?? [];
                    const workTotalCents = breakdown
                      .filter((item) => item.category === "work")
                      .reduce((sum, item) => sum + item.amountCents, 0);
                    const productTotalCents = breakdown
                      .filter((item) => item.category === "product")
                      .reduce((sum, item) => sum + item.amountCents, 0);

                    if (!groups[key]) {
                      groups[key] = {
                        date: vehicle.date,
                        totalCents: 0,
                        workTotalCents: 0,
                        productTotalCents: 0,
                        items: [],
                      };
                    }

                    groups[key].totalCents += vehicle.earningsByLogin[userLogin] ?? 0;
                    groups[key].workTotalCents += workTotalCents;
                    groups[key].productTotalCents += productTotalCents;
                    groups[key].items.push(vehicle);

                    return groups;
                  }, {})
                )
                  .map((group) => ({
                    ...group,
                    items: group.items.sort(
                      (a, b) =>
                        (b.earningsByLogin[userLogin] ?? 0) - (a.earningsByLogin[userLogin] ?? 0)
                    ),
                  }))
                  .sort((a, b) => b.date.localeCompare(a.date));
                return (
                  <div
                    key={userLogin}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-700 dark:bg-zinc-900/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                          {userNames.get(userLogin) ?? userLogin}
                        </h4>
                        <p className="text-sm text-zinc-500">@{userLogin}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                            Работы: {formatMoney(workPieceworkTotal)}
                          </span>
                          <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                            Товары: {formatMoney(productPieceworkTotal)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-xs uppercase tracking-wide text-zinc-500">Итого</p>
                        <p className="text-lg font-semibold text-zinc-950 dark:text-zinc-50">
                          {formatMoney(row.totalCents)}
                        </p>
                      </div>
                    </div>

                    <dl className="mt-4 space-y-2 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-zinc-500">Ставка за смены</dt>
                        <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                          {formatMoney(row.shiftTotalCents)}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-zinc-500">Сдельная часть</dt>
                        <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                          {formatMoney(row.pieceworkCents)}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-zinc-500">Бонусы и штрафы</dt>
                        <dd
                          className={`font-medium ${
                            row.bonusPenaltyCents < 0
                              ? "text-red-600"
                              : "text-zinc-900 dark:text-zinc-100"
                          }`}
                        >
                          {formatMoney(row.bonusPenaltyCents)}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-zinc-500">Выплачено по РКО</dt>
                        <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                          {formatMoney(row.paidOutCents)}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-zinc-500">Остаток к выдаче</dt>
                        <dd
                          className={`font-medium ${
                            row.remainingCents < 0
                              ? "text-red-600"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          {formatMoney(row.remainingCents)}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4 border-t border-zinc-200 pt-2 dark:border-zinc-700">
                        <dt className="text-zinc-500">Количество смен</dt>
                        <dd className="font-medium text-zinc-900 dark:text-zinc-100">
                          {row.shiftsCount}
                        </dd>
                      </div>
                    </dl>

                    <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Текущая ставка смены
                      </p>
                      {isOwner ? (
                        <>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={rateInputs[userLogin] ?? ""}
                              onChange={(e) =>
                                setRateInputs((prev) => ({ ...prev, [userLogin]: e.target.value }))
                              }
                              className="w-32 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                              placeholder="₽ за смену"
                            />
                            <button
                              type="button"
                              onClick={() => saveRate(userLogin)}
                              disabled={savingLogin === userLogin || applyingLogin === userLogin}
                              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm text-white hover:bg-amber-600 disabled:opacity-50"
                            >
                              {savingLogin === userLogin ? "…" : "Сохранить ставку"}
                            </button>
                            <button
                              type="button"
                              onClick={() => applyRateToCurrentMonth(userLogin)}
                              disabled={savingLogin === userLogin || applyingLogin === userLogin}
                              className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
                            >
                              {applyingLogin === userLogin ? "…" : "Применить на месяц"}
                            </button>
                            <span className="text-xs text-zinc-500">
                              Сейчас: {rate == null ? "не задана" : formatMoney(rate)}
                            </span>
                          </div>
                          <p className="mt-2 text-xs text-zinc-500">
                            Применяет текущую сумму с {defaults.dateFrom} ко всем рабочим дням месяца.
                          </p>
                        </>
                      ) : (
                        <p className="mt-3 text-sm text-zinc-500">
                          Сейчас: {rate == null ? "не задана" : formatMoney(rate)}. Ставку изменяет
                          владелец.
                        </p>
                      )}
                    </div>

                    <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800">
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        Из чего состоит сдельная часть
                      </p>
                      {pieceworkGroups.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {pieceworkGroups.map((group) => {
                            return (
                              <details
                                key={`${userLogin}-${group.date}`}
                                className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"
                              >
                                <summary className="cursor-pointer list-none">
                                  <div className="flex items-start justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                        {formatPieceworkDate(group.date)}
                                      </p>
                                      <p className="text-xs text-zinc-500">
                                        {group.items.length}{" "}
                                        {group.items.length === 1 ? "заявка" : "заявок"}
                                      </p>
                                      <p className="mt-1 text-xs text-zinc-500">
                                        Работы: {formatMoney(group.workTotalCents)} · Товары:{" "}
                                        {formatMoney(group.productTotalCents)}
                                      </p>
                                    </div>
                                    <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                      {formatMoney(group.totalCents)}
                                    </p>
                                  </div>
                                </summary>

                                <div className="mt-3 space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                                  {group.items.map((vehicle) => {
                                    const breakdown = vehicle.pieceworkBreakdownByLogin[userLogin] ?? [];
                                    const workItems = breakdown.filter((item) => item.category === "work");
                                    const productItems = breakdown.filter((item) => item.category === "product");
                                    const workTotal = workItems.reduce(
                                      (sum, item) => sum + item.amountCents,
                                      0
                                    );
                                    const productTotal = productItems.reduce(
                                      (sum, item) => sum + item.amountCents,
                                      0
                                    );

                                    return (
                                      <details
                                        key={`${userLogin}-${group.date}-${vehicle.demandId}`}
                                        className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700"
                                      >
                                        <summary className="cursor-pointer list-none">
                                          <div className="flex items-start justify-between gap-3">
                                            <div>
                                              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                                {vehicle.demandName}
                                              </p>
                                              <p className="text-xs text-zinc-500">
                                                {vehicle.agentName ? vehicle.agentName : "Без клиента"}
                                              </p>
                                              <p className="mt-1 text-xs text-zinc-500">
                                                Работы: {formatMoney(workTotal)} · Товары:{" "}
                                                {formatMoney(productTotal)}
                                              </p>
                                            </div>
                                            <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                              {formatMoney(vehicle.earningsByLogin[userLogin] ?? 0)}
                                            </p>
                                          </div>
                                        </summary>

                                        <div className="mt-3 space-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
                                          <div>
                                            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                              Работы
                                            </p>
                                            {workItems.length > 0 ? (
                                              <div className="mt-2 space-y-1">
                                                {workItems.map((item, index) => (
                                                  <div
                                                    key={`work-${index}-${item.label}`}
                                                    className="flex items-start justify-between gap-3 text-sm"
                                                  >
                                                    <span className="text-zinc-600 dark:text-zinc-300">
                                                      {item.label} × {item.quantity}
                                                    </span>
                                                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                                      {formatMoney(item.amountCents)}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <p className="mt-1 text-sm text-zinc-500">
                                                Нет начислений по работам.
                                              </p>
                                            )}
                                          </div>

                                          <div>
                                            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                                              Товары
                                            </p>
                                            {productItems.length > 0 ? (
                                              <div className="mt-2 space-y-1">
                                                {productItems.map((item, index) => (
                                                  <div
                                                    key={`product-${index}-${item.label}`}
                                                    className="flex items-start justify-between gap-3 text-sm"
                                                  >
                                                    <span className="text-zinc-600 dark:text-zinc-300">
                                                      {item.label} × {item.quantity}
                                                    </span>
                                                    <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                                      {formatMoney(item.amountCents)}
                                                    </span>
                                                  </div>
                                                ))}
                                              </div>
                                            ) : (
                                              <p className="mt-1 text-sm text-zinc-500">
                                                Нет начислений по товарам.
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      </details>
                                    );
                                  })}
                                </div>
                              </details>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-zinc-500">
                          За выбранный период сдельных начислений нет.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {isOwner && showPieceworkRules && <PieceworkRulesEditor onSaved={load} />}

          {isOwner && (
            <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-700">
                    <th className="px-4 py-3 font-medium text-zinc-500">Сотрудник</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Текущая ставка</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Смен</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Ставки смен</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Сдельная часть</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Бонусы/штрафы</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Выплачено</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">К выдаче</th>
                    <th className="px-4 py-3 font-medium text-zinc-500">Итого</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([userLogin, r]) => {
                    const rate = rates.find((item) => item.login === userLogin)?.amountCents ?? null;
                    return (
                      <tr key={userLogin} className="border-b border-zinc-100 dark:border-zinc-700">
                        <td className="px-4 py-3 font-medium">
                          {userNames.get(userLogin) ?? userLogin}
                        </td>
                        <td className="px-4 py-3">
                          {rate == null ? "—" : formatMoney(rate)}
                        </td>
                        <td className="px-4 py-3">{r.shiftsCount}</td>
                        <td className="px-4 py-3">{formatMoney(r.shiftTotalCents)}</td>
                        <td className="px-4 py-3">{formatMoney(r.pieceworkCents)}</td>
                        <td className="px-4 py-3">{formatMoney(r.bonusPenaltyCents)}</td>
                      <td className="px-4 py-3">{formatMoney(r.paidOutCents)}</td>
                      <td className="px-4 py-3 font-medium">{formatMoney(r.remainingCents)}</td>
                        <td className="px-4 py-3 font-medium">{formatMoney(r.totalCents)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {!embedded && (
        <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">Управление</h2>
          <ul className="mt-2 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
            <li>
              <Link href="/cabinet" className="text-amber-600 hover:underline dark:text-amber-400">
                Личный кабинет
              </Link>{" "}
              — вернуться к сводке по выплатам
            </li>
            <li>
              <Link
                href="/cabinet/penalties"
                className="text-amber-600 hover:underline dark:text-amber-400"
              >
                Бонусы и штрафы
              </Link>{" "}
              — {isOwner ? "добавить или удалить корректировку" : "посмотреть свои корректировки"}
            </li>
          </ul>
        </div>
      )}

      {!embedded && (
        <p className="mt-6">
          <Link href="/cabinet" className="text-sm text-amber-600 hover:underline dark:text-amber-400">
            ← В личный кабинет
          </Link>
        </p>
      )}
    </>
  );
}
