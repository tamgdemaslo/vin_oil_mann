"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import MoneyInput from "@/components/MoneyInput";
import { EcoBadge, EcoKpi } from "@/components/platform/EcoUI";

type User = { login: string; name: string; role?: "owner" | "admin" | "master" } | null;

type CashShiftStatus = "open" | "closed";

type CashShift = {
  id: string;
  serviceDate: string;
  timezone: string;
  status: CashShiftStatus;
  openedAt: string;
  openedBy: { login: string; name: string; role: "owner" | "admin" | "master" };
  openingCash: number;
  closedAt?: string;
  closedBy?: { login: string; name: string; role: "owner" | "admin" | "master" };
  cashOrdersTotal?: number;
  cardOrdersTotal?: number;
  withdrawalsTotal?: number;
  cashExpensesTotal?: number;
  expectedCash?: number;
  actualCash?: number;
  discrepancy?: number;
  discrepancyComment?: string;
};

type CashExpensePaymentType = "cash" | "card";

type CashOperation =
  | {
      id: string;
      type: "withdrawal";
      shiftId: string;
      createdAt: string;
      createdBy: { login: string; name: string; role: "owner" | "admin" | "master" };
      amount: number;
      comment?: string;
      reason: string;
    }
  | {
      id: string;
      type: "expense";
      shiftId: string;
      createdAt: string;
      createdBy: { login: string; name: string; role: "owner" | "admin" | "master" };
      amount: number;
      comment?: string;
      article: string;
      counterpartyName?: string;
      counterpartyMetaHref?: string;
      expenseItemName?: string;
      expenseItemMetaHref?: string;
      paymentType: CashExpensePaymentType;
      attachmentUrl?: string;
      moyskladCashoutHref?: string;
    };

type ReferenceOption = {
  id: string;
  name: string;
  meta: { href: string; type: string; mediaType: string };
};

type CashoutRecord = {
  id: string;
  name: string;
  moment: string;
  sum: number;
  applicable: boolean;
  paymentPurpose: string;
  description: string;
  agentName: string;
  expenseItemName: string;
  organizationName: string;
  meta: { href: string; type: string; mediaType: string };
};

type FlowSectionProps = {
  id?: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
  tone?: "default" | "danger";
};

const SHIFT_EVENT = "eco-shift-changed";

function notifyShiftChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SHIFT_EVENT));
  }
}

function FlowSection({
  id,
  eyebrow,
  title,
  description,
  children,
  tone = "default",
}: FlowSectionProps) {
  const toneClass = tone === "danger" ? "border-[var(--eco-danger)] bg-[var(--eco-danger-tint)]" : "";

  return (
    <section id={id} className={`eco-card eco-card--padded mb-4 scroll-mt-28 ${toneClass}`}>
      <div className="mb-5">
        <p className="eco-page-kicker">{eyebrow}</p>
        <h2 className="eco-page-title">{title}</h2>
        <p className="eco-page-subtitle">{description}</p>
      </div>
      {children}
    </section>
  );
}

function getServiceDateForTimezone(timezone?: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function safeJson<T = unknown>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function errorFromJson(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function money(value: number) {
  return `${value.toLocaleString("ru-RU", {
    maximumFractionDigits: 0,
  })} ₽`;
}

function shortTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export default function CashPage() {
  const router = useRouter();
  const [user, setUser] = useState<User>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [shift, setShift] = useState<CashShift | null>(null);
  const [operations, setOperations] = useState<CashOperation[]>([]);
  const [historyShifts, setHistoryShifts] = useState<CashShift[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [openingCashInput, setOpeningCashInput] = useState("");

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  const [withdrawComment, setWithdrawComment] = useState("");

  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => getServiceDateForTimezone());
  const [expenseArticle, setExpenseArticle] = useState("");
  const [expensePaymentType, setExpensePaymentType] =
    useState<CashExpensePaymentType>("cash");
  const [expenseComment, setExpenseComment] = useState("");
  const [expenseAttachmentUrl, setExpenseAttachmentUrl] = useState("");
  const [expenseItems, setExpenseItems] = useState<ReferenceOption[]>([]);
  const [selectedExpenseItemId, setSelectedExpenseItemId] = useState("");
  const [expenseCounterpartySearch, setExpenseCounterpartySearch] = useState("");
  const [expenseCounterpartyOptions, setExpenseCounterpartyOptions] = useState<ReferenceOption[]>([]);
  const [selectedExpenseCounterparty, setSelectedExpenseCounterparty] =
    useState<ReferenceOption | null>(null);
  const [expenseRefsLoading, setExpenseRefsLoading] = useState(false);
  const [expenseRefsError, setExpenseRefsError] = useState<string | null>(null);
  const [counterpartyLoading, setCounterpartyLoading] = useState(false);

  const [cashouts, setCashouts] = useState<CashoutRecord[]>([]);
  const [cashoutsTotal, setCashoutsTotal] = useState(0);
  const [cashoutsOffset, setCashoutsOffset] = useState(0);
  const [cashoutSearch, setCashoutSearch] = useState("");
  const [cashoutsLoading, setCashoutsLoading] = useState(false);
  const [cashoutsError, setCashoutsError] = useState<string | null>(null);

  const cashoutsLimit = 50;

  const [closeCashOrders, setCloseCashOrders] = useState("");
  const [closeCardOrders, setCloseCardOrders] = useState("");
  const [closeActualCash, setCloseActualCash] = useState("");
  const [closeComment, setCloseComment] = useState("");
  const [ordersTotalsHint, setOrdersTotalsHint] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [shiftOperationsCache, setShiftOperationsCache] = useState<
    Record<string, CashOperation[]>
  >({});
  const [loadingShiftId, setLoadingShiftId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session");
        const data = await res.json();
        if (cancelled) return;
        if (!data?.user) {
          router.push("/login?from=/cash");
          return;
        }
        setUser(data.user);
      } finally {
        if (!cancelled) setCheckingAuth(false);
      }
    }
    loadSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const hasCashAccess = useMemo(
    () => !!user && (user.role === "owner" || user.role === "admin"),
    [user]
  );

  const selectedExpenseItem = useMemo(
    () => expenseItems.find((item) => item.id === selectedExpenseItemId) ?? null,
    [expenseItems, selectedExpenseItemId]
  );

  const loadCounterparties = useCallback(async (search = "") => {
    setCounterpartyLoading(true);
    setExpenseRefsError(null);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/moysklad/counterparties?${params.toString()}`, {
        cache: "no-store",
      });
      const data = await safeJson<{ counterparties?: ReferenceOption[]; error?: string }>(res);
      if (res.ok) {
        setExpenseCounterpartyOptions(Array.isArray(data?.counterparties) ? data.counterparties : []);
      } else {
        setExpenseRefsError(errorFromJson(data, "Ошибка загрузки контрагентов"));
      }
    } catch (e) {
      setExpenseRefsError(e instanceof Error ? e.message : "Ошибка загрузки контрагентов");
    } finally {
      setCounterpartyLoading(false);
    }
  }, []);

  const loadCashouts = useCallback(async () => {
    if (!hasCashAccess) return;
    setCashoutsLoading(true);
    setCashoutsError(null);
    try {
      const params = new URLSearchParams({
        limit: String(cashoutsLimit),
        offset: String(cashoutsOffset),
      });
      if (cashoutSearch.trim()) params.set("search", cashoutSearch.trim());
      const res = await fetch(`/api/moysklad/cashouts?${params.toString()}`, { cache: "no-store" });
      const data = await safeJson<{
        cashouts?: CashoutRecord[];
        meta?: { size?: number };
        error?: string;
      }>(res);
      if (res.ok) {
        setCashouts(Array.isArray(data?.cashouts) ? data.cashouts : []);
        setCashoutsTotal(typeof data?.meta?.size === "number" ? data.meta.size : 0);
      } else {
        setCashoutsError(errorFromJson(data, "Ошибка загрузки расходных ордеров"));
      }
    } catch (e) {
      setCashoutsError(e instanceof Error ? e.message : "Ошибка загрузки расходных ордеров");
    } finally {
      setCashoutsLoading(false);
    }
  }, [cashoutSearch, cashoutsLimit, cashoutsOffset, hasCashAccess]);

  useEffect(() => {
    if (!hasCashAccess || checkingAuth) return;
    let cancelled = false;
    async function loadCashState() {
      setLoading(true);
      setError(null);
      try {
        const [currentResult, historyResult] = await Promise.allSettled([
          fetch("/api/cash", { cache: "no-store" }),
          fetch("/api/cash?mode=history", { cache: "no-store" }),
        ]);
        if (cancelled) return;

        if (currentResult.status === "fulfilled") {
          const currentRes = currentResult.value;
          const currentJson = await safeJson<{
            shift?: CashShift | null;
            operations?: CashOperation[];
            error?: string;
          }>(currentRes);
          if (cancelled) return;
          if (!currentRes.ok) {
            setError(errorFromJson(currentJson, "Ошибка загрузки кассы"));
          } else {
            setShift(currentJson?.shift ?? null);
            if (currentJson?.shift?.timezone) {
              setExpenseDate(getServiceDateForTimezone(currentJson.shift.timezone));
            }
            setOperations(Array.isArray(currentJson?.operations) ? currentJson.operations : []);
          }
        } else {
          setError(
            currentResult.reason instanceof Error
              ? currentResult.reason.message
              : "Ошибка загрузки кассы"
          );
        }

        if (historyResult.status === "fulfilled") {
          const historyRes = historyResult.value;
          const historyJson = await safeJson<{ shifts?: CashShift[] }>(historyRes);
          if (!cancelled && historyRes.ok) {
            setHistoryShifts(Array.isArray(historyJson?.shifts) ? historyJson.shifts : []);
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Ошибка загрузки кассы");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    async function loadExpenseRefs() {
      setExpenseRefsLoading(true);
      setExpenseRefsError(null);
      try {
        const [expenseItemsResult, counterpartiesResult] = await Promise.allSettled([
          fetch("/api/moysklad/expense-items?limit=1000", { cache: "no-store" }),
          fetch("/api/moysklad/counterparties?limit=20", { cache: "no-store" }),
        ]);
        if (cancelled) return;

        if (expenseItemsResult.status === "fulfilled") {
          const expenseItemsRes = expenseItemsResult.value;
          const expenseItemsJson = await safeJson<{ expenseItems?: ReferenceOption[]; error?: string }>(
            expenseItemsRes
          );
          if (cancelled) return;
          if (expenseItemsRes.ok) {
            setExpenseItems(
              Array.isArray(expenseItemsJson?.expenseItems) ? expenseItemsJson.expenseItems : []
            );
          } else {
            setExpenseRefsError(errorFromJson(expenseItemsJson, "Ошибка загрузки статей расхода"));
          }
        } else {
          setExpenseRefsError(
            expenseItemsResult.reason instanceof Error
              ? expenseItemsResult.reason.message
              : "Ошибка загрузки статей расхода"
          );
        }

        if (counterpartiesResult.status === "fulfilled") {
          const counterpartiesRes = counterpartiesResult.value;
          const counterpartiesJson = await safeJson<{
            counterparties?: ReferenceOption[];
            error?: string;
          }>(counterpartiesRes);
          if (cancelled) return;
          if (counterpartiesRes.ok) {
            setExpenseCounterpartyOptions(
              Array.isArray(counterpartiesJson?.counterparties) ? counterpartiesJson.counterparties : []
            );
          } else {
            setExpenseRefsError(errorFromJson(counterpartiesJson, "Ошибка загрузки контрагентов"));
          }
        } else {
          setExpenseRefsError(
            counterpartiesResult.reason instanceof Error
              ? counterpartiesResult.reason.message
              : "Ошибка загрузки контрагентов"
          );
        }
      } catch (e) {
        if (!cancelled) {
          setExpenseRefsError(e instanceof Error ? e.message : "Ошибка загрузки справочников МойСклад");
        }
      } finally {
        if (!cancelled) {
          setExpenseRefsLoading(false);
        }
      }
    }

    void loadCashState();
    void loadExpenseRefs();
    return () => {
      cancelled = true;
    };
  }, [checkingAuth, hasCashAccess]);

  useEffect(() => {
    if (!hasCashAccess || checkingAuth) return;
    const timer = window.setTimeout(() => {
      void loadCashouts();
    }, 150);
    return () => window.clearTimeout(timer);
  }, [cashoutSearch, cashoutsOffset, checkingAuth, hasCashAccess, loadCashouts]);

  useEffect(() => {
    if (!hasCashAccess || checkingAuth) return;
    if (!expenseCounterpartySearch.trim()) return;
    const timer = window.setTimeout(() => {
      void loadCounterparties(expenseCounterpartySearch);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [checkingAuth, expenseCounterpartySearch, hasCashAccess, loadCounterparties]);

  const totals = useMemo(() => {
    const withdrawals = operations
      .filter((op) => op.type === "withdrawal")
      .reduce((sum, op) => sum + (op.amount || 0), 0);
    const cashExpenses = operations
      .filter((op) => op.type === "expense" && op.paymentType === "cash")
      .reduce((sum, op) => sum + (op.amount || 0), 0);
    const opening = shift?.openingCash ?? 0;
    const cashOrders = Number(closeCashOrders.replace(",", ".")) || 0;
    const expected = opening + cashOrders - withdrawals - cashExpenses;
    const actual = Number(closeActualCash.replace(",", ".")) || 0;
    const discrepancy = Math.round((actual - expected) * 100) / 100;
    return {
      withdrawals,
      cashExpenses,
      expectedCash: expected,
      discrepancy,
    };
  }, [operations, shift, closeCashOrders, closeActualCash]);

  // Наличные в кассе на конец последней закрытой смены (актуально с учётом прошлых дней)
  const lastClosedShift = useMemo(() => {
    const closed = historyShifts.filter((s) => s.status === "closed");
    if (closed.length === 0) return null;
    return closed.sort((a, b) =>
      (b.closedAt ?? "").localeCompare(a.closedAt ?? "")
    )[0];
  }, [historyShifts]);
  const cashInRegister = lastClosedShift?.actualCash ?? 0;

  // Несовпадение стартового остатка с фактом прошлой смены (сравнение с округлением до копеек)
  const openingMismatch = (opening: number, expected: number) =>
    Number.isFinite(opening) &&
    Number.isFinite(expected) &&
    Math.round(opening * 100) !== Math.round(expected * 100);

  const currentShiftOpeningMismatch =
    shift &&
    lastClosedShift != null &&
    openingMismatch(shift.openingCash, lastClosedShift.actualCash ?? 0);

  async function handleOpenShift() {
    setError(null);
    const opening = Number(openingCashInput.replace(",", ".")) || 0;
    if (opening < 0) {
      setError("Стартовый остаток не может быть отрицательным");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "openShift", openingCash: opening }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Ошибка открытия смены");
        return;
      }
      setShift(data.shift ?? null);
      setOperations(data.operations ?? []);
      setOpeningCashInput("");
      notifyShiftChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети при открытии смены");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddWithdrawal() {
    if (!shift) return;
    setError(null);
    const amount = Number(withdrawAmount.replace(",", ".")) || 0;
    if (amount <= 0) {
      setError("Сумма изъятия должна быть больше нуля");
      return;
    }
    if (!withdrawReason.trim()) {
      setError("Укажите причину изъятия");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addWithdrawal",
          shiftId: shift.id,
          amount,
          reason: withdrawReason.trim(),
          comment: withdrawComment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Ошибка изъятия наличных");
        return;
      }
      if (data.operation) {
        setOperations((prev) => [...prev, data.operation]);
      }
      setWithdrawAmount("");
      setWithdrawReason("");
      setWithdrawComment("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети при изъятии");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddExpense() {
    if (!shift) return;
    setError(null);
    const amount = Number(expenseAmount.replace(",", ".")) || 0;
    if (amount <= 0) {
      setError("Сумма расхода должна быть больше нуля");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      setError("Укажите дату расходного ордера");
      return;
    }
    if (!selectedExpenseItem) {
      setError("Выберите статью расхода из списка");
      return;
    }
    if (!selectedExpenseCounterparty) {
      setError("Выберите контрагента");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addExpense",
          shiftId: shift.id,
          amount,
          expenseDate,
          article: expenseArticle.trim() || selectedExpenseItem.name,
          counterpartyName: selectedExpenseCounterparty.name,
          counterpartyMetaHref: selectedExpenseCounterparty.meta.href,
          expenseItemName: selectedExpenseItem.name,
          expenseItemMetaHref: selectedExpenseItem.meta.href,
          paymentType: expensePaymentType,
          comment: expenseComment.trim() || undefined,
          attachmentUrl: expenseAttachmentUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Ошибка создания расходного ордера");
        return;
      }
      if (data.operation) {
        setOperations((prev) => [...prev, data.operation]);
      }
      setExpenseAmount("");
      setExpenseDate(getServiceDateForTimezone(shift.timezone));
      setExpenseArticle("");
      setExpenseComment("");
      setExpenseAttachmentUrl("");
      setExpensePaymentType("cash");
      setSelectedExpenseItemId("");
      setSelectedExpenseCounterparty(null);
      setExpenseCounterpartySearch("");
      void loadCashouts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети при создании расхода");
    } finally {
      setLoading(false);
    }
  }

  async function handleCloseShift() {
    if (!shift) return;
    setError(null);
    setCloseError(null);
    const cashOrders = Number(closeCashOrders.replace(",", ".")) || 0;
    const cardOrders = Number(closeCardOrders.replace(",", ".")) || 0;
    const actualCash = Number(closeActualCash.replace(",", ".")) || 0;
    const discrepancy = totals.discrepancy;
    if (!closeActualCash.trim()) {
      setCloseError("Введите фактические наличные в кассе.");
      return;
    }
    if (discrepancy !== 0 && !closeComment.trim()) {
      setCloseError(
        `Есть расхождение ${discrepancy.toLocaleString("ru-RU", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} ₽. Укажите комментарий, чтобы закрыть смену.`
      );
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "closeShift",
          shiftId: shift.id,
          actualCash,
          cashOrdersTotal: cashOrders,
          cardOrdersTotal: cardOrders,
          comment: closeComment.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCloseError(data.error ?? "Ошибка закрытия смены");
        return;
      }
      setShift(data.shift ?? null);
      setOperations(data.operations ?? []);
      notifyShiftChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети при закрытии смены");
    } finally {
      setLoading(false);
    }
  }

  async function handleFillFromSystems() {
    if (!shift) return;
    setError(null);
    setCloseError(null);
    setOrdersTotalsHint(null);
    setLoading(true);
    const ordersDate = getServiceDateForTimezone(shift.timezone);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25_000);
    try {
      const res = await fetch(
        `/api/cash/orders-totals?date=${encodeURIComponent(ordersDate)}`,
        { method: "GET", signal: controller.signal }
      );
      clearTimeout(timeoutId);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (data && typeof data.error === "string" ? data.error : null) ??
            `Ошибка ${res.status}. Не удалось получить данные из AQSI.`
        );
        return;
      }
      const cash = typeof data.cashTotal === "number" ? data.cashTotal : 0;
      const card = typeof data.cardTotal === "number" ? data.cardTotal : 0;
      // Храним без пробелов, чтобы расчёты закрытия смены парсились одинаково.
      setCloseCashOrders(cash.toFixed(2));
      setCloseCardOrders(card.toFixed(2));
      const staleShiftHint =
        shift.serviceDate !== ordersDate
          ? `Открытая смена заведена на ${shift.serviceDate}, суммы подтянуты из AQSI за сегодня: ${ordersDate}.`
          : null;
      if (data.hint || staleShiftHint) {
        setOrdersTotalsHint([staleShiftHint, data.hint].filter(Boolean).join(" "));
      } else if (cash === 0 && card === 0) {
        setOrdersTotalsHint(`Суммы 0 за ${ordersDate}. Проверьте дату и настройки AQSI.`);
      }
    } catch (e) {
      clearTimeout(timeoutId);
      if (e instanceof Error && e.name === "AbortError") {
        setError("Таймаут запроса к AQSI (25 сек). Проверьте сеть и доступность api.aqsi.ru.");
      } else {
        setError(
          e instanceof Error ? e.message : "Ошибка запроса к /api/cash/orders-totals"
        );
      }
    } finally {
      setLoading(false);
    }
  }

  if (checkingAuth) {
    return (
      <div className="eco-page">
        <p className="text-sm text-[var(--eco-muted)]">Проверка доступа...</p>
      </div>
    );
  }

  if (!hasCashAccess) {
    return (
      <div className="eco-page">
        <div className="eco-page-head">
          <div>
            <div className="eco-page-kicker">Финансы</div>
            <h1 className="eco-page-title">Касса</h1>
            <p className="eco-page-subtitle">Доступ в раздел «Касса» есть только у владельца и администратора.</p>
          </div>
        </div>
      </div>
    );
  }

  const isOpen = shift?.status === "open";
  const cashView = !shift ? "opening" : isOpen ? "active" : "closing";
  const openingValue = shift?.openingCash ?? cashInRegister;
  const cashExpenseCount = operations.filter((op) => op.type === "expense" && op.paymentType === "cash").length;
  const withdrawalCount = operations.filter((op) => op.type === "withdrawal").length;
  const expectedCashValue = shift?.status === "closed" ? shift.expectedCash ?? 0 : totals.expectedCash;

  return (
    <main className="eco-page">
      <div className="eco-page-head">
        <div>
          <div className="eco-page-kicker">
            <span>Главная</span>
            <span className="mx-2 text-[var(--eco-faint)]">/</span>
            <span>Финансы</span>
            <span className="mx-2 text-[var(--eco-faint)]">/</span>
            <span>Касса</span>
          </div>
          <div className="flex items-center gap-3">
            <h1 className="eco-page-title">Касса</h1>
            <EcoBadge tone={isOpen ? "success" : !shift ? "neutral" : "warning"} dot>
              {isOpen ? "Кассовая смена активна" : !shift ? "Касса закрыта" : "Смена закрыта"}
            </EcoBadge>
          </div>
        </div>
        <div className="eco-seg">
          <span className={`eco-seg-btn ${cashView === "opening" ? "is-active" : ""}`}>Открытие</span>
          <span className={`eco-seg-btn ${cashView === "active" ? "is-active" : ""}`}>Активная смена</span>
          <span className={`eco-seg-btn ${cashView === "closing" ? "is-active" : ""}`}>Закрытие</span>
        </div>
      </div>

      {error && (
        <div className="eco-card eco-card--padded mb-4 text-sm text-[var(--eco-danger)]">
          {error}
        </div>
      )}

      {lastClosedShift != null && (
        <div className="eco-card eco-card--padded mb-4 text-sm">
          <span className="text-[var(--eco-muted)]">Денег в кассе: </span>
          <span className="font-semibold text-[var(--eco-ink)]">
            {cashInRegister.toLocaleString("ru-RU", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            ₽
          </span>
          <span className="ml-1 text-[var(--eco-muted)]">
            (на конец смены {lastClosedShift.serviceDate})
          </span>
        </div>
      )}

      <div className="eco-home-kpi-grid mb-4">
        <EcoKpi
          label="Открыто"
          value={shift ? shortTime(shift.openedAt) : "—"}
          sub={shift ? `${shift.openedBy.name} · ${shift.serviceDate}` : "смена не открыта"}
        />
        <EcoKpi label="Стартовый остаток" value={money(openingValue)} sub="наличные в кассе" />
        <EcoKpi
          label="Расходы наличными"
          value={`− ${money(totals.cashExpenses)}`}
          sub={`${cashExpenseCount} операций`}
          tone={totals.cashExpenses > 0 ? "warning" : "neutral"}
        />
        <EcoKpi
          label="Изъятия"
          value={`− ${money(totals.withdrawals)}`}
          sub={`${withdrawalCount} операций`}
          tone={totals.withdrawals > 0 ? "warning" : "neutral"}
        />
        <EcoKpi
          label="Ожидаемый остаток"
          value={money(expectedCashValue)}
          sub="расчёт по текущим данным"
          tone="rust"
        />
      </div>

      {!shift && (
        <FlowSection
          id="cash-open"
          eyebrow="Шаг 1"
          title="Открытие смены"
          description="Сначала зафиксируйте стартовый остаток наличных. После этого откроются операции по кассе."
        >
        <div className="rounded-xl border border-zinc-200 bg-white p-5 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            Открытие смены
          </h2>
          <p className="mb-3 text-zinc-600 dark:text-zinc-400">
            Введите стартовый остаток наличных в кассе на начало дня.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-zinc-500">
                Стартовый остаток наличных, ₽
              </label>
              <MoneyInput
                value={openingCashInput}
                onValueChange={(value, draft) => setOpeningCashInput(draft ? String(value) : "")}
                className="mt-0.5 w-40 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-right dark:border-zinc-600 dark:bg-zinc-900"
              />
            </div>
            {lastClosedShift != null && (
              <button
                type="button"
                onClick={() => setOpeningCashInput(cashInRegister.toFixed(2))}
                className="rounded border border-zinc-300 px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Подставить с прошлой смены ({cashInRegister.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽)
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenShift}
              disabled={loading}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-700"
            >
              {loading ? "Открытие…" : "Открыть смену"}
            </button>
          </div>
        </div>
        </FlowSection>
      )}

      {shift && (
        <>
          <FlowSection
            id="cash-state"
            eyebrow="Состояние"
            title="Состояние смены"
            description="Сначала проверьте параметры текущей смены и сводку по наличным."
          >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
              <h2 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                Текущая смена
              </h2>
              <dl className="space-y-1">
                <div className="flex justify-between">
                  <dt className="text-xs text-zinc-500">Дата сервиса</dt>
                  <dd className="text-xs text-zinc-800 dark:text-zinc-100">
                    {shift.serviceDate}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-xs text-zinc-500">Открыта</dt>
                  <dd className="text-xs text-zinc-800 dark:text-zinc-100">
                    {shift.openedAt}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-xs text-zinc-500">Кто открыл</dt>
                  <dd className="text-xs text-zinc-800 dark:text-zinc-100">
                    {shift.openedBy.name} ({shift.openedBy.role})
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-xs text-zinc-500">Стартовый остаток</dt>
                  <dd className="text-xs font-medium text-zinc-900 dark:text-zinc-50">
                    {shift.openingCash.toLocaleString("ru-RU", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    ₽
                    {currentShiftOpeningMismatch && (
                      <span className="ml-1 text-amber-600 dark:text-amber-400" title={`Не совпадает с фактом прошлой смены (${(lastClosedShift?.actualCash ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`}>
                        ⚠
                      </span>
                    )}
                  </dd>
                </div>
                {currentShiftOpeningMismatch && (
                  <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    Стартовый остаток не совпадает с фактическими наличными на конец прошлой смены: было{" "}
                    {(lastClosedShift?.actualCash ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                    ₽, введено{" "}
                    {shift.openingCash.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                    ₽.
                  </div>
                )}
                {shift.status === "closed" && (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-xs text-zinc-500">Закрыта</dt>
                      <dd className="text-xs text-zinc-800 dark:text-zinc-100">
                        {shift.closedAt ?? "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-xs text-zinc-500">Кто закрыл</dt>
                      <dd className="text-xs text-zinc-800 dark:text-zinc-100">
                        {shift.closedBy
                          ? `${shift.closedBy.name} (${shift.closedBy.role})`
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-xs text-zinc-500">Факт наличные</dt>
                      <dd className="text-xs font-medium text-zinc-900 dark:text-zinc-50">
                        {(shift.actualCash ?? 0).toLocaleString("ru-RU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        ₽
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-xs text-zinc-500">Расчётные наличные</dt>
                      <dd className="text-xs font-medium text-zinc-900 dark:text-zinc-50">
                        {(shift.expectedCash ?? 0).toLocaleString("ru-RU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        ₽
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-xs text-zinc-500">Расхождение</dt>
                      <dd
                        className={
                          (shift.discrepancy ?? 0) === 0
                            ? "text-xs font-medium text-emerald-700 dark:text-emerald-300"
                            : "text-xs font-medium text-red-600 dark:text-red-400"
                        }
                      >
                        {(shift.discrepancy ?? 0).toLocaleString("ru-RU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        ₽
                      </dd>
                    </div>
                    {shift.discrepancy !== 0 && shift.discrepancyComment && (
                      <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                        Комментарий: {shift.discrepancyComment}
                      </div>
                    )}
                  </>
                )}
              </dl>
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
              <h2 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                Итоги операций (текущая смена)
              </h2>
              <dl className="space-y-1">
                <div className="flex justify-between">
                  <dt className="text-xs text-zinc-500">Изъятия (нал)</dt>
                  <dd className="text-xs">
                    {totals.withdrawals.toLocaleString("ru-RU", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    ₽
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-xs text-zinc-500">Расходы (нал)</dt>
                  <dd className="text-xs">
                    {totals.cashExpenses.toLocaleString("ru-RU", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    ₽
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-xs text-zinc-500">
                    Расчётные наличные (на основе ввода)
                  </dt>
                  <dd className="text-xs font-medium text-zinc-900 dark:text-zinc-50">
                    {totals.expectedCash.toLocaleString("ru-RU", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    ₽
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-xs text-zinc-500">Расхождение (факт − расчёт)</dt>
                  <dd
                    className={
                      totals.discrepancy === 0
                        ? "text-xs font-medium text-emerald-700 dark:text-emerald-300"
                        : "text-xs font-medium text-red-600 dark:text-red-400"
                    }
                  >
                    {totals.discrepancy.toLocaleString("ru-RU", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    ₽
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
                Наличные и карта по заказам пока вводятся вручную. Интеграция с AQSI и
                МойСклад для автоматической сверки может быть добавлена в этом блоке.
              </p>
            </div>
          </div>
          </FlowSection>

          {isOpen && (
            <FlowSection
              id="cash-actions"
              eyebrow="Шаг 2"
              title="Действия по кассе"
              description="После открытия смены внесите нужное действие: изъятие наличных или расходный ордер."
            >
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  Изъятие наличных (только владелец)
                </h2>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-zinc-500">Сумма, ₽</label>
                      <MoneyInput
                        value={withdrawAmount}
                        onValueChange={(value, draft) => setWithdrawAmount(draft ? String(value) : "")}
                        className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-right dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500">Причина</label>
                      <input
                        type="text"
                        value={withdrawReason}
                        onChange={(e) => setWithdrawReason(e.target.value)}
                        className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                        placeholder="Например: инкассация"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500">
                      Комментарий (опционально)
                    </label>
                    <input
                      type="text"
                      value={withdrawComment}
                      onChange={(e) => setWithdrawComment(e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddWithdrawal}
                    disabled={loading || user?.role !== "owner"}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-700"
                  >
                    Добавить изъятие
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
                <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                  Расходный ордер
                </h2>
                {expenseRefsError && (
                  <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    Справочники МойСклад не загрузились: {expenseRefsError}
                  </p>
                )}
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-xs text-zinc-500">Сумма, ₽</label>
                      <MoneyInput
                        value={expenseAmount}
                        onValueChange={(value, draft) => setExpenseAmount(draft ? String(value) : "")}
                        className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-right dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500">Дата ордера</label>
                      <input
                        type="date"
                        value={expenseDate}
                        onChange={(e) => setExpenseDate(e.target.value)}
                        className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500">Статья расхода</label>
                      <select
                        value={selectedExpenseItemId}
                        onChange={(e) => setSelectedExpenseItemId(e.target.value)}
                        className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                        disabled={expenseRefsLoading}
                      >
                        <option value="">Выберите статью</option>
                        {expenseItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500">Контрагент</label>
                    <input
                      type="text"
                      value={
                        selectedExpenseCounterparty
                          ? selectedExpenseCounterparty.name
                          : expenseCounterpartySearch
                      }
                      onFocus={() => {
                        if (expenseCounterpartyOptions.length === 0) {
                          void loadCounterparties();
                        }
                      }}
                      onChange={(e) => {
                        setSelectedExpenseCounterparty(null);
                        setExpenseCounterpartySearch(e.target.value);
                      }}
                      className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                      placeholder="Найдите контрагента"
                    />
                    {!selectedExpenseCounterparty &&
                      (expenseCounterpartySearch.trim() || expenseCounterpartyOptions.length > 0) && (
                        <div className="mt-1 max-h-48 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-600">
                          {counterpartyLoading ? (
                            <div className="px-3 py-2 text-xs text-zinc-500">Загрузка…</div>
                          ) : expenseCounterpartyOptions.length > 0 ? (
                            expenseCounterpartyOptions.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                className="block w-full px-3 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-700"
                                onClick={() => {
                                  setSelectedExpenseCounterparty(item);
                                  setExpenseCounterpartySearch("");
                                }}
                              >
                                {item.name}
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-xs text-zinc-500">Ничего не найдено</div>
                          )}
                        </div>
                      )}
                    {selectedExpenseCounterparty && (
                      <p className="mt-1 text-xs text-zinc-500">
                        Выбран: {selectedExpenseCounterparty.name}{" "}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedExpenseCounterparty(null);
                            setExpenseCounterpartySearch("");
                          }}
                          className="text-amber-600 hover:underline dark:text-amber-400"
                        >
                          сбросить
                        </button>
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500">
                      Основание / назначение платежа
                    </label>
                    <input
                      type="text"
                      value={expenseArticle}
                      onChange={(e) => setExpenseArticle(e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                      placeholder="Например: оплата аренды за март"
                    />
                  </div>
                  <div>
                    <span className="block text-xs text-zinc-500">
                      Тип оплаты (на расчётные наличные влияет только «наличные»)
                    </span>
                    <div className="mt-1 flex gap-4 text-xs">
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="radio"
                          name="expense-payment-type"
                          value="cash"
                          checked={expensePaymentType === "cash"}
                          onChange={() => setExpensePaymentType("cash")}
                        />
                        <span>Наличные</span>
                      </label>
                      <label className="inline-flex items-center gap-1">
                        <input
                          type="radio"
                          name="expense-payment-type"
                          value="card"
                          checked={expensePaymentType === "card"}
                          onChange={() => setExpensePaymentType("card")}
                        />
                        <span>Карта</span>
                      </label>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500">
                      Комментарий (опционально)
                    </label>
                    <input
                      type="text"
                      value={expenseComment}
                      onChange={(e) => setExpenseComment(e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500">
                      Вложение (ссылка на файл, опционально)
                    </label>
                    <input
                      type="text"
                      value={expenseAttachmentUrl}
                      onChange={(e) => setExpenseAttachmentUrl(e.target.value)}
                      className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                      placeholder="Например: ссылка на чек в облаке"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAddExpense}
                    disabled={loading}
                    className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-700"
                  >
                    Добавить расход
                  </button>
                </div>
              </div>
            </div>
            </FlowSection>
          )}

          {isOpen && (
            <FlowSection
              id="cash-close"
              eyebrow="Шаг 3"
              title="Закрытие смены"
              description="В конце дня сверьте суммы, проверьте расхождение и только потом закрывайте смену."
              tone="danger"
            >
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
              <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                Закрытие смены
              </h2>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Можно подтянуть суммы по заказам из интеграций (AQSI и др.).
                </p>
                <button
                  type="button"
                  onClick={handleFillFromSystems}
                  disabled={loading}
                  className="rounded border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {loading ? "Загрузка…" : "Заполнить из систем"}
                </button>
              </div>
              {ordersTotalsHint && (
                <p className="mb-3 text-xs text-amber-700 dark:text-amber-300">
                  {ordersTotalsHint}
                </p>
              )}
              {closeError && (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                  {closeError}
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs text-zinc-500">
                      Наличные по заказам (AQSI + МойСклад), ₽
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={closeCashOrders}
                      readOnly
                      className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-right text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                      aria-label="Наличные по заказам, только из систем"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500">
                      Карта по заказам (для отчёта), ₽
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={closeCardOrders}
                      readOnly
                      className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-right text-zinc-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
                      aria-label="Карта по заказам, только из систем"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-500">
                      Фактические наличные в кассе, ₽
                    </label>
                    <MoneyInput
                      value={closeActualCash}
                      onValueChange={(value, draft) => setCloseActualCash(draft ? String(value) : "")}
                      className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-right dark:border-zinc-600 dark:bg-zinc-900"
                    />
                  </div>
                </div>
                <div className="space-y-2 rounded-lg bg-zinc-50 p-3 text-xs dark:bg-zinc-900/40">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Стартовый остаток</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {shift.openingCash.toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      ₽
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">+ Наличные по заказам</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {(Number(closeCashOrders.replace(",", ".")) || 0).toLocaleString(
                        "ru-RU",
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }
                      )}{" "}
                      ₽
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">− Изъятия</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {totals.withdrawals.toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      ₽
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">− Расходы (наличные)</span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-50">
                      {totals.cashExpenses.toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      ₽
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-dashed border-zinc-300 pt-2 dark:border-zinc-600">
                    <span className="text-zinc-600 dark:text-zinc-300">
                      = Расчётные наличные
                    </span>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                      {totals.expectedCash.toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      ₽
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-600 dark:text-zinc-300">
                      Фактические наличные
                    </span>
                    <span className="font-semibold text-zinc-900 dark:text-zinc-50">
                      {(Number(closeActualCash.replace(",", ".")) || 0).toLocaleString(
                        "ru-RU",
                        {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        }
                      )}{" "}
                      ₽
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-600 dark:text-zinc-300">
                      Расхождение (факт − расчёт)
                    </span>
                    <span
                      className={
                        totals.discrepancy === 0
                          ? "font-semibold text-emerald-700 dark:text-emerald-300"
                          : "font-semibold text-red-600 dark:text-red-400"
                      }
                    >
                      {totals.discrepancy.toLocaleString("ru-RU", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{" "}
                      ₽
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-xs text-zinc-500">
                  Комментарий (обязателен при расхождении)
                </label>
                <textarea
                  rows={3}
                  value={closeComment}
                  onChange={(e) => setCloseComment(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                />
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  onClick={handleCloseShift}
                  disabled={loading}
                  className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-700"
                >
                  {loading ? "Закрытие…" : "Закрыть смену"}
                </button>
              </div>
            </div>
            </FlowSection>
          )}

          <FlowSection
            id="cash-journal"
            eyebrow="Контроль"
            title="Журнал операций"
            description="Здесь видно все действия по текущей смене в хронологическом порядке."
          >
          <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
            <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              Журнал операций текущей смены
            </h2>
            {currentShiftOpeningMismatch && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                ⚠ Стартовый остаток смены не совпадает с фактом прошлой смены: в кассе было{" "}
                {(lastClosedShift?.actualCash ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                ₽, при открытии введено{" "}
                {shift.openingCash.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                ₽.
              </div>
            )}
            {operations.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Операций пока нет.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
                      <th className="px-2 py-2">Время</th>
                      <th className="px-2 py-2">Тип</th>
                      <th className="px-2 py-2 text-right">Сумма</th>
                      <th className="px-2 py-2">Детали</th>
                      <th className="px-2 py-2">Кто</th>
                      <th className="px-2 py-2">Комментарий</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operations.map((op) => (
                      <tr
                        key={op.id}
                        className="border-b border-zinc-100 text-xs dark:border-zinc-700"
                      >
                        <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">
                          {op.createdAt}
                        </td>
                        <td className="px-2 py-1.5">
                          {op.type === "withdrawal" ? "Изъятие" : "Расход"}
                          {op.type === "expense" && (
                            <span className="ml-1 text-[11px] text-zinc-500">
                              ({op.paymentType === "cash" ? "нал" : "карта"})
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right font-medium">
                          {op.amount.toLocaleString("ru-RU", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                          ₽
                        </td>
                        <td className="px-2 py-1.5">
                          {op.type === "withdrawal"
                            ? op.reason
                            : [
                                op.article,
                                op.expenseItemName,
                                op.counterpartyName,
                                op.attachmentUrl ? "есть вложение" : "",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                        </td>
                        <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">
                          {op.createdBy.name} ({op.createdBy.role})
                        </td>
                        <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">
                          {op.comment ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          </FlowSection>
        </>
      )}

      <FlowSection
        id="cash-documents"
        eyebrow="Документы"
        title="Расходные ордера"
        description="Отдельный список расходных ордеров из МойСклад для проверки и поиска."
      >
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              Все расходные ордера
            </h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Расходные ордера из МойСклад с контрагентом и статьёй расхода.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={cashoutSearch}
              onChange={(e) => {
                setCashoutSearch(e.target.value);
                setCashoutsOffset(0);
              }}
              placeholder="Поиск по номеру, контрагенту, назначению"
              className="w-72 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
            />
            <button
              type="button"
              onClick={() => void loadCashouts()}
              disabled={cashoutsLoading}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              {cashoutsLoading ? "Загрузка…" : "Обновить"}
            </button>
          </div>
        </div>
        {cashouts.length === 0 ? (
          <>
            {cashoutsError && (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                Расходные ордера МойСклад не загрузились: {cashoutsError}
              </p>
            )}
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {cashoutsLoading ? "Загрузка ордеров…" : "Расходных ордеров пока нет."}
            </p>
          </>
        ) : (
          <>
            {cashoutsError && (
              <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                Расходные ордера МойСклад не обновились: {cashoutsError}
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
                    <th className="px-2 py-2">Дата</th>
                    <th className="px-2 py-2">Номер</th>
                    <th className="px-2 py-2">Контрагент</th>
                    <th className="px-2 py-2">Статья</th>
                    <th className="px-2 py-2">Основание</th>
                    <th className="px-2 py-2 text-right">Сумма</th>
                    <th className="px-2 py-2">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {cashouts.map((cashout) => (
                    <tr key={cashout.id} className="border-b border-zinc-100 dark:border-zinc-700">
                      <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">{cashout.moment}</td>
                      <td className="px-2 py-1.5 font-medium text-zinc-900 dark:text-zinc-100">
                        {cashout.name}
                      </td>
                      <td className="px-2 py-1.5">{cashout.agentName || "—"}</td>
                      <td className="px-2 py-1.5">{cashout.expenseItemName || "—"}</td>
                      <td className="px-2 py-1.5 text-zinc-600 dark:text-zinc-400">
                        {cashout.paymentPurpose || cashout.description || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium">
                        {(cashout.sum / 100).toLocaleString("ru-RU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        ₽
                      </td>
                      <td className="px-2 py-1.5">
                        {cashout.applicable ? "Проведен" : "Черновик"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
              <span>
                Показано {cashoutsOffset + 1}-{Math.min(cashoutsOffset + cashouts.length, cashoutsTotal || cashouts.length)} из {cashoutsTotal || cashouts.length}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCashoutsOffset((prev) => Math.max(0, prev - cashoutsLimit))}
                  disabled={cashoutsOffset === 0 || cashoutsLoading}
                  className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-50 dark:border-zinc-600"
                >
                  Назад
                </button>
                <button
                  type="button"
                  onClick={() => setCashoutsOffset((prev) => prev + cashoutsLimit)}
                  disabled={cashoutsOffset + cashouts.length >= cashoutsTotal || cashoutsLoading}
                  className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-50 dark:border-zinc-600"
                >
                  Вперед
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      </FlowSection>

      <FlowSection
        id="cash-history"
        eyebrow="История"
        title="История смен"
        description="Архив смен с итогами, расхождениями и возможностью посмотреть операции по каждой смене."
      >
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-3 text-sm font-semibold text-zinc-800 dark:text-zinc-100">
          История смен
        </h2>
        {historyShifts.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Истории смен пока нет.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-[11px] uppercase tracking-wide text-zinc-500 dark:border-zinc-700">
                  <th className="w-8 px-2 py-2"></th>
                  <th className="px-2 py-2">Дата</th>
                  <th className="px-2 py-2">Статус</th>
                  <th className="px-2 py-2">Открыл</th>
                  <th className="px-2 py-2">Закрыл</th>
                  <th className="px-2 py-2 text-right">Стартовый остаток</th>
                  <th className="px-2 py-2 text-right">Факт наличные</th>
                  <th className="px-2 py-2 text-right">Расхождение</th>
                </tr>
              </thead>
              <tbody>
                {historyShifts.map((s, index) => {
                  const prevShift = historyShifts[index + 1];
                  const expectedOpening =
                    prevShift?.status === "closed"
                      ? (prevShift.actualCash ?? 0)
                      : null;
                  const shiftOpeningMismatch =
                    expectedOpening != null &&
                    openingMismatch(s.openingCash, expectedOpening);
                  return (
                  <Fragment key={s.id}>
                    <tr
                      className="border-b border-zinc-100 text-xs dark:border-zinc-700"
                    >
                      <td className="w-8 px-2 py-1.5">
                        <button
                          type="button"
                          onClick={async () => {
                            if (expandedShiftId === s.id) {
                              setExpandedShiftId(null);
                              return;
                            }
                            setExpandedShiftId(s.id);
                            if (shiftOperationsCache[s.id] != null) return;
                            setLoadingShiftId(s.id);
                            try {
                              const res = await fetch(
                                `/api/cash?mode=shift&shiftId=${encodeURIComponent(s.id)}`
                              );
                              const data = await res.json();
                              if (res.ok && Array.isArray(data.operations)) {
                                setShiftOperationsCache((prev) => ({
                                  ...prev,
                                  [s.id]: data.operations,
                                }));
                              }
                            } finally {
                              setLoadingShiftId(null);
                            }
                          }}
                          className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
                          title={expandedShiftId === s.id ? "Свернуть" : "Подробнее"}
                        >
                          {loadingShiftId === s.id ? (
                            <span className="inline-block size-4 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600 dark:border-zinc-600 dark:border-t-zinc-300" />
                          ) : expandedShiftId === s.id ? (
                            "▼"
                          ) : (
                            "▶"
                          )}
                        </button>
                      </td>
                      <td className="px-2 py-1.5">{s.serviceDate}</td>
                      <td className="px-2 py-1.5">
                        {s.status === "open" ? "Открыта" : "Закрыта"}
                      </td>
                      <td className="px-2 py-1.5">
                        {s.openedBy.name} ({s.openedBy.role})
                      </td>
                      <td className="px-2 py-1.5">
                        {s.closedBy ? `${s.closedBy.name} (${s.closedBy.role})` : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <span>
                          {s.openingCash.toLocaleString("ru-RU", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{" "}
                          ₽
                        </span>
                        {shiftOpeningMismatch && (
                          <div
                            className="mt-0.5 text-[11px] text-amber-600 dark:text-amber-400"
                            title={`Не совпадает с фактом прошлой смены (${(expectedOpening ?? 0).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽)`}
                          >
                            ⚠ не совп. с прошлой
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {(s.actualCash ?? 0).toLocaleString("ru-RU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        ₽
                      </td>
                      <td
                        className={
                          (s.discrepancy ?? 0) === 0
                            ? "px-2 py-1.5 text-right text-emerald-700 dark:text-emerald-300"
                            : "px-2 py-1.5 text-right text-red-600 dark:text-red-400"
                        }
                      >
                        {(s.discrepancy ?? 0).toLocaleString("ru-RU", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        ₽
                      </td>
                    </tr>
                    {expandedShiftId === s.id && (
                      <tr key={`${s.id}-detail`}>
                        <td colSpan={8} className="bg-zinc-50 px-2 py-3 dark:bg-zinc-900/50">
                          <div className="rounded-lg border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-600 dark:bg-zinc-800">
                            <div className="mb-3 font-medium text-zinc-800 dark:text-zinc-100">
                              Подробности смены {s.serviceDate}
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                              <div>Открыта: {new Date(s.openedAt).toLocaleString("ru-RU")}</div>
                              <div>
                                Закрыта:{" "}
                                {s.closedAt
                                  ? new Date(s.closedAt).toLocaleString("ru-RU")
                                  : "—"}
                              </div>
                              <div>
                                Стартовый остаток:{" "}
                                {s.openingCash.toLocaleString("ru-RU", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{" "}
                                ₽
                              </div>
                              {shiftOpeningMismatch && expectedOpening != null && (
                                <div className="sm:col-span-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                                  ⚠ Стартовый остаток не совпадает с фактом прошлой смены: в кассе было{" "}
                                  {expectedOpening.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                                  ₽, введено{" "}
                                  {s.openingCash.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                                  ₽.
                                </div>
                              )}
                              {(s.cashOrdersTotal ?? 0) > 0 && (
                                <div>
                                  Наличные по заказам:{" "}
                                  {(s.cashOrdersTotal ?? 0).toLocaleString("ru-RU", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  ₽
                                </div>
                              )}
                              {(s.cardOrdersTotal ?? 0) > 0 && (
                                <div>
                                  Карта по заказам:{" "}
                                  {(s.cardOrdersTotal ?? 0).toLocaleString("ru-RU", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  ₽
                                </div>
                              )}
                              {(s.withdrawalsTotal ?? 0) > 0 && (
                                <div>
                                  Изъятия:{" "}
                                  {(s.withdrawalsTotal ?? 0).toLocaleString("ru-RU", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  ₽
                                </div>
                              )}
                              {(s.cashExpensesTotal ?? 0) > 0 && (
                                <div>
                                  Расходы (наличные):{" "}
                                  {(s.cashExpensesTotal ?? 0).toLocaleString("ru-RU", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  ₽
                                </div>
                              )}
                              <div>
                                Расчётные наличные:{" "}
                                {(s.expectedCash ?? 0).toLocaleString("ru-RU", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{" "}
                                ₽
                              </div>
                              <div>
                                Фактические наличные:{" "}
                                {(s.actualCash ?? 0).toLocaleString("ru-RU", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}{" "}
                                ₽
                              </div>
                              <div>
                                Расхождение:{" "}
                                <span
                                  className={
                                    (s.discrepancy ?? 0) === 0
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-red-600 dark:text-red-400"
                                  }
                                >
                                  {(s.discrepancy ?? 0).toLocaleString("ru-RU", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}{" "}
                                  ₽
                                </span>
                              </div>
                              {s.discrepancyComment && (
                                <div className="sm:col-span-2">
                                  Комментарий к расхождению: {s.discrepancyComment}
                                </div>
                              )}
                            </div>
                            {(() => {
                              const ops = shiftOperationsCache[s.id];
                              if (ops == null) return null;
                              if (ops.length === 0) {
                                return (
                                  <p className="mt-3 text-zinc-500 dark:text-zinc-400">
                                    Операций за смену нет.
                                  </p>
                                );
                              }
                              return (
                                <div className="mt-3">
                                  <div className="mb-1 font-medium text-zinc-700 dark:text-zinc-300">
                                    Операции ({ops.length})
                                  </div>
                                  <ul className="space-y-1">
                                    {ops.map((op) => (
                                      <li
                                        key={op.id}
                                        className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-zinc-600 dark:text-zinc-400"
                                      >
                                        {op.type === "withdrawal" ? (
                                          <>
                                            <span className="text-red-600 dark:text-red-400">
                                              Изъятие
                                            </span>
                                            <span>
                                              {op.amount.toLocaleString("ru-RU", {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                              })}{" "}
                                              ₽
                                            </span>
                                            <span>— {op.reason}</span>
                                            <span className="text-zinc-400 dark:text-zinc-500">
                                              {new Date(op.createdAt).toLocaleString("ru-RU")},{" "}
                                              {op.createdBy.name}
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            <span className="text-amber-600 dark:text-amber-400">
                                              Расход
                                            </span>
                                            <span>
                                              {op.amount.toLocaleString("ru-RU", {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                              })}{" "}
                                              ₽
                                            </span>
                                            <span>
                                              — {[op.article, op.expenseItemName, op.counterpartyName]
                                                .filter(Boolean)
                                                .join(" · ")}
                                            </span>
                                            <span className="text-zinc-400 dark:text-zinc-500">
                                              {op.paymentType === "cash" ? "нал" : "карта"},{" "}
                                              {new Date(op.createdAt).toLocaleString("ru-RU")},{" "}
                                              {op.createdBy.name}
                                            </span>
                                          </>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              );
                            })()}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </FlowSection>
    </main>
  );
}
