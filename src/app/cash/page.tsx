"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Filter,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import MoneyInput from "@/components/MoneyInput";
import { EcoBadge, EcoButton, EcoKpi } from "@/components/platform/EcoUI";

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
type CashExpenseOrderStatus = "draft" | "posted" | "cancelled";
type CashExpenseOrderSource = "local" | "moysklad_import" | "sync";

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
      amountCents?: number;
      comment?: string;
      orderId?: string;
      number?: string;
      status?: CashExpenseOrderStatus;
      source?: CashExpenseOrderSource;
      expenseDate?: string;
      article: string;
      counterpartyId?: string;
      counterpartyName?: string;
      counterpartyMetaHref?: string;
      expenseItemId?: string;
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
  amountCents?: number;
  applicable: boolean;
  status?: CashExpenseOrderStatus;
  source?: CashExpenseOrderSource;
  paymentType?: CashExpensePaymentType;
  shiftId?: string;
  expenseItemId?: string;
  counterpartyId?: string;
  paymentPurpose: string;
  description: string;
  agentName: string;
  expenseItemName: string;
  organizationName: string;
  moyskladCashoutHref?: string;
  meta: { href: string; type: string; mediaType: string };
};

type CashTab = "opening" | "active" | "closed";
type CashoutStatusFilter = "all" | "posted" | "draft" | "cancelled";
type CashoutPeriodFilter = "all" | "today" | "month";
type CashoutSourceFilter = "all" | "local" | "moysklad";
type CashoutTenderFilter = "all" | "cash" | "card";

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
  const toneClass = tone === "danger" ? "eco-cash-section--danger" : "";

  return (
    <section id={id} className={`eco-cash-section scroll-mt-28 ${toneClass}`}>
      <div className="eco-cash-section__head">
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
  const normalized = Math.abs(value) < 0.005 ? 0 : value;
  return `${normalized.toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ₽`;
}

function signedMoney(value: number) {
  if (Math.abs(value) < 0.005) return money(0);
  return `-${money(Math.abs(value))}`;
}

function moneyFromCents(value: number) {
  return money(value / 100);
}

function parseMoneyInput(value: string) {
  return Number(value.replace(",", ".")) || 0;
}

function shortTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function dateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dateOnly(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10) || "—";
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function cashoutStatus(cashout: CashoutRecord) {
  const status = cashout.status ?? (cashout.applicable ? "posted" : "draft");
  if (status === "posted") return { label: "Проведён", tone: "success" as const };
  if (status === "cancelled") return { label: "Отменён", tone: "neutral" as const };
  return { label: "Черновик", tone: "warning" as const };
}

function cashoutSourceLabel(cashout: CashoutRecord) {
  if (cashout.source === "local") return "Локальная БД";
  if (cashout.source === "sync") return "Архивный импорт";
  return cashout.moyskladCashoutHref ? "Архивный импорт" : "Импорт";
}

function isPostedExpense(op: CashOperation): op is Extract<CashOperation, { type: "expense" }> {
  return op.type === "expense" && (op.status == null || op.status === "posted");
}

function shiftStatus(shift: CashShift | null) {
  if (shift?.status === "open") return { label: "Смена открыта", tone: "success" as const };
  return { label: "Касса закрыта", tone: "neutral" as const };
}

function isToday(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function isCurrentMonth(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
}

export default function CashPage() {
  const router = useRouter();
  const [user, setUser] = useState<User>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [shift, setShift] = useState<CashShift | null>(null);
  const [operations, setOperations] = useState<CashOperation[]>([]);
  const [historyShifts, setHistoryShifts] = useState<CashShift[]>([]);
  const [activeTab, setActiveTab] = useState<CashTab>("opening");

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
  const [editingExpenseOrderId, setEditingExpenseOrderId] = useState<string | null>(null);
  const [expenseRefsLoading, setExpenseRefsLoading] = useState(false);
  const [expenseRefsError, setExpenseRefsError] = useState<string | null>(null);
  const [counterpartyLoading, setCounterpartyLoading] = useState(false);

  const [cashouts, setCashouts] = useState<CashoutRecord[]>([]);
  const [cashoutsTotal, setCashoutsTotal] = useState(0);
  const [cashoutsOffset, setCashoutsOffset] = useState(0);
  const [cashoutSearch, setCashoutSearch] = useState("");
  const [cashoutStatusFilter, setCashoutStatusFilter] = useState<CashoutStatusFilter>("all");
  const [cashoutPeriodFilter, setCashoutPeriodFilter] = useState<CashoutPeriodFilter>("all");
  const [cashoutSourceFilter, setCashoutSourceFilter] = useState<CashoutSourceFilter>("all");
  const [cashoutTenderFilter, setCashoutTenderFilter] = useState<CashoutTenderFilter>("all");
  const [cashoutsLimit, setCashoutsLimit] = useState<25 | 50 | 100>(50);
  const [lastCashoutsSyncAt, setLastCashoutsSyncAt] = useState<string | null>(null);
  const [cashoutsLoading, setCashoutsLoading] = useState(false);
  const [cashoutsError, setCashoutsError] = useState<string | null>(null);

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
      if (cashoutStatusFilter !== "all") params.set("status", cashoutStatusFilter);
      if (cashoutSourceFilter === "local") params.set("source", "local");
      if (cashoutTenderFilter !== "all") params.set("paymentType", cashoutTenderFilter);
      const res = await fetch(`/api/moysklad/cashouts?${params.toString()}`, { cache: "no-store" });
      const data = await safeJson<{
        cashouts?: CashoutRecord[];
        meta?: { size?: number };
        error?: string;
      }>(res);
      if (res.ok) {
        setCashouts(Array.isArray(data?.cashouts) ? data.cashouts : []);
        setCashoutsTotal(typeof data?.meta?.size === "number" ? data.meta.size : 0);
        setLastCashoutsSyncAt(new Date().toISOString());
      } else {
        setCashoutsError(errorFromJson(data, "Ошибка загрузки расходных ордеров"));
      }
    } catch (e) {
      setCashoutsError(e instanceof Error ? e.message : "Ошибка загрузки расходных ордеров");
    } finally {
      setCashoutsLoading(false);
    }
  }, [
    cashoutSearch,
    cashoutStatusFilter,
    cashoutSourceFilter,
    cashoutTenderFilter,
    cashoutsLimit,
    cashoutsOffset,
    hasCashAccess,
  ]);

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
          setExpenseRefsError(e instanceof Error ? e.message : "Ошибка загрузки локальных справочников");
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
    if (checkingAuth) return;
    setActiveTab((current) => {
      if (shift?.status === "open" && current === "opening") return "active";
      if (shift?.status !== "open" && current === "active") return "opening";
      return current;
    });
  }, [checkingAuth, shift?.status]);

  useEffect(() => {
    setCashoutsOffset(0);
  }, [cashoutsLimit, cashoutStatusFilter, cashoutPeriodFilter, cashoutSourceFilter, cashoutTenderFilter]);

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
      .filter((op) => isPostedExpense(op) && op.paymentType === "cash")
      .reduce((sum, op) => sum + (op.amount || 0), 0);
    const opening = shift?.openingCash ?? 0;
    const cashOrders = parseMoneyInput(closeCashOrders);
    const expected = opening + cashOrders - withdrawals - cashExpenses;
    const actual = parseMoneyInput(closeActualCash);
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
    const opening = parseMoneyInput(openingCashInput);
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
      setActiveTab("active");
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
    const amount = parseMoneyInput(withdrawAmount);
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

  function resetExpenseForm(nextDate = getServiceDateForTimezone(shift?.timezone)) {
    setExpenseAmount("");
    setExpenseDate(nextDate);
    setExpenseArticle("");
    setExpenseComment("");
    setExpenseAttachmentUrl("");
    setExpensePaymentType("cash");
    setSelectedExpenseItemId("");
    setSelectedExpenseCounterparty(null);
    setExpenseCounterpartySearch("");
    setEditingExpenseOrderId(null);
  }

  function startEditExpenseOrder(cashout: CashoutRecord) {
    if (cashout.status !== "draft") return;
    setEditingExpenseOrderId(cashout.id);
    setExpenseAmount((cashout.sum / 100).toFixed(2));
    setExpenseDate(cashout.moment.slice(0, 10));
    setExpenseArticle(cashout.paymentPurpose || "");
    setExpenseComment(cashout.description || "");
    setExpenseAttachmentUrl("");
    setExpensePaymentType(cashout.paymentType ?? "cash");
    const expenseItem =
      (cashout.expenseItemId ? expenseItems.find((item) => item.id === cashout.expenseItemId) : null) ??
      expenseItems.find((item) => item.name === cashout.expenseItemName);
    setSelectedExpenseItemId(expenseItem?.id ?? cashout.expenseItemId ?? "");
    if (cashout.counterpartyId || cashout.agentName) {
      setSelectedExpenseCounterparty({
        id: cashout.counterpartyId || cashout.agentName,
        name: cashout.agentName || "Контрагент",
        meta: {
          href: cashout.counterpartyId ? `local://counterparty/${cashout.counterpartyId}` : "",
          type: "counterparty",
          mediaType: "application/json",
        },
      });
    } else {
      setSelectedExpenseCounterparty(null);
    }
    setActiveTab("active");
    window.setTimeout(
      () => document.getElementById("cash-expense-card")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      80
    );
  }

  async function submitExpenseOrder(status: CashExpenseOrderStatus) {
    if (!shift) return;
    setError(null);
    const amount = parseMoneyInput(expenseAmount);
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
      const action = editingExpenseOrderId ? "updateExpense" : "addExpense";
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          id: editingExpenseOrderId ?? undefined,
          shiftId: shift.id,
          amount,
          expenseDate,
          article: expenseArticle.trim() || selectedExpenseItem.name,
          counterpartyId: selectedExpenseCounterparty.id,
          counterpartyName: selectedExpenseCounterparty.name,
          counterpartyMetaHref: selectedExpenseCounterparty.meta?.href,
          expenseItemId: selectedExpenseItem.id,
          expenseItemName: selectedExpenseItem.name,
          expenseItemMetaHref: selectedExpenseItem.meta?.href,
          paymentType: expensePaymentType,
          status,
          comment: expenseComment.trim() || undefined,
          attachmentUrl: expenseAttachmentUrl.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Ошибка сохранения расходного ордера");
        return;
      }
      if (data.operation) {
        setOperations((prev) => {
          const operation = data.operation as Extract<CashOperation, { type: "expense" }>;
          const hasOperation = prev.some(
            (op) => op.type === "expense" && (op.orderId === operation.orderId || op.id === operation.id)
          );
          if (hasOperation) {
            return prev.map((op) =>
              op.type === "expense" && (op.orderId === operation.orderId || op.id === operation.id)
                ? operation
                : op
            );
          }
          return [...prev, operation];
        });
      }
      resetExpenseForm(getServiceDateForTimezone(shift.timezone));
      void loadCashouts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети при сохранении расхода");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddExpense() {
    await submitExpenseOrder("posted");
  }

  async function handleSaveExpenseDraft() {
    await submitExpenseOrder("draft");
  }

  async function mutateExpenseOrder(id: string, action: "postExpense" | "cancelExpense", reason?: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/cash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id, reason }),
      });
      const data = await safeJson<{ operation?: CashOperation; error?: string }>(res);
      if (!res.ok) {
        setError(errorFromJson(data, "Ошибка изменения расходного ордера"));
        return;
      }
      const operation = data?.operation;
      if (operation) {
        setOperations((prev) => {
          const hasOperation = prev.some(
            (op) => op.type === "expense" && (op.orderId === id || op.id === operation.id)
          );
          if (hasOperation) {
            return prev.map((op) =>
              op.type === "expense" && (op.orderId === id || op.id === operation.id)
                ? operation
                : op
            );
          }
          return operation.shiftId === shift?.id ? [...prev, operation] : prev;
        });
      }
      void loadCashouts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сети при изменении расходного ордера");
    } finally {
      setLoading(false);
    }
  }

  async function handlePostExpenseOrder(id: string) {
    await mutateExpenseOrder(id, "postExpense");
  }

  async function handleCancelExpenseOrder(id: string) {
    const ok = window.confirm("Отменить расходный ордер? Сумма перестанет учитываться в кассовой смене.");
    if (!ok) return;
    await mutateExpenseOrder(id, "cancelExpense", "Отменено из кассы");
  }

  async function handleCloseShift() {
    if (!shift) return;
    setError(null);
    setCloseError(null);
    const cashOrders = parseMoneyInput(closeCashOrders);
    const cardOrders = parseMoneyInput(closeCardOrders);
    const actualCash = parseMoneyInput(closeActualCash);
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
      if (data.shift) {
        setHistoryShifts((prev) => [data.shift, ...prev.filter((item) => item.id !== data.shift.id)]);
      }
      setActiveTab("closed");
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

  async function toggleShiftDetails(targetShift: CashShift) {
    if (expandedShiftId === targetShift.id) {
      setExpandedShiftId(null);
      return;
    }
    setExpandedShiftId(targetShift.id);
    if (shiftOperationsCache[targetShift.id] != null) return;
    setLoadingShiftId(targetShift.id);
    try {
      const res = await fetch(
        `/api/cash?mode=shift&shiftId=${encodeURIComponent(targetShift.id)}`,
        { cache: "no-store" }
      );
      const data = await safeJson<{ operations?: CashOperation[] }>(res);
      if (res.ok && Array.isArray(data?.operations)) {
        setShiftOperationsCache((prev) => ({
          ...prev,
          [targetShift.id]: data.operations ?? [],
        }));
      }
    } finally {
      setLoadingShiftId(null);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard can be blocked in non-secure contexts; the action is optional.
    }
  }

  if (checkingAuth) {
    return (
      <main className="eco-page eco-page--wide eco-cash-page">
        <div className="eco-cash-skeleton-grid" aria-label="Загрузка кассы">
          <div className="eco-cash-skeleton eco-cash-skeleton--head" />
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="eco-cash-skeleton" />
          ))}
          <div className="eco-cash-skeleton eco-cash-skeleton--wide" />
        </div>
      </main>
    );
  }

  if (!hasCashAccess) {
    return (
      <main className="eco-page eco-page--wide eco-cash-page">
        <section className="eco-page-head">
          <div>
            <div className="eco-page-crumbs">
              <Link href="/">Главная</Link>
              <span className="sep">/</span>
              <span>Финансы</span>
              <span className="sep">/</span>
              <span className="cur">Касса</span>
            </div>
            <h1 className="eco-page-title">Касса</h1>
            <p className="eco-page-subtitle">
              Доступ в раздел «Касса» есть только у владельца и администратора.
            </p>
          </div>
        </section>
      </main>
    );
  }

  const isOpen = shift?.status === "open";
  const cashExpenseOperations = operations.filter((op) => isPostedExpense(op) && op.paymentType === "cash");
  const withdrawalOperations = operations.filter((op) => op.type === "withdrawal");
  const openingValue = shift?.openingCash ?? cashInRegister;
  const expectedCashValue = shift?.status === "closed" ? shift.expectedCash ?? 0 : totals.expectedCash;
  const actualCashValue =
    closeActualCash.trim() ? parseMoneyInput(closeActualCash) : shift?.actualCash;
  const hasEnteredActualCash = closeActualCash.trim().length > 0 || shift?.status === "closed";
  const discrepancyValue = shift?.status === "closed" ? shift.discrepancy ?? 0 : totals.discrepancy;
  const hasDiscrepancy = hasEnteredActualCash && Math.abs(discrepancyValue) >= 0.005;
  const baseStatus = shiftStatus(shift);
  const headerStatus = cashoutsError
    ? { label: "Ошибка загрузки", tone: "danger" as const }
    : hasDiscrepancy
      ? { label: "Есть расхождение", tone: "warning" as const }
      : baseStatus;
  const pageTitle =
    activeTab === "closed"
      ? "Касса · закрытые смены"
      : isOpen
        ? "Касса · активная смена"
        : "Касса · смена закрыта";
  const visibleCashouts = cashouts.filter((cashout) => {
    const status = cashout.status ?? (cashout.applicable ? "posted" : "draft");
    const source = cashout.source ?? (cashout.moyskladCashoutHref ? "moysklad_import" : "local");
    if (cashoutStatusFilter !== "all" && status !== cashoutStatusFilter) return false;
    if (cashoutPeriodFilter === "today" && !isToday(cashout.moment)) return false;
    if (cashoutPeriodFilter === "month" && !isCurrentMonth(cashout.moment)) return false;
    if (cashoutSourceFilter === "local" && source !== "local") return false;
    if (cashoutSourceFilter === "moysklad" && source === "local" && !cashout.moyskladCashoutHref) return false;
    if (cashoutTenderFilter !== "all" && (cashout.paymentType ?? "cash") !== cashoutTenderFilter) return false;
    return true;
  });
  const cashoutPageStart = cashoutsTotal === 0 ? 0 : cashoutsOffset + 1;
  const cashoutPageEnd = Math.min(cashoutsOffset + cashouts.length, cashoutsTotal || cashouts.length);
  const cashoutCurrentPage = Math.floor(cashoutsOffset / cashoutsLimit) + 1;
  const cashoutTotalPages = Math.max(1, Math.ceil((cashoutsTotal || cashouts.length || 1) / cashoutsLimit));
  const filtersApplied =
    cashoutSearch.trim() ||
    cashoutStatusFilter !== "all" ||
    cashoutPeriodFilter !== "all" ||
    cashoutSourceFilter !== "all" ||
    cashoutTenderFilter !== "all";

  function resetCashoutFilters() {
    setCashoutSearch("");
    setCashoutStatusFilter("all");
    setCashoutPeriodFilter("all");
    setCashoutSourceFilter("all");
    setCashoutTenderFilter("all");
    setCashoutsOffset(0);
  }

  async function requestCloseShift() {
    if (operations.length > 0) {
      const ok = window.confirm("Закрыть кассовую смену? Проверьте операции и фактический остаток перед закрытием.");
      if (!ok) return;
    }
    await handleCloseShift();
  }

  function renderEmptyState(title: string, text: string, action?: ReactNode) {
    return (
      <div className="eco-cash-empty">
        <strong>{title}</strong>
        <span>{text}</span>
        {action}
      </div>
    );
  }

  function renderOperationsJournal() {
    if (!shift) return null;
    return (
      <div className="eco-card eco-card--padded eco-cash-journal-card">
        <div className="eco-card__head eco-card__head--plain">
          <div>
            <h2>Операции смены</h2>
            <p>Хронология изъятий и расходных ордеров текущей смены.</p>
          </div>
          <EcoBadge tone={operations.length > 0 ? "rust" : "neutral"}>
            {operations.length} операций
          </EcoBadge>
        </div>
        {currentShiftOpeningMismatch && (
          <div className="eco-cash-warning">
            Стартовый остаток не совпадает с фактом прошлой смены: было {money(lastClosedShift?.actualCash ?? 0)}, введено {money(shift.openingCash)}.
          </div>
        )}
        {operations.length === 0 ? (
          renderEmptyState("Операций пока нет", "Расходы и изъятия появятся здесь после добавления.")
        ) : (
          <div className="eco-table-wrap eco-cash-ops-table">
            <table className="eco-table">
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Тип</th>
                  <th>Детали</th>
                  <th>Кто</th>
                  <th style={{ textAlign: "right" }}>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {operations.map((op) => (
                  <tr key={op.id}>
                    <td className="l-mono">{dateTime(op.createdAt)}</td>
                    <td>
                      <EcoBadge tone={op.type === "withdrawal" ? "warning" : "info"}>
                        {op.type === "withdrawal" ? "Изъятие" : op.paymentType === "cash" ? "Расход · наличные" : "Расход · карта"}
                      </EcoBadge>
                    </td>
                    <td>
                      <div className="eco-cash-primary-text">
                        {op.type === "withdrawal" ? op.reason : op.article}
                      </div>
                      <div className="eco-cash-secondary-text">
                        {op.type === "expense"
                          ? [op.expenseItemName, op.counterpartyName, op.attachmentUrl ? "есть вложение" : ""].filter(Boolean).join(" · ") || "без деталей"
                          : op.comment || "без комментария"}
                      </div>
                    </td>
                    <td>{op.createdBy.name}</td>
                    <td className="l-money eco-cash-money-cell">{signedMoney(op.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  function renderHistory() {
    return (
      <div className="eco-card eco-card--padded eco-cash-history-card">
        <div className="eco-card__head eco-card__head--plain">
          <div>
            <h2>История смен</h2>
            <p>Итоги закрытых смен, расхождения и аудит операций.</p>
          </div>
          <EcoBadge tone={historyShifts.length > 0 ? "rust" : "neutral"}>
            {historyShifts.length} смен
          </EcoBadge>
        </div>
        {historyShifts.length === 0 ? (
          renderEmptyState(
            "История смен пока пуста",
            "После закрытия первой смены здесь появятся итоги и операции."
          )
        ) : (
          <>
            <div className="eco-table-wrap eco-cash-history-table">
              <table className="eco-table">
                <thead>
                  <tr>
                    <th style={{ width: 42 }} />
                    <th>Открытие</th>
                    <th>Закрытие</th>
                    <th>Кассир</th>
                    <th style={{ textAlign: "right" }}>Старт</th>
                    <th style={{ textAlign: "right" }}>Поступления</th>
                    <th style={{ textAlign: "right" }}>Расходы</th>
                    <th style={{ textAlign: "right" }}>Изъятия</th>
                    <th style={{ textAlign: "right" }}>Ожидание</th>
                    <th style={{ textAlign: "right" }}>Факт</th>
                    <th style={{ textAlign: "right" }}>Расхождение</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {historyShifts.map((historyShift, index) => {
                    const prevShift = historyShifts[index + 1];
                    const expectedOpening =
                      prevShift?.status === "closed" ? prevShift.actualCash ?? 0 : null;
                    const shiftOpeningMismatch =
                      expectedOpening != null && openingMismatch(historyShift.openingCash, expectedOpening);
                    const isExpanded = expandedShiftId === historyShift.id;
                    const ops = shiftOperationsCache[historyShift.id];
                    return (
                      <Fragment key={historyShift.id}>
                        <tr className="eco-cash-clickable-row" onClick={() => void toggleShiftDetails(historyShift)}>
                          <td>
                            <button
                              type="button"
                              className="eco-icon-btn"
                              aria-label={isExpanded ? "Свернуть смену" : "Открыть детали смены"}
                              onClick={(event) => {
                                event.stopPropagation();
                                void toggleShiftDetails(historyShift);
                              }}
                            >
                              {loadingShiftId === historyShift.id ? (
                                <RefreshCw aria-hidden className="eco-icon eco-cash-spin" />
                              ) : (
                                <ChevronDown aria-hidden className={`eco-icon ${isExpanded ? "is-open" : ""}`} />
                              )}
                            </button>
                          </td>
                          <td>
                            <div className="l-mono">{dateTime(historyShift.openedAt)}</div>
                            <div className="eco-cash-secondary-text">{historyShift.serviceDate}</div>
                          </td>
                          <td className="l-mono">{dateTime(historyShift.closedAt)}</td>
                          <td>
                            <div className="eco-cash-primary-text">{historyShift.openedBy.name}</div>
                            <div className="eco-cash-secondary-text">закрыл: {historyShift.closedBy?.name ?? "—"}</div>
                          </td>
                          <td className="l-money eco-cash-money-cell">
                            {money(historyShift.openingCash)}
                            {shiftOpeningMismatch && <span className="eco-cash-inline-warning"> не совп.</span>}
                          </td>
                          <td className="l-money eco-cash-money-cell">{money(historyShift.cashOrdersTotal ?? 0)}</td>
                          <td className="l-money eco-cash-money-cell">{money(historyShift.cashExpensesTotal ?? 0)}</td>
                          <td className="l-money eco-cash-money-cell">{money(historyShift.withdrawalsTotal ?? 0)}</td>
                          <td className="l-money eco-cash-money-cell">{money(historyShift.expectedCash ?? 0)}</td>
                          <td className="l-money eco-cash-money-cell">{money(historyShift.actualCash ?? 0)}</td>
                          <td className={`l-money eco-cash-money-cell ${(historyShift.discrepancy ?? 0) === 0 ? "is-ok" : "is-danger"}`}>
                            {money(historyShift.discrepancy ?? 0)}
                          </td>
                          <td>
                            <EcoBadge tone={historyShift.status === "closed" ? "neutral" : "success"} dot>
                              {historyShift.status === "closed" ? "Закрыта" : "Открыта"}
                            </EcoBadge>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={12}>
                              <div className="eco-cash-audit">
                                <div className="eco-cash-audit__head">
                                  <div>
                                    <div className="eco-page-kicker">Audit view</div>
                                    <h3>Смена {historyShift.serviceDate}</h3>
                                  </div>
                                  <div className="eco-actions">
                                    <button type="button" className="eco-btn eco-btn--ghost eco-btn--sm" onClick={() => window.print()}>
                                      <Printer aria-hidden className="eco-icon" />
                                      Печать
                                    </button>
                                  </div>
                                </div>
                                {shiftOpeningMismatch && expectedOpening != null && (
                                  <div className="eco-cash-warning">
                                    Стартовый остаток не совпадает с фактом прошлой смены: было {money(expectedOpening)}, введено {money(historyShift.openingCash)}.
                                  </div>
                                )}
                                <div className="eco-cash-audit-grid">
                                  <span><b>Кто открыл</b>{historyShift.openedBy.name}</span>
                                  <span><b>Кто закрыл</b>{historyShift.closedBy?.name ?? "—"}</span>
                                  <span><b>Открыта</b>{dateTime(historyShift.openedAt)}</span>
                                  <span><b>Закрыта</b>{dateTime(historyShift.closedAt)}</span>
                                  <span><b>Старт</b>{money(historyShift.openingCash)}</span>
                                  <span><b>Поступления</b>{money(historyShift.cashOrdersTotal ?? 0)}</span>
                                  <span><b>Расходы</b>{money(historyShift.cashExpensesTotal ?? 0)}</span>
                                  <span><b>Изъятия</b>{money(historyShift.withdrawalsTotal ?? 0)}</span>
                                  <span><b>Ожидание</b>{money(historyShift.expectedCash ?? 0)}</span>
                                  <span><b>Факт</b>{money(historyShift.actualCash ?? 0)}</span>
                                  <span><b>Расхождение</b>{money(historyShift.discrepancy ?? 0)}</span>
                                  <span><b>Комментарий</b>{historyShift.discrepancyComment || "—"}</span>
                                </div>
                                {ops == null ? null : ops.length === 0 ? (
                                  renderEmptyState("Операций за смену нет", "Смена закрыта без внутренних операций.")
                                ) : (
                                  <div className="eco-cash-audit-ops">
                                    {ops.map((op) => (
                                      <div key={op.id} className="eco-cash-audit-op">
                                        <div>
                                          <EcoBadge tone={op.type === "withdrawal" ? "warning" : "info"}>
                                            {op.type === "withdrawal" ? "Изъятие" : "Расход"}
                                          </EcoBadge>
                                          <span className="l-mono">{dateTime(op.createdAt)}</span>
                                        </div>
                                        <strong className="l-money">{signedMoney(op.amount)}</strong>
                                        <p>
                                          {op.type === "withdrawal"
                                            ? op.reason
                                            : [op.article, op.expenseItemName, op.counterpartyName].filter(Boolean).join(" · ")}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                )}
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
            <div className="eco-cash-mobile-list">
              {historyShifts.map((historyShift) => (
                <button
                  type="button"
                  key={historyShift.id}
                  className="eco-cash-mobile-card"
                  onClick={() => void toggleShiftDetails(historyShift)}
                >
                  <span className="eco-cash-mobile-card__top">
                    <strong>{dateOnly(historyShift.openedAt)}</strong>
                    <EcoBadge tone={(historyShift.discrepancy ?? 0) === 0 ? "neutral" : "warning"}>
                      {(historyShift.discrepancy ?? 0) === 0 ? "Без расхождений" : "Есть расхождение"}
                    </EcoBadge>
                  </span>
                  <span>{historyShift.openedBy.name} · факт {money(historyShift.actualCash ?? 0)}</span>
                  <span className="l-money">Расхождение {money(historyShift.discrepancy ?? 0)}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  function renderOpeningScenario() {
    return (
      <FlowSection
        id="cash-open"
        eyebrow="Открытие"
        title="Открытие смены"
        description="Укажите стартовый остаток наличных. После открытия смены станут доступны операции по кассе."
      >
        {isOpen ? (
          renderEmptyState("Смена уже открыта", "Операции и закрытие доступны во вкладке «Активная смена».")
        ) : (
          <div className="eco-card eco-card--padded eco-cash-open-card">
            <div className="eco-cash-open-copy">
              <div className="eco-page-kicker">Старт смены</div>
              <h3>Зафиксируйте наличные в кассе</h3>
              <p>
                Можно открыть смену с нулём или подставить фактический остаток прошлой закрытой смены.
              </p>
            </div>
            <div className="eco-cash-open-form">
              <label className="eco-cash-field">
                <span>Стартовый остаток наличных</span>
                <MoneyInput
                  value={openingCashInput}
                  onValueChange={(_, draft) => setOpeningCashInput(draft)}
                  placeholder="0,00"
                  className="eco-input l-money eco-cash-money-input"
                />
              </label>
              <div className="eco-actions">
                {lastClosedShift != null && (
                  <button
                    type="button"
                    onClick={() => setOpeningCashInput(cashInRegister.toFixed(2))}
                    className="eco-btn"
                  >
                    {money(cashInRegister)}
                  </button>
                )}
                <EcoButton type="button" variant="primary" onClick={handleOpenShift} disabled={loading}>
                  <Plus aria-hidden className="eco-icon" />
                  {loading ? "Открываем смену..." : "Открыть смену"}
                </EcoButton>
              </div>
            </div>
          </div>
        )}
      </FlowSection>
    );
  }

  function renderActiveScenario() {
    if (!isOpen || !shift) {
      return (
        <FlowSection
          id="cash-active-empty"
          eyebrow="Активная смена"
          title="Активной смены нет"
          description="Откройте смену, чтобы добавить расходы, изъятия и закрыть кассу в конце дня."
        >
          {renderEmptyState(
            "Касса закрыта",
            "Активная смена появится сразу после открытия.",
            <button type="button" className="eco-btn eco-btn--primary" onClick={() => setActiveTab("opening")}>
              Перейти к открытию
            </button>
          )}
        </FlowSection>
      );
    }

    return (
      <>
        <FlowSection
          id="cash-active"
          eyebrow="Активная смена"
          title="Состояние смены"
          description="Проверьте текущие суммы, добавьте операции и подготовьте кассу к закрытию."
        >
          <div className="eco-cash-active-grid">
            <div className="eco-card eco-card--padded eco-cash-shift-card">
              <div className="eco-card__head eco-card__head--plain">
                <div>
                  <h2>Смена открыта</h2>
                  <p>{dateTime(shift.openedAt)} · {shift.openedBy.name}</p>
                </div>
                <EcoBadge tone="success" dot>активная</EcoBadge>
              </div>
              <div className="eco-cash-definition-grid">
                <span><b>Кассир</b>{shift.openedBy.name}</span>
                <span><b>Дата сервиса</b>{shift.serviceDate}</span>
                <span><b>Стартовый остаток</b>{money(shift.openingCash)}</span>
                <span><b>Поступления</b>{money(parseMoneyInput(closeCashOrders))}</span>
                <span><b>Расходы наличными</b>{signedMoney(totals.cashExpenses)}</span>
                <span><b>Изъятия</b>{signedMoney(totals.withdrawals)}</span>
                <span><b>Ожидаемый остаток</b>{money(totals.expectedCash)}</span>
              </div>
              {currentShiftOpeningMismatch && (
                <div className="eco-cash-warning">
                  Стартовый остаток не совпадает с фактом прошлой смены: было {money(lastClosedShift?.actualCash ?? 0)}, введено {money(shift.openingCash)}.
                </div>
              )}
              <div className="eco-cash-action-row">
                <button type="button" className="eco-btn" onClick={() => document.getElementById("cash-expense-card")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  <Plus aria-hidden className="eco-icon" />
                  Добавить расход
                </button>
                <button type="button" className="eco-btn" onClick={() => document.getElementById("cash-withdrawal-card")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  <Plus aria-hidden className="eco-icon" />
                  Сделать изъятие
                </button>
                <button type="button" className="eco-btn eco-btn--danger" onClick={() => document.getElementById("cash-close-card")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                  Закрыть смену
                </button>
              </div>
            </div>
            <div className="eco-card eco-card--padded eco-cash-close-card" id="cash-close-card">
              <div className="eco-card__head eco-card__head--plain">
                <div>
                  <h2>Закрытие смены</h2>
                  <p>Сверьте системные суммы, фактические наличные и расхождение.</p>
                </div>
                <button type="button" className="eco-btn eco-btn--sm" onClick={handleFillFromSystems} disabled={loading}>
                  <RefreshCw aria-hidden className="eco-icon" />
                  {loading ? "Загрузка..." : "Из систем"}
                </button>
              </div>
              {ordersTotalsHint && <div className="eco-cash-warning">{ordersTotalsHint}</div>}
              {closeError && <div className="eco-cash-error">{closeError}</div>}
              {hasDiscrepancy && (
                <div className="eco-cash-warning">Есть расхождение {money(discrepancyValue)}. Для закрытия смены нужен комментарий.</div>
              )}
              <div className="eco-cash-close-grid">
                <label className="eco-cash-field">
                  <span>Ожидаемый остаток</span>
                  <input className="eco-input l-money eco-cash-money-input" value={money(totals.expectedCash)} readOnly />
                </label>
                <label className="eco-cash-field">
                  <span>Фактический остаток</span>
                  <MoneyInput
                    value={closeActualCash}
                    onValueChange={(_, draft) => setCloseActualCash(draft)}
                    placeholder="0,00"
                    className="eco-input l-money eco-cash-money-input"
                  />
                </label>
                <label className="eco-cash-field">
                  <span>Наличные по заказам</span>
                  <input className="eco-input l-money eco-cash-money-input" value={closeCashOrders || "0,00"} readOnly />
                </label>
                <label className="eco-cash-field">
                  <span>Карта по заказам</span>
                  <input className="eco-input l-money eco-cash-money-input" value={closeCardOrders || "0,00"} readOnly />
                </label>
                <label className="eco-cash-field eco-cash-field--wide">
                  <span>Комментарий к расхождению</span>
                  <textarea
                    rows={3}
                    value={closeComment}
                    onChange={(event) => setCloseComment(event.target.value)}
                    className="eco-input eco-cash-textarea"
                    placeholder="Например: пересчёт наличных, ошибка внесения, корректировка"
                  />
                </label>
              </div>
              <div className="eco-cash-close-summary">
                <span>Расхождение</span>
                <strong className={`l-money ${hasDiscrepancy ? "is-danger" : "is-ok"}`}>{hasEnteredActualCash ? money(discrepancyValue) : "—"}</strong>
              </div>
              <div className="eco-cash-action-row eco-cash-action-row--end">
                <button type="button" className="eco-btn eco-btn--danger" onClick={() => void requestCloseShift()} disabled={loading}>
                  {loading ? "Закрываем..." : "Закрыть смену"}
                </button>
              </div>
            </div>
          </div>
        </FlowSection>

        <FlowSection
          id="cash-actions"
          eyebrow="Операции"
          title="Операции по кассе"
          description="Добавьте расходный ордер или изъятие наличных, чтобы текущий остаток смены пересчитался сразу."
        >
          <div className="eco-cash-operation-grid">
            <div className="eco-card eco-card--padded" id="cash-expense-card">
              <div className="eco-card__head eco-card__head--plain">
                <div>
                  <h2>{editingExpenseOrderId ? "Редактировать черновик" : "Добавить расход"}</h2>
                  <p>
                    {editingExpenseOrderId
                      ? "Сохраните изменения в черновике, затем проведите ордер из таблицы документов."
                      : "Создаёт локальный расходный ордер и привязывает его к текущей смене."}
                  </p>
                </div>
                <EcoBadge tone={expensePaymentType === "cash" ? "warning" : "info"}>
                  {editingExpenseOrderId
                    ? "черновик"
                    : expensePaymentType === "cash"
                      ? "наличные"
                      : "карта"}
                </EcoBadge>
              </div>
              {expenseRefsError && <div className="eco-cash-warning">Локальные справочники не загрузились: {expenseRefsError}</div>}
              <div className="eco-cash-form-grid">
                <label className="eco-cash-field">
                  <span>Сумма</span>
                  <MoneyInput value={expenseAmount} onValueChange={(_, draft) => setExpenseAmount(draft)} placeholder="0,00" className="eco-input l-money eco-cash-money-input" />
                </label>
                <label className="eco-cash-field">
                  <span>Дата ордера</span>
                  <input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} className="eco-input" />
                </label>
                <label className="eco-cash-field">
                  <span>Статья расхода</span>
                  <select value={selectedExpenseItemId} onChange={(event) => setSelectedExpenseItemId(event.target.value)} className="eco-input" disabled={expenseRefsLoading}>
                    <option value="">Выберите статью</option>
                    {expenseItems.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <label className="eco-cash-field eco-cash-field--wide eco-cash-autocomplete">
                  <span>Контрагент</span>
                  <input
                    type="text"
                    value={selectedExpenseCounterparty ? selectedExpenseCounterparty.name : expenseCounterpartySearch}
                    onFocus={() => {
                      if (expenseCounterpartyOptions.length === 0) void loadCounterparties();
                    }}
                    onChange={(event) => {
                      setSelectedExpenseCounterparty(null);
                      setExpenseCounterpartySearch(event.target.value);
                    }}
                    className="eco-input"
                    placeholder="Найдите контрагента"
                  />
                  {!selectedExpenseCounterparty && (expenseCounterpartySearch.trim() || expenseCounterpartyOptions.length > 0) && (
                    <div className="eco-cash-autocomplete__list">
                      {counterpartyLoading ? (
                        <div className="eco-cash-autocomplete__empty">Загрузка...</div>
                      ) : expenseCounterpartyOptions.length > 0 ? (
                        expenseCounterpartyOptions.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => {
                              setSelectedExpenseCounterparty(item);
                              setExpenseCounterpartySearch("");
                            }}
                          >
                            {item.name}
                          </button>
                        ))
                      ) : (
                        <div className="eco-cash-autocomplete__empty">Ничего не найдено</div>
                      )}
                    </div>
                  )}
                </label>
                <label className="eco-cash-field eco-cash-field--wide">
                  <span>Основание / назначение</span>
                  <input value={expenseArticle} onChange={(event) => setExpenseArticle(event.target.value)} className="eco-input" placeholder="Например: оплата аренды за март" />
                </label>
                <div className="eco-cash-field">
                  <span>Тип оплаты</span>
                  <div className="eco-seg eco-cash-payment-seg">
                    <button type="button" className={`eco-seg-btn ${expensePaymentType === "cash" ? "is-active" : ""}`} onClick={() => setExpensePaymentType("cash")}>Наличные</button>
                    <button type="button" className={`eco-seg-btn ${expensePaymentType === "card" ? "is-active" : ""}`} onClick={() => setExpensePaymentType("card")}>Карта</button>
                  </div>
                </div>
                <label className="eco-cash-field">
                  <span>Вложение</span>
                  <input value={expenseAttachmentUrl} onChange={(event) => setExpenseAttachmentUrl(event.target.value)} className="eco-input" placeholder="Ссылка на чек" />
                </label>
                <label className="eco-cash-field eco-cash-field--wide">
                  <span>Комментарий</span>
                  <input value={expenseComment} onChange={(event) => setExpenseComment(event.target.value)} className="eco-input" />
                </label>
              </div>
              <div className="eco-cash-action-row eco-cash-action-row--end">
                {editingExpenseOrderId && (
                  <button type="button" className="eco-btn" onClick={() => resetExpenseForm()} disabled={loading}>
                    Отменить редактирование
                  </button>
                )}
                {!editingExpenseOrderId && (
                  <button type="button" className="eco-btn" onClick={handleSaveExpenseDraft} disabled={loading}>
                    Сохранить черновик
                  </button>
                )}
                <EcoButton type="button" variant="primary" onClick={editingExpenseOrderId ? handleSaveExpenseDraft : handleAddExpense} disabled={loading}>
                  <Plus aria-hidden className="eco-icon" />
                  {editingExpenseOrderId ? "Сохранить черновик" : "Добавить расход"}
                </EcoButton>
              </div>
            </div>

            <div className="eco-card eco-card--padded" id="cash-withdrawal-card">
              <div className="eco-card__head eco-card__head--plain">
                <div>
                  <h2>Сделать изъятие</h2>
                  <p>Изъятие наличных доступно владельцу и уменьшает ожидаемый остаток.</p>
                </div>
                <EcoBadge tone={user?.role === "owner" ? "success" : "neutral"}>
                  {user?.role === "owner" ? "доступно" : "только владелец"}
                </EcoBadge>
              </div>
              <div className="eco-cash-form-grid eco-cash-form-grid--compact">
                <label className="eco-cash-field">
                  <span>Сумма</span>
                  <MoneyInput value={withdrawAmount} onValueChange={(_, draft) => setWithdrawAmount(draft)} placeholder="0,00" className="eco-input l-money eco-cash-money-input" />
                </label>
                <label className="eco-cash-field">
                  <span>Причина</span>
                  <input value={withdrawReason} onChange={(event) => setWithdrawReason(event.target.value)} className="eco-input" placeholder="Например: инкассация" />
                </label>
                <label className="eco-cash-field eco-cash-field--wide">
                  <span>Комментарий</span>
                  <input value={withdrawComment} onChange={(event) => setWithdrawComment(event.target.value)} className="eco-input" />
                </label>
              </div>
              <div className="eco-cash-action-row eco-cash-action-row--end">
                <button type="button" onClick={handleAddWithdrawal} disabled={loading || user?.role !== "owner"} className="eco-btn eco-btn--primary">
                  <Plus aria-hidden className="eco-icon" />
                  Добавить изъятие
                </button>
              </div>
            </div>
          </div>
        </FlowSection>

        <FlowSection
          id="cash-journal"
          eyebrow="Журнал"
          title="Операции текущей смены"
          description="Все действия по кассе в хронологическом порядке."
        >
          {renderOperationsJournal()}
        </FlowSection>
      </>
    );
  }

  function renderDocuments() {
    return (
      <FlowSection
        id="cash-documents"
        eyebrow="Документы"
        title="Расходные ордера"
        description="Локальные документы кассы с поиском, фильтрами, статусами и постраничной навигацией."
      >
        <div className="eco-card eco-card--padded eco-cash-documents">
          <div className="eco-card__head eco-card__head--plain">
            <div>
              <div className="eco-page-kicker">Документы</div>
              <h2>Расходные ордера</h2>
              <p>
                <EcoBadge tone={cashoutsError ? "warning" : "info"}>Локальная БД</EcoBadge>{" "}
                Данные обновлены: {lastCashoutsSyncAt ? dateTime(lastCashoutsSyncAt) : "ожидает загрузки"}
              </p>
            </div>
            <div className="eco-actions">
              {isOpen && (
                <button
                  type="button"
                  className="eco-btn eco-btn--primary eco-btn--sm"
                  onClick={() => {
                    setActiveTab("active");
                    window.setTimeout(
                      () => document.getElementById("cash-expense-card")?.scrollIntoView({ behavior: "smooth", block: "start" }),
                      80
                    );
                  }}
                >
                  <Plus aria-hidden className="eco-icon" />
                  Создать расход
                </button>
              )}
              <button type="button" className="eco-btn eco-btn--ghost eco-btn--sm" onClick={() => window.print()}>
                <Printer aria-hidden className="eco-icon" />
                Печать
              </button>
              <button type="button" className="eco-btn eco-btn--primary" onClick={() => void loadCashouts()} disabled={cashoutsLoading}>
                <RefreshCw aria-hidden className="eco-icon" />
                {cashoutsLoading ? "Обновляем..." : "Обновить"}
              </button>
            </div>
          </div>
          <div className="eco-cash-filter-bar">
            <div className="eco-search-wrap eco-cash-search">
              <Search aria-hidden className="eco-icon" />
              <input
                value={cashoutSearch}
                onChange={(event) => {
                  setCashoutSearch(event.target.value);
                  setCashoutsOffset(0);
                }}
                placeholder="Поиск по номеру, контрагенту, назначению..."
                className="eco-input"
              />
            </div>
            <label className="eco-select-chip">
              <span>Период:</span>
              <select value={cashoutPeriodFilter} onChange={(event) => setCashoutPeriodFilter(event.target.value as CashoutPeriodFilter)} className="eco-select-inline">
                <option value="all">Все</option>
                <option value="today">Сегодня</option>
                <option value="month">Месяц</option>
              </select>
            </label>
            <label className="eco-select-chip">
              <span>Статус:</span>
              <select value={cashoutStatusFilter} onChange={(event) => setCashoutStatusFilter(event.target.value as CashoutStatusFilter)} className="eco-select-inline">
                <option value="all">Все</option>
                <option value="posted">Проведён</option>
                <option value="draft">Черновик</option>
                <option value="cancelled">Отменён</option>
              </select>
            </label>
            <label className="eco-select-chip">
              <span>Источник:</span>
              <select value={cashoutSourceFilter} onChange={(event) => setCashoutSourceFilter(event.target.value as CashoutSourceFilter)} className="eco-select-inline">
                <option value="all">Все</option>
                <option value="local">Локальная БД</option>
                <option value="moysklad">Архивный импорт</option>
              </select>
            </label>
            <label className="eco-select-chip">
              <span>Оплата:</span>
              <select value={cashoutTenderFilter} onChange={(event) => setCashoutTenderFilter(event.target.value as CashoutTenderFilter)} className="eco-select-inline">
                <option value="all">Все</option>
                <option value="cash">Только наличные</option>
                <option value="card">Карта</option>
              </select>
            </label>
            {filtersApplied && (
              <button type="button" className="eco-pill is-dashed" onClick={resetCashoutFilters}>
                <X aria-hidden className="eco-icon" />
                Сбросить
              </button>
            )}
            <span className="eco-pill">
              <Filter aria-hidden className="eco-icon" />
              Статья / контрагент / сумма
            </span>
          </div>

          {cashoutsError && (
            <div className="eco-cash-warning eco-cash-warning--row">
              Не удалось загрузить расходные ордера: {cashoutsError}
              <button type="button" className="eco-btn eco-btn--sm" onClick={() => void loadCashouts()}>
                Повторить
              </button>
            </div>
          )}

          {cashoutsLoading && cashouts.length === 0 ? (
            <div className="eco-cash-table-skeleton">
              {Array.from({ length: 6 }).map((_, index) => (
                <span key={index} />
              ))}
            </div>
          ) : visibleCashouts.length === 0 ? (
            renderEmptyState(
              "Расходных ордеров пока нет",
              "Они появятся после создания расхода или архивного импорта."
            )
          ) : (
            <>
              <div className="eco-table-wrap eco-cash-doc-table">
                <table className="eco-table">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Номер</th>
                      <th>Контрагент</th>
                      <th>Статья</th>
                      <th>Основание / назначение</th>
                      <th style={{ textAlign: "right" }}>Сумма</th>
                      <th>Статус</th>
                      <th style={{ width: 136 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCashouts.map((cashout) => {
                      const status = cashoutStatus(cashout);
                      return (
                        <tr key={cashout.id}>
                          <td>
                            <div className="l-mono">{dateOnly(cashout.moment)}</div>
                            <div className="eco-cash-secondary-text">{shortTime(cashout.moment)}</div>
                          </td>
                          <td>
                            <div className="l-mono eco-cash-doc-number">{cashout.name}</div>
                            <div className="eco-cash-secondary-text">{cashoutSourceLabel(cashout)}</div>
                          </td>
                          <td>
                            <div className="eco-cash-primary-text">{cashout.agentName || "—"}</div>
                            <div className="eco-cash-secondary-text">{cashout.organizationName || "организация не указана"}</div>
                          </td>
                          <td>{cashout.expenseItemName || "—"}</td>
                          <td>
                            <div className="eco-cash-purpose">{cashout.paymentPurpose || cashout.description || "—"}</div>
                          </td>
                          <td className="l-money eco-cash-money-cell">{moneyFromCents(cashout.sum)}</td>
                          <td>
                            <EcoBadge tone={status.tone} dot>{status.label}</EcoBadge>
                            <div className="eco-cash-secondary-text">
                              {(cashout.paymentType ?? "cash") === "cash" ? "наличные" : "карта"}
                            </div>
                          </td>
                          <td>
                            <div className="eco-row-actions is-visible">
                              {cashout.status === "draft" && (
                                <>
                                  <button type="button" className="eco-icon-btn" onClick={() => startEditExpenseOrder(cashout)} title="Редактировать черновик" aria-label="Редактировать черновик">
                                    <Pencil aria-hidden className="eco-icon" />
                                  </button>
                                  <button type="button" className="eco-icon-btn" onClick={() => void handlePostExpenseOrder(cashout.id)} title="Провести" aria-label="Провести">
                                    <Check aria-hidden className="eco-icon" />
                                  </button>
                                </>
                              )}
                              {cashout.status !== "cancelled" && (
                                <button type="button" className="eco-icon-btn" onClick={() => void handleCancelExpenseOrder(cashout.id)} title="Отменить" aria-label="Отменить">
                                  <X aria-hidden className="eco-icon" />
                                </button>
                              )}
                              <button type="button" className="eco-icon-btn" onClick={() => void copyText(cashout.name)} title="Скопировать номер" aria-label="Скопировать номер">
                                <Copy aria-hidden className="eco-icon" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="eco-cash-mobile-list">
                {visibleCashouts.map((cashout) => {
                  const status = cashoutStatus(cashout);
                  return (
                    <article key={cashout.id} className="eco-cash-mobile-card">
                      <div className="eco-cash-mobile-card__top">
                        <strong className="l-mono">{cashout.name}</strong>
                        <EcoBadge tone={status.tone}>{status.label}</EcoBadge>
                      </div>
                      <span>{dateOnly(cashout.moment)} · {cashout.agentName || "контрагент не указан"}</span>
                      <span>{cashout.expenseItemName || "статья не указана"} · {cashoutSourceLabel(cashout)}</span>
                      <strong className="l-money">{moneyFromCents(cashout.sum)}</strong>
                      <div className="eco-row-actions is-visible">
                        {cashout.status === "draft" && (
                          <>
                            <button type="button" className="eco-icon-btn" onClick={() => startEditExpenseOrder(cashout)} title="Редактировать черновик" aria-label="Редактировать черновик">
                              <Pencil aria-hidden className="eco-icon" />
                            </button>
                            <button type="button" className="eco-icon-btn" onClick={() => void handlePostExpenseOrder(cashout.id)} title="Провести" aria-label="Провести">
                              <Check aria-hidden className="eco-icon" />
                            </button>
                          </>
                        )}
                        {cashout.status !== "cancelled" && (
                          <button type="button" className="eco-icon-btn" onClick={() => void handleCancelExpenseOrder(cashout.id)} title="Отменить" aria-label="Отменить">
                            <X aria-hidden className="eco-icon" />
                          </button>
                        )}
                        <button type="button" className="eco-icon-btn" onClick={() => void copyText(cashout.name)} title="Скопировать номер" aria-label="Скопировать номер">
                          <Copy aria-hidden className="eco-icon" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}

          <div className="eco-cash-pagination">
            <span>Показано {cashoutPageStart}-{cashoutPageEnd} из {cashoutsTotal || cashouts.length}</span>
            <label className="eco-select-chip">
              <span>Строк:</span>
              <select
                value={cashoutsLimit}
                onChange={(event) => setCashoutsLimit(Number(event.target.value) as 25 | 50 | 100)}
                className="eco-select-inline"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
            <div className="eco-cash-pagination__controls">
              <button
                type="button"
                className="eco-icon-btn"
                onClick={() => setCashoutsOffset((prev) => Math.max(0, prev - cashoutsLimit))}
                disabled={cashoutsOffset === 0 || cashoutsLoading}
                aria-label="Предыдущая страница"
              >
                <ChevronLeft aria-hidden className="eco-icon" />
              </button>
              <span className="l-mono">{cashoutCurrentPage} / {cashoutTotalPages}</span>
              <button
                type="button"
                className="eco-icon-btn"
                onClick={() => setCashoutsOffset((prev) => prev + cashoutsLimit)}
                disabled={cashoutsOffset + cashouts.length >= cashoutsTotal || cashoutsLoading}
                aria-label="Следующая страница"
              >
                <ChevronRight aria-hidden className="eco-icon" />
              </button>
            </div>
          </div>
        </div>
      </FlowSection>
    );
  }

  return (
    <main className="eco-page eco-page--wide eco-cash-page">
      <section className="eco-page-head eco-cash-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <span>Финансы</span>
            <span className="sep">/</span>
            <span className="cur">Касса</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">{pageTitle}</h1>
            <EcoBadge tone={headerStatus.tone} dot>
              {headerStatus.label}
            </EcoBadge>
            {lastClosedShift != null && (
              <EcoBadge tone="neutral">
                В кассе {money(cashInRegister)}
              </EcoBadge>
            )}
          </div>
          <p className="eco-page-subtitle">
            Рабочий экран смены: статус кассы, ключевые суммы, операции, расходные ордера и история закрытий.
          </p>
        </div>
        <div className="eco-cash-tabs eco-seg" aria-label="Сценарий кассы">
          <button
            type="button"
            className={`eco-seg-btn ${activeTab === "opening" ? "is-active" : ""}`}
            onClick={() => setActiveTab("opening")}
            disabled={isOpen}
          >
            Открытие
          </button>
          <button
            type="button"
            className={`eco-seg-btn ${activeTab === "active" ? "is-active" : ""}`}
            onClick={() => setActiveTab("active")}
            disabled={!isOpen}
          >
            Активная смена
          </button>
          <button
            type="button"
            className={`eco-seg-btn ${activeTab === "closed" ? "is-active" : ""}`}
            onClick={() => setActiveTab("closed")}
          >
            Закрытые
          </button>
        </div>
      </section>

      {error && (
        <div className="eco-cash-error eco-cash-error--page">
          <span>Не удалось загрузить кассу: {error}</span>
          <button type="button" className="eco-btn eco-btn--sm" onClick={() => window.location.reload()}>
            Повторить
          </button>
        </div>
      )}

      <div className="eco-grid eco-grid--kpi eco-cash-kpis">
        <EcoKpi
          label="Статус смены"
          value={isOpen ? "Открыта" : "Закрыта"}
          sub={shift ? `${shift.openedBy.name} · ${shortTime(shift.openedAt)}` : "смена не открыта"}
          tone={isOpen ? "success" : "neutral"}
        />
        <EcoKpi label="Стартовый остаток" value={money(openingValue)} sub="наличные в кассе" tone="rust" />
        <EcoKpi
          label="Расходы наличными"
          value={signedMoney(totals.cashExpenses)}
          sub={`${cashExpenseOperations.length} операций`}
          tone={totals.cashExpenses > 0 ? "warning" : "neutral"}
        />
        <EcoKpi
          label="Изъятия"
          value={signedMoney(totals.withdrawals)}
          sub={`${withdrawalOperations.length} операций`}
          tone={totals.withdrawals > 0 ? "warning" : "neutral"}
        />
        <EcoKpi
          label="Ожидаемый остаток"
          value={money(expectedCashValue)}
          sub="расчёт по текущим данным"
          tone="info"
        />
        <EcoKpi
          label="Факт / расхождение"
          value={actualCashValue == null ? "—" : money(actualCashValue)}
          sub={hasEnteredActualCash ? `Расхождение ${money(discrepancyValue)}` : "вводится при закрытии"}
          tone={hasDiscrepancy ? "danger" : "neutral"}
        />
      </div>

      {activeTab === "opening" && renderOpeningScenario()}
      {activeTab === "active" && renderActiveScenario()}
      {activeTab === "closed" && (
        <FlowSection
          id="cash-closed"
          eyebrow="Закрытые"
          title="Закрытые смены"
          description="Архив смен с деталями операций и итоговыми суммами."
        >
          {renderHistory()}
        </FlowSection>
      )}

      {renderDocuments()}

      {activeTab !== "closed" && (
        <FlowSection
          id="cash-history"
          eyebrow="История"
          title="История смен"
          description="Закрытые смены, расхождения, комментарии и операции."
        >
          {renderHistory()}
        </FlowSection>
      )}
    </main>
  );
}
