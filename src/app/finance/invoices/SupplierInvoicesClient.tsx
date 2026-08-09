"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Landmark,
  Link2,
  Loader2,
  PackagePlus,
  Printer,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { EcoBadge, EcoButton, EcoInput, EcoKpi, EcoSelect, EcoTable } from "@/components/platform/EcoUI";
import { formatServiceDate, toServiceDateInput } from "@/lib/date-time";

type InvoiceStatus =
  | "draft"
  | "unpaid"
  | "partial"
  | "paid"
  | "overdue"
  | "cancelled"
  | "requisites_review"
  | "ready_to_pay"
  | "tbank_draft_created"
  | "tbank_waiting_confirmation"
  | "tbank_confirmed"
  | "tbank_sent"
  | "tbank_processing"
  | "payment_error"
  | "bank_rejected"
  | "payment_cancelled"
  | "requires_review"
  | "paid_manually";
type PaymentType = "cash" | "card" | "bank_transfer";
type SortBy = "invoiceDate" | "dueDate" | "sum" | "supplier" | "status";
type SortDir = "asc" | "desc";

type SupplierInvoicePayment = {
  id: string;
  amount: number;
  amountCents: number;
  paymentDate: string;
  paymentType: PaymentType;
  comment: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
  cashExpenseOrder: null | {
    id: string;
    number: string;
    status: string;
  };
};

type TBankPayment = {
  id: string;
  provider: string;
  mode: "draft" | "direct" | string;
  status: string;
  providerStatus: string;
  tbankDocumentId: string;
  tbankPaymentId: string;
  tbankRequestId: string;
  amount: number;
  amountCents: number;
  fromAccountNumberMasked: string;
  recipientName: string;
  recipientInn: string;
  recipientKpp: string;
  recipientAccount: string;
  recipientBik: string;
  paymentPurpose: string;
  confirmationUrl: string;
  createdAt: string;
  sentAt: string;
  confirmedAt: string;
  paidAt: string;
  failedAt: string;
  errorMessage: string;
};

type SupplierInvoice = {
  id: string;
  branchId: string;
  branchName?: string;
  number: string;
  invoiceDate: string;
  dueDate: string;
  status: InvoiceStatus;
  storedStatus?: string;
  sum: number;
  paid: number;
  remaining: number;
  totalAmountCents: number;
  paidAmountCents: number;
  remainingAmountCents: number;
  source: string;
  comment: string;
  attachmentUrl: string;
  counterpartyName: string;
  supplierRequisites: {
    id: string;
    name: string;
    legalTitle: string;
    inn: string;
    kpp: string;
    checkingAccount: string;
    bik: string;
    correspondentAccount: string;
    bankName: string;
    bankLocation: string;
    companyType: string;
    archived: boolean;
  };
  createdAt: string;
  updatedAt: string;
  document: {
    id: string;
    name: string;
    type: string;
    documentDate: string;
    moment: string;
    applicable: boolean;
    storeName: string;
    counterpartyName: string;
    sum: number;
    positions: {
      id: string;
      name: string;
      quantity: number;
      price: number;
      sum: number;
      slotName: string;
    }[];
  };
  payments: SupplierInvoicePayment[];
  tbankPayments: TBankPayment[];
};

type TBankPrecheck = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  integration: {
    configured: boolean;
    connected: boolean;
    tokenConfigured: boolean;
    tokenPreview: string;
    debitAccountNumberMasked: string;
    mode: string;
    sandbox: boolean;
    productionMode: boolean;
    lastCheckedAt: string;
    lastCheckStatus: string;
    lastCheckMessage: string;
    accounts: Array<{
      id: string;
      accountNumberMasked: string;
      accountName: string;
      bankName: string;
      currency: string;
      isDefault: boolean;
      isActive: boolean;
    }>;
  };
  activePayment: null | TBankPayment & { label?: string };
  payment: null | {
    supplierInvoiceId: string;
    amount: number;
    amountCents: number;
    supplierName: string;
    recipientName: string;
    recipientInn: string;
    recipientKpp: string;
    recipientAccount: string;
    recipientBik: string;
    recipientCorrAccount: string;
    recipientBankName: string;
    paymentPurpose: string;
    paymentPurposeMaxLength: number;
    fromAccountNumberMasked: string;
    fromAccountId: string;
    invoice: SupplierInvoice;
  };
};

type InvoiceResponse = {
  meta?: { total: number; limit: number; offset: number; mode?: "branch" | "all" };
  invoices?: SupplierInvoice[];
  error?: string;
};

type Filters = {
  search: string;
  status: "all" | InvoiceStatus;
  supplier: string;
  period: "all" | "today" | "week" | "month";
  minAmount: string;
  maxAmount: string;
  document: string;
  withoutReceipt: boolean;
  overdueOnly: boolean;
  source: "all" | "local" | "receipt" | "import" | "legacy_import";
};

const DEFAULT_FILTERS: Filters = {
  search: "",
  status: "all",
  supplier: "",
  period: "all",
  minAmount: "",
  maxAmount: "",
  document: "",
  withoutReceipt: false,
  overdueOnly: false,
  source: "all",
};

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return await res.json() as T;
  } catch {
    return null;
  }
}

function formatMoney(value: number | null | undefined) {
  return `${Number(value ?? 0).toLocaleString("ru-RU", { maximumFractionDigits: 0 })} ₽`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const formatted = formatServiceDate(value);
  return formatted === "—" ? value : formatted;
}

function todayInput() {
  return toServiceDateInput(new Date());
}

function paymentAmountInput(value: number) {
  return String(Math.max(0, Math.round(value * 100) / 100));
}

function plural(value: number, forms: [string, string, string]) {
  const n = Math.abs(value) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

function statusMeta(status: InvoiceStatus) {
  if (status === "paid") return { label: "Оплачено", tone: "success" as const };
  if (status === "paid_manually") return { label: "Оплачено вручную", tone: "success" as const };
  if (status === "partial") return { label: "Частично оплачено", tone: "info" as const };
  if (status === "overdue") return { label: "Просрочено", tone: "danger" as const };
  if (status === "cancelled") return { label: "Отменено", tone: "neutral" as const };
  if (status === "draft") return { label: "Черновик", tone: "neutral" as const };
  if (status === "requisites_review") return { label: "Проверить реквизиты", tone: "warning" as const };
  if (status === "ready_to_pay") return { label: "Готов к оплате", tone: "info" as const };
  if (status === "tbank_draft_created") return { label: "Черновик T-Bank", tone: "info" as const };
  if (status === "tbank_waiting_confirmation") return { label: "Ожидает T-Bank", tone: "info" as const };
  if (status === "tbank_confirmed") return { label: "Подтверждён", tone: "success" as const };
  if (status === "tbank_sent") return { label: "Отправлен в банк", tone: "info" as const };
  if (status === "tbank_processing") return { label: "В исполнении", tone: "info" as const };
  if (status === "payment_error") return { label: "Ошибка оплаты", tone: "danger" as const };
  if (status === "bank_rejected") return { label: "Отклонён банком", tone: "danger" as const };
  if (status === "payment_cancelled") return { label: "Отменён в T-Bank", tone: "neutral" as const };
  if (status === "requires_review") return { label: "Требует проверки", tone: "warning" as const };
  return { label: "Не оплачено", tone: "warning" as const };
}

function tbankStatusMeta(payment?: TBankPayment | null) {
  if (!payment) return { label: "не создан", tone: "neutral" as const };
  if (payment.status === "paid") return { label: "оплачен", tone: "success" as const };
  if (payment.status === "payment_error") return { label: "ошибка", tone: "danger" as const };
  if (payment.status === "bank_rejected") return { label: "отклонён", tone: "danger" as const };
  if (payment.status === "cancelled") return { label: "отменён", tone: "neutral" as const };
  if (payment.status === "confirmed") return { label: "подтверждён", tone: "success" as const };
  if (payment.status === "sent_to_bank") return { label: "отправлен", tone: "info" as const };
  if (payment.status === "processing") return { label: "в исполнении", tone: "info" as const };
  if (payment.status === "draft_created" || payment.status === "waiting_confirmation") return { label: "ждёт подтверждения", tone: "info" as const };
  if (payment.status === "draft_creating") return { label: "создаётся", tone: "info" as const };
  return { label: payment.status, tone: "neutral" as const };
}

function latestTBankPayment(invoice?: SupplierInvoice | null) {
  return invoice?.tbankPayments?.[0] ?? null;
}

function sourceLabel(value: string) {
  if (value === "local") return "Локальная БД";
  if (value === "import") return "Импорт";
  if (value === "legacy_import") return "Архивный импорт";
  return "Приёмка";
}

function paymentTypeLabel(value: PaymentType) {
  if (value === "card") return "карта";
  if (value === "bank_transfer") return "перевод";
  return "наличные";
}

function periodRange(period: Filters["period"]) {
  const now = new Date();
  const today = todayInput();
  if (period === "today") return { dateFrom: today, dateTo: today };
  if (period === "week") {
    const from = new Date(now);
    from.setDate(now.getDate() - 6);
    return { dateFrom: toServiceDateInput(from), dateTo: today };
  }
  if (period === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { dateFrom: toServiceDateInput(from), dateTo: today };
  }
  return { dateFrom: "", dateTo: "" };
}

function hasActiveFilters(filters: Filters) {
  return Boolean(
    filters.search.trim() ||
    filters.status !== "all" ||
    filters.supplier.trim() ||
    filters.period !== "all" ||
    filters.minAmount.trim() ||
    filters.maxAmount.trim() ||
    filters.document.trim() ||
    filters.withoutReceipt ||
    filters.overdueOnly ||
    filters.source !== "all"
  );
}

export default function SupplierInvoicesClient() {
  const searchParams = useSearchParams();
  const requestedInvoiceId = searchParams.get("invoice");
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([]);
  const [total, setTotal] = useState(0);
  const [allBranchesMode, setAllBranchesMode] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortBy, setSortBy] = useState<SortBy>("invoiceDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [limit, setLimit] = useState<25 | 50 | 100>(50);
  const [offset, setOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(requestedInvoiceId);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(todayInput());
  const [paymentType, setPaymentType] = useState<PaymentType>("cash");
  const [paymentComment, setPaymentComment] = useState("");
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tbankPrecheck, setTbankPrecheck] = useState<TBankPrecheck | null>(null);
  const [tbankPurpose, setTbankPurpose] = useState("");
  const [tbankAccountId, setTbankAccountId] = useState("");
  const [tbankWorking, setTbankWorking] = useState<"precheck" | "create" | "refresh" | "manual" | null>(null);

  const activeInvoice = useMemo(
    () => invoices.find((invoice) => invoice.id === openId) ?? null,
    [invoices, openId]
  );

  const summary = useMemo(() => {
    const payable = invoices.filter((invoice) => invoice.remainingAmountCents > 0 && invoice.status !== "cancelled");
    const paid = invoices.filter((invoice) => invoice.status === "paid");
    const partial = invoices.filter((invoice) => invoice.status === "partial");
    const overdue = invoices.filter((invoice) => invoice.status === "overdue");
    return {
      visibleSum: invoices.reduce((sum, invoice) => sum + invoice.sum, 0),
      payableSum: payable.reduce((sum, invoice) => sum + invoice.remaining, 0),
      payableCount: payable.length,
      paidSum: paid.reduce((sum, invoice) => sum + invoice.sum, 0),
      paidCount: paid.length,
      partialSum: partial.reduce((sum, invoice) => sum + invoice.remaining, 0),
      partialCount: partial.length,
      overdueSum: overdue.reduce((sum, invoice) => sum + invoice.remaining, 0),
      overdueCount: overdue.length,
    };
  }, [invoices]);

  const selectedInvoices = useMemo(
    () => invoices.filter((invoice) => selectedIds.includes(invoice.id)),
    [invoices, selectedIds]
  );
  const pageStart = total === 0 ? 0 : offset + 1;
  const pageEnd = Math.min(offset + invoices.length, total || invoices.length);
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil((total || invoices.length || 1) / limit));
  const allPageSelected = invoices.length > 0 && invoices.every((invoice) => selectedIds.includes(invoice.id));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        sortBy,
        sortDir,
      });
      const range = periodRange(filters.period);
      if (filters.search.trim()) params.set("search", filters.search.trim());
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.supplier.trim()) params.set("supplier", filters.supplier.trim());
      if (range.dateFrom) params.set("dateFrom", range.dateFrom);
      if (range.dateTo) params.set("dateTo", range.dateTo);
      if (filters.minAmount.trim()) params.set("minAmount", filters.minAmount.trim().replace(",", "."));
      if (filters.maxAmount.trim()) params.set("maxAmount", filters.maxAmount.trim().replace(",", "."));
      if (filters.document.trim()) params.set("document", filters.document.trim());
      if (filters.withoutReceipt) params.set("withoutReceipt", "1");
      if (filters.overdueOnly) params.set("overdueOnly", "1");
      if (filters.source !== "all") params.set("source", filters.source);
      const res = await fetch(`/api/local-inventory/supplier-invoices?${params.toString()}`, { cache: "no-store" });
      const data = await readJson<InvoiceResponse>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось загрузить счета поставщиков");
      const rows = Array.isArray(data?.invoices) ? data.invoices : [];
      setInvoices(rows);
      setTotal(data?.meta?.total ?? rows.length);
      setAllBranchesMode(data?.meta?.mode === "all");
      setSelectedIds((current) => current.filter((id) => rows.some((invoice) => invoice.id === id)));
      if (requestedInvoiceId && rows.some((invoice) => invoice.id === requestedInvoiceId)) {
        setOpenId(requestedInvoiceId);
      }
    } catch (e) {
      setInvoices([]);
      setTotal(0);
      setAllBranchesMode(false);
      setError(e instanceof Error ? e.message : "Не удалось загрузить счета поставщиков");
    } finally {
      setLoading(false);
    }
  }, [filters, limit, offset, requestedInvoiceId, sortBy, sortDir]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (activeInvoice) {
      setPaymentAmount(paymentAmountInput(activeInvoice.remaining));
      setPaymentDate(todayInput());
      setPaymentType("cash");
      setPaymentComment("");
      setActionError(null);
      setTbankPrecheck(null);
      setTbankPurpose("");
      setTbankAccountId("");
      setTbankWorking(null);
    }
  }, [activeInvoice]);

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setOffset(0);
  }

  function toggleSort(nextSort: SortBy) {
    if (sortBy === nextSort) {
      setSortDir((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSortBy(nextSort);
      setSortDir(nextSort === "supplier" || nextSort === "status" ? "asc" : "desc");
    }
    setOffset(0);
  }

  function openInvoice(invoice: SupplierInvoice, paymentMode?: "full" | "partial") {
    if (allBranchesMode) {
      setNotice("В режиме «Все филиалы» счета доступны только для просмотра. Выберите конкретный филиал для действий.");
      return;
    }
    setOpenId(invoice.id);
    setPaymentAmount(paymentMode === "partial" ? "" : paymentAmountInput(invoice.remaining));
    setPaymentDate(todayInput());
    setPaymentType("cash");
    setPaymentComment("");
    setActionError(null);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeInvoice) return;
    setPaymentSubmitting(true);
    setActionError(null);
    setNotice(null);
    try {
      const amount = Number(paymentAmount.replace(",", "."));
      const res = await fetch(`/api/local-inventory/supplier-invoices/${activeInvoice.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          paymentDate,
          paymentType,
          comment: paymentComment,
        }),
      });
      const data = await readJson<SupplierInvoice & { error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось провести оплату");
      if (!data?.id) throw new Error("Сервер не вернул обновлённый счёт");
      setInvoices((current) => current.map((invoice) => invoice.id === data.id ? data : invoice));
      setOpenId(data.id);
      setNotice(data.remainingAmountCents > 0 ? "Частичная оплата сохранена" : "Счёт полностью оплачен");
      setPaymentAmount(paymentAmountInput(data.remaining));
      setPaymentComment("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось провести оплату");
    } finally {
      setPaymentSubmitting(false);
    }
  }

  async function cancelInvoice(invoice: SupplierInvoice) {
    if (invoice.payments.length > 0) {
      setActionError("Нельзя отменить счёт с сохранёнными оплатами");
      openInvoice(invoice);
      return;
    }
    const ok = window.confirm(`Отменить счёт ${invoice.number || "без номера"}?`);
    if (!ok) return;
    setActionError(null);
    try {
      const res = await fetch(`/api/local-inventory/supplier-invoices/${invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const data = await readJson<SupplierInvoice & { error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось отменить счёт");
      if (!data?.id) throw new Error("Сервер не вернул обновлённый счёт");
      setInvoices((current) => current.map((item) => item.id === data.id ? data : item));
      setNotice("Счёт отменён");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось отменить счёт");
      openInvoice(invoice);
    }
  }

  async function runTBankPrecheck(invoice = activeInvoice): Promise<TBankPrecheck | null> {
    if (!invoice) return null;
    setTbankWorking("precheck");
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/supplier-invoices/${invoice.id}/tbank/precheck`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAccountId: tbankAccountId || undefined,
          paymentPurpose: tbankPurpose || undefined,
        }),
      });
      const data = await readJson<TBankPrecheck & { error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось проверить платёж T-Bank");
      if (!data) throw new Error("Сервер не вернул результат проверки");
      setTbankPrecheck(data);
      if (data.payment?.paymentPurpose && !tbankPurpose) setTbankPurpose(data.payment.paymentPurpose);
      const defaultAccount = data.integration.accounts.find((account) => account.isDefault) ?? data.integration.accounts[0];
      if (!tbankAccountId && defaultAccount?.id) setTbankAccountId(defaultAccount.id);
      if (!data.ok && data.errors.length > 0) setActionError(data.errors[0]);
      return data;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось проверить платёж T-Bank");
      return null;
    } finally {
      setTbankWorking(null);
    }
  }

  async function createTBankDraft() {
    if (!activeInvoice) return;
    setTbankWorking("create");
    setActionError(null);
    setNotice(null);
    try {
      const precheck = tbankPrecheck?.ok ? tbankPrecheck : await runTBankPrecheck(activeInvoice);
      if (!precheck?.ok) {
        setTbankWorking(null);
        return;
      }
      const res = await fetch(`/api/supplier-invoices/${activeInvoice.id}/tbank/create-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAccountId: tbankAccountId || undefined,
          paymentPurpose: tbankPurpose || precheck.payment?.paymentPurpose,
        }),
      });
      const data = await readJson<{ ok?: boolean; error?: string; payment?: TBankPayment; action?: { type: string; url?: string; label?: string } }>(res);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Не удалось создать черновик в T-Bank");
      setNotice(data.action?.type === "link"
        ? "Черновик создан. Откройте T-Business для подтверждения платежа."
        : "Черновик создан. Подтвердите платёж в T-Business.");
      setTbankPrecheck(null);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось создать черновик в T-Bank");
    } finally {
      setTbankWorking(null);
    }
  }

  async function refreshTBankStatus(payment: TBankPayment) {
    if (!activeInvoice) return;
    setTbankWorking("refresh");
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/supplier-invoices/${activeInvoice.id}/tbank/payments/${payment.id}/refresh-status`, {
        method: "POST",
      });
      const data = await readJson<{ ok?: boolean; error?: string; payment?: TBankPayment }>(res);
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "Не удалось обновить статус T-Bank");
      setNotice(`Статус T-Bank обновлён: ${tbankStatusMeta(data.payment ?? payment).label}`);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось обновить статус T-Bank");
    } finally {
      setTbankWorking(null);
    }
  }

  async function markPaidManually() {
    if (!activeInvoice) return;
    const ok = window.confirm(`Отметить счёт ${activeInvoice.number || "без номера"} оплаченным вручную?`);
    if (!ok) return;
    setTbankWorking("manual");
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/supplier-invoices/${activeInvoice.id}/mark-paid-manually`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: "Оплата подтверждена вручную" }),
      });
      const data = await readJson<SupplierInvoice & { error?: string }>(res);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось отметить счёт оплаченным");
      if (!data?.id) throw new Error("Сервер не вернул обновлённый счёт");
      setInvoices((current) => current.map((invoice) => invoice.id === data.id ? data : invoice));
      setNotice("Счёт отмечен оплаченным вручную");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не удалось отметить счёт оплаченным");
    } finally {
      setTbankWorking(null);
    }
  }

  function exportSelected() {
    const rows = selectedInvoices.length > 0 ? selectedInvoices : invoices;
    const csv = [
      ["Номер", "Дата", "Поставщик", "Документ", "Сумма", "Оплачено", "К оплате", "Статус"].join(";"),
      ...rows.map((invoice) => [
        invoice.number,
        invoice.invoiceDate,
        invoice.counterpartyName,
        invoice.document?.name ?? "",
        invoice.sum,
        invoice.paid,
        invoice.remaining,
        statusMeta(invoice.status).label,
      ].map((cell) => `"${String(cell ?? "").replaceAll("\"", "\"\"")}"`).join(";")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "supplier-invoices.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function renderSortLabel(label: string, key: SortBy) {
    return (
      <button type="button" className="eco-invoices-sort" onClick={() => toggleSort(key)}>
        {label}
        {sortBy === key && <span>{sortDir === "asc" ? "↑" : "↓"}</span>}
      </button>
    );
  }

  return (
    <div className="eco-invoices-page">
      <section className="eco-page-head eco-invoices-head">
        <div>
          <div className="eco-page-crumbs">
            <span>Финансы</span>
            <span className="sep">/</span>
            <span className="cur">Счета поставщиков</span>
          </div>
          <h1 className="eco-page-title">Счета поставщиков</h1>
          <p className="eco-page-subtitle">
            Счета поставщиков, оплаты и связанные складские документы.
          </p>
        </div>
        <div className="eco-page-actions">
          <span className="eco-invoices-source-note">Счета создаются из документов приёмки</span>
          <Link href="/inventory/receipts" className="eco-btn eco-btn--primary">
            <PackagePlus aria-hidden className="eco-icon" />
            Создать приёмку
          </Link>
          <EcoButton type="button" onClick={() => void load()} disabled={loading}>
            <RefreshCw aria-hidden className={`eco-icon ${loading ? "eco-invoices-spin" : ""}`} />
            Обновить
          </EcoButton>
        </div>
      </section>

      {notice && (
        <div className="eco-invoices-notice">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Закрыть уведомление">
            <X aria-hidden className="eco-icon" />
          </button>
        </div>
      )}

      <div className="eco-grid eco-invoices-kpis">
        {loading && invoices.length === 0 ? (
          Array.from({ length: 6 }).map((_, index) => <div key={index} className="eco-invoices-skeleton" />)
        ) : (
          <>
            <EcoKpi label="Всего счетов" value={total.toLocaleString("ru-RU")} sub={`показано ${invoices.length}`} />
            <EcoKpi
              label="К оплате"
              value={formatMoney(summary.payableSum)}
              sub={`${summary.payableCount} ${plural(summary.payableCount, ["счёт", "счёта", "счетов"])}`}
              tone={summary.payableSum > 0 ? "warning" : "neutral"}
            />
            <EcoKpi
              label="Просрочено"
              value={formatMoney(summary.overdueSum)}
              sub={summary.overdueCount > 0 ? `${summary.overdueCount} требуют оплаты` : "нет просроченных"}
              tone={summary.overdueCount > 0 ? "danger" : "neutral"}
            />
            <EcoKpi
              label="Оплачено"
              value={formatMoney(summary.paidSum)}
              sub={`${summary.paidCount} за выбранный период`}
              tone={summary.paidCount > 0 ? "success" : "neutral"}
            />
            <EcoKpi
              label="Частично оплачено"
              value={formatMoney(summary.partialSum)}
              sub={`${summary.partialCount} с остатком`}
              tone={summary.partialCount > 0 ? "info" : "neutral"}
            />
            <EcoKpi label="Сумма выборки" value={formatMoney(summary.visibleSum)} sub="по текущей странице" />
          </>
        )}
      </div>

      <section className="eco-card eco-card--padded eco-invoices-filters">
        <form
          className="eco-invoices-filter-grid"
          onSubmit={(event) => {
            event.preventDefault();
            setOffset(0);
            void load();
          }}
        >
          <label className="eco-invoices-search">
            <span>Поиск</span>
            <div className="eco-invoices-search-input">
              <Search aria-hidden className="eco-icon" />
              <EcoInput
                type="search"
                value={filters.search}
                onChange={(event) => updateFilter("search", event.target.value)}
                placeholder="Поиск по номеру, поставщику, счёту, приёмке или сумме…"
              />
            </div>
          </label>
          <label>
            <span>Статус</span>
            <EcoSelect value={filters.status} onChange={(event) => updateFilter("status", event.target.value as Filters["status"])}>
              <option value="all">Все статусы</option>
              <option value="unpaid">Не оплачено</option>
              <option value="partial">Частично оплачено</option>
              <option value="paid">Оплачено</option>
              <option value="overdue">Просрочено</option>
              <option value="cancelled">Отменено</option>
            </EcoSelect>
          </label>
          <label>
            <span>Поставщик</span>
            <EcoInput
              value={filters.supplier}
              onChange={(event) => updateFilter("supplier", event.target.value)}
              placeholder="Название поставщика"
            />
          </label>
          <label>
            <span>Период</span>
            <EcoSelect value={filters.period} onChange={(event) => updateFilter("period", event.target.value as Filters["period"])}>
              <option value="all">Любой период</option>
              <option value="today">Сегодня</option>
              <option value="week">7 дней</option>
              <option value="month">Текущий месяц</option>
            </EcoSelect>
          </label>
          <label>
            <span>Сумма от</span>
            <EcoInput
              inputMode="decimal"
              value={filters.minAmount}
              onChange={(event) => updateFilter("minAmount", event.target.value)}
              placeholder="0"
            />
          </label>
          <label>
            <span>Сумма до</span>
            <EcoInput
              inputMode="decimal"
              value={filters.maxAmount}
              onChange={(event) => updateFilter("maxAmount", event.target.value)}
              placeholder="100000"
            />
          </label>
          <label>
            <span>Складской документ</span>
            <EcoInput
              value={filters.document}
              onChange={(event) => updateFilter("document", event.target.value)}
              placeholder="ПР-20260523-001"
            />
          </label>
          <label>
            <span>Источник</span>
            <EcoSelect value={filters.source} onChange={(event) => updateFilter("source", event.target.value as Filters["source"])}>
              <option value="all">Все источники</option>
              <option value="receipt">Приёмка</option>
              <option value="local">Локальная БД</option>
              <option value="import">Импорт</option>
              <option value="legacy_import">Архивный импорт</option>
            </EcoSelect>
          </label>
          <div className="eco-invoices-filter-toggles">
            <label className="eco-invoices-check">
              <input
                type="checkbox"
                checked={filters.overdueOnly}
                onChange={(event) => updateFilter("overdueOnly", event.target.checked)}
              />
              <span>Только просроченные</span>
            </label>
            <label className="eco-invoices-check">
              <input
                type="checkbox"
                checked={filters.withoutReceipt}
                onChange={(event) => updateFilter("withoutReceipt", event.target.checked)}
              />
              <span>Только без приёмки</span>
            </label>
          </div>
          <div className="eco-invoices-filter-actions">
            <EcoButton type="submit" variant="primary">
              <SlidersHorizontal aria-hidden className="eco-icon" />
              Применить
            </EcoButton>
            <EcoButton
              type="button"
              onClick={() => {
                setFilters(DEFAULT_FILTERS);
                setOffset(0);
              }}
              disabled={!hasActiveFilters(filters)}
            >
              Сбросить
            </EcoButton>
          </div>
        </form>
      </section>

      <section className="eco-card eco-card--padded eco-invoices-documents">
        <div className="eco-card__head eco-card__head--plain eco-invoices-documents-head">
          <div>
            <h2>Реестр счетов</h2>
            <p>Контроль задолженности, оплат и связей с приёмками.</p>
          </div>
          <div className="eco-page-actions">
            <span className="l-meta">Показано {pageStart}–{pageEnd} из {total || invoices.length}</span>
            <EcoButton type="button" size="sm" onClick={exportSelected} disabled={invoices.length === 0}>
              <Download aria-hidden className="eco-icon" />
              Экспорт
            </EcoButton>
            <EcoButton type="button" size="sm" onClick={() => window.print()} disabled={invoices.length === 0}>
              <Printer aria-hidden className="eco-icon" />
              Печать
            </EcoButton>
          </div>
        </div>

        {allBranchesMode && (
          <div className="eco-invoices-empty" role="status">
            <strong>Режим «Все филиалы»</strong>
            <span>Показан сводный реестр. Оплата, отмена и переход к приёмке доступны после выбора конкретного филиала.</span>
          </div>
        )}

        {selectedIds.length > 0 && (
          <div className="eco-invoices-bulkbar">
            <strong>{selectedIds.length} выбрано</strong>
            <span>{formatMoney(selectedInvoices.reduce((sum, invoice) => sum + invoice.remaining, 0))} к оплате</span>
            <EcoButton type="button" size="sm" onClick={exportSelected}>
              <Download aria-hidden className="eco-icon" />
              Экспортировать
            </EcoButton>
            <EcoButton type="button" size="sm" onClick={() => setSelectedIds([])}>
              Снять выбор
            </EcoButton>
          </div>
        )}

        {error && (
          <div className="eco-invoices-error">
            <div>
              <strong>Не удалось загрузить счета поставщиков</strong>
              <span>Проверьте локальную базу и попробуйте ещё раз.</span>
            </div>
            <EcoButton type="button" onClick={() => void load()}>Повторить</EcoButton>
          </div>
        )}

        {loading && invoices.length === 0 && (
          <div className="eco-invoices-table-skeleton" aria-label="Загружаем счета поставщиков">
            {Array.from({ length: 7 }).map((_, index) => <span key={index} />)}
          </div>
        )}

        {!loading && !error && invoices.length === 0 && (
          <div className="eco-invoices-empty">
            <FileText aria-hidden className="eco-invoices-empty__icon" />
            <strong>{hasActiveFilters(filters) ? "Ничего не найдено" : "Счетов поставщиков пока нет"}</strong>
            <span>
              {hasActiveFilters(filters)
                ? "Попробуйте изменить запрос или сбросить фильтры."
                : "Создайте счёт из приёмки или добавьте его вручную, когда ручное создание будет включено."}
            </span>
            <div className="eco-actions">
              {hasActiveFilters(filters) ? (
                <EcoButton type="button" onClick={() => setFilters(DEFAULT_FILTERS)}>Сбросить фильтры</EcoButton>
              ) : (
                <>
                  <Link href="/inventory/receipts" className="eco-btn eco-btn--primary">Перейти к приёмке</Link>
                  <Link href="/inventory/receipts" className="eco-btn">Создать счёт из приёмки</Link>
                </>
              )}
            </div>
          </div>
        )}

        {!error && invoices.length > 0 && (
          <>
            <EcoTable className="eco-invoices-table">
              <thead>
                <tr>
                  <th className="eco-invoices-select-cell">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={(event) => setSelectedIds(event.target.checked ? invoices.map((invoice) => invoice.id) : [])}
                      aria-label="Выбрать все счета на странице"
                    />
                  </th>
                  <th>{renderSortLabel("№ / дата", "invoiceDate")}</th>
                  <th>{renderSortLabel("Поставщик", "supplier")}</th>
                  {allBranchesMode && <th>Филиал</th>}
                  <th>Основание / складской документ</th>
                  <th className="l-money">{renderSortLabel("Сумма", "sum")}</th>
                  <th className="l-money">Оплачено</th>
                  <th className="l-money">К оплате</th>
                  <th>{renderSortLabel("Срок оплаты", "dueDate")}</th>
                  <th>{renderSortLabel("Статус", "status")}</th>
                  <th>T-Bank</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => {
                  const meta = statusMeta(invoice.status);
                  const tbankPayment = latestTBankPayment(invoice);
                  const tbankMeta = tbankStatusMeta(tbankPayment);
                  return (
                    <tr key={invoice.id} className="eco-invoices-row" onClick={() => openInvoice(invoice)}>
                      <td className="eco-invoices-select-cell" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(invoice.id)}
                          onChange={() => toggleSelected(invoice.id)}
                          aria-label={`Выбрать счёт ${invoice.number || invoice.id}`}
                        />
                      </td>
                      <td>
                        <div className="eco-invoices-doc-number">Счёт {invoice.number || "без номера"}</div>
                        <div className="eco-invoices-secondary">{formatDate(invoice.invoiceDate)} · {sourceLabel(invoice.source)}</div>
                      </td>
                      <td>
                        <div className="eco-invoices-primary">{invoice.counterpartyName || "без поставщика"}</div>
                        <div className="eco-invoices-secondary">{invoice.document.storeName || "склад не указан"}</div>
                      </td>
                      {allBranchesMode && <td><div className="eco-invoices-primary">{invoice.branchName || invoice.branchId}</div></td>}
                      <td>
                        {invoice.document?.id ? (
                          <Link
                            href={`/inventory/receipts?document=${invoice.document.id}`}
                            className="eco-invoices-doc-link"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Link2 aria-hidden className="eco-icon" />
                            <span>{invoice.document.name}</span>
                            <EcoBadge tone={invoice.document.applicable ? "success" : "warning"}>
                              {invoice.document.applicable ? "Проведена" : "Черновик"}
                            </EcoBadge>
                          </Link>
                        ) : (
                          <span className="eco-invoices-doc-warning">Не связан с приёмкой</span>
                        )}
                      </td>
                      <td className="l-money">{formatMoney(invoice.sum)}</td>
                      <td className="l-money">{formatMoney(invoice.paid)}</td>
                      <td className={`l-money ${invoice.remainingAmountCents > 0 ? "is-warning" : "is-ok"}`}>
                        {formatMoney(invoice.remaining)}
                      </td>
                      <td>
                        <div className="eco-invoices-primary">{invoice.dueDate ? formatDate(invoice.dueDate) : "—"}</div>
                        {invoice.status === "overdue" && <div className="eco-invoices-danger">требует действия</div>}
                      </td>
                      <td><EcoBadge tone={meta.tone}>{meta.label}</EcoBadge></td>
                      <td>
                        <EcoBadge tone={tbankMeta.tone}>{tbankMeta.label}</EcoBadge>
                        {tbankPayment?.tbankDocumentId && (
                          <div className="eco-invoices-secondary">doc {tbankPayment.tbankDocumentId}</div>
                        )}
                      </td>
                      <td onClick={(event) => event.stopPropagation()}>
                        <div className="eco-invoices-actions">
                          <button type="button" className="eco-icon-btn" onClick={() => openInvoice(invoice)} title="Открыть" aria-label="Открыть">
                            <Eye aria-hidden className="eco-icon" />
                          </button>
                          {invoice.remainingAmountCents > 0 && invoice.status !== "cancelled" && (
                            <button type="button" className="eco-icon-btn eco-icon-btn--accent" onClick={() => openInvoice(invoice, "full")} title="Оплатить" aria-label="Оплатить">
                              <CreditCard aria-hidden className="eco-icon" />
                            </button>
                          )}
                          {!allBranchesMode && (
                            <Link href={`/inventory/receipts?document=${invoice.document.id}`} className="eco-icon-btn" title="Открыть приёмку" aria-label="Открыть приёмку">
                              <ExternalLink aria-hidden className="eco-icon" />
                            </Link>
                          )}
                          {invoice.status !== "paid" && invoice.status !== "cancelled" && (
                            <button type="button" className="eco-icon-btn" onClick={() => void cancelInvoice(invoice)} title="Отменить" aria-label="Отменить">
                              <Ban aria-hidden className="eco-icon" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </EcoTable>

            <div className="eco-invoices-mobile-list">
              {invoices.map((invoice) => {
                const meta = statusMeta(invoice.status);
                const tbankMeta = tbankStatusMeta(latestTBankPayment(invoice));
                return (
                  <button key={invoice.id} type="button" className="eco-invoices-mobile-card" onClick={() => openInvoice(invoice)}>
                    <span className="eco-invoices-mobile-card__top">
                      <span>
                        <b>Счёт {invoice.number || "без номера"}</b>
                        <small>{formatDate(invoice.invoiceDate)} · {invoice.counterpartyName || "без поставщика"}</small>
                      </span>
                      <EcoBadge tone={meta.tone}>{meta.label}</EcoBadge>
                    </span>
                    <span className="eco-invoices-mobile-card__money">
                      <span>Сумма <b>{formatMoney(invoice.sum)}</b></span>
                      <span>К оплате <b>{formatMoney(invoice.remaining)}</b></span>
                    </span>
                    <span className="eco-invoices-doc-link">
                      <Link2 aria-hidden className="eco-icon" />
                      {invoice.document.name}
                    </span>
                    <span className="eco-invoices-doc-link">
                      <Landmark aria-hidden className="eco-icon" />
                      T-Bank: {tbankMeta.label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="eco-invoices-pagination">
              <span>Показано {pageStart}–{pageEnd} из {total || invoices.length}</span>
              <label className="eco-select-chip">
                <span>Строк</span>
                <select
                  className="eco-input eco-select-inline"
                  value={limit}
                  onChange={(event) => {
                    setLimit(Number(event.target.value) as 25 | 50 | 100);
                    setOffset(0);
                  }}
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <div className="eco-invoices-pagination__controls">
                <EcoButton type="button" size="sm" onClick={() => setOffset((current) => Math.max(0, current - limit))} disabled={offset === 0 || loading}>
                  <ChevronLeft aria-hidden className="eco-icon" />
                </EcoButton>
                <span className="l-mono">{currentPage} / {totalPages}</span>
                <EcoButton type="button" size="sm" onClick={() => setOffset((current) => current + limit)} disabled={offset + invoices.length >= total || loading}>
                  <ChevronRight aria-hidden className="eco-icon" />
                </EcoButton>
              </div>
            </div>
          </>
        )}
      </section>

      {activeInvoice && (
        <>
          <button type="button" className="eco-invoices-drawer-backdrop" onClick={() => setOpenId(null)} aria-label="Закрыть детали" />
          <aside className="eco-invoices-drawer" aria-label={`Детали счёта ${activeInvoice.number || activeInvoice.id}`}>
            <div className="eco-invoices-drawer__head">
              <div>
                <div className="eco-page-kicker">Счёт поставщика</div>
                <h2>Счёт {activeInvoice.number || "без номера"}</h2>
                <p>{activeInvoice.counterpartyName || "без поставщика"} · {formatMoney(activeInvoice.sum)}</p>
              </div>
              <div className="eco-invoices-drawer__head-actions">
                <EcoBadge tone={statusMeta(activeInvoice.status).tone}>{statusMeta(activeInvoice.status).label}</EcoBadge>
                <button type="button" className="eco-icon-btn" onClick={() => setOpenId(null)} aria-label="Закрыть">
                  <X aria-hidden className="eco-icon" />
                </button>
              </div>
            </div>

            {actionError && <div className="eco-invoices-error eco-invoices-error--compact">{actionError}</div>}

            <div className="eco-invoices-drawer__summary">
              <span><b>{formatMoney(activeInvoice.remaining)}</b>К оплате</span>
              <span><b>{formatMoney(activeInvoice.paid)}</b>Оплачено</span>
              <span><b>{formatMoney(activeInvoice.sum)}</b>Сумма</span>
            </div>

            <div className="eco-invoices-drawer__body">
              <section className="eco-invoices-detail-block">
                <h3>Основная информация</h3>
                <div className="eco-invoices-definition-grid">
                  <span><b>Дата счёта</b>{formatDate(activeInvoice.invoiceDate)}</span>
                  <span><b>Срок оплаты</b>{activeInvoice.dueDate ? formatDate(activeInvoice.dueDate) : "не указан"}</span>
                  <span><b>Источник</b>{sourceLabel(activeInvoice.source)}</span>
                  <span><b>Создан</b>{formatDate(activeInvoice.createdAt.slice(0, 10))}</span>
                </div>
              </section>

              <section className="eco-invoices-detail-block">
                <h3>Поставщик</h3>
                <p>{activeInvoice.counterpartyName || "Поставщик не указан"}</p>
              </section>

              <section className="eco-invoices-detail-block eco-tbank-block">
                <div className="eco-tbank-block__head">
                  <div>
                    <h3>Оплата через T-Bank</h3>
                    <p>Эко-платформа создаёт черновик, подтверждение проходит только на стороне T-Business.</p>
                  </div>
                  <EcoBadge tone={tbankStatusMeta(latestTBankPayment(activeInvoice)).tone}>
                    {tbankStatusMeta(latestTBankPayment(activeInvoice)).label}
                  </EcoBadge>
                </div>

                <div className="eco-tbank-safety">
                  <ShieldCheck aria-hidden className="eco-icon" />
                  <span>СМС-коды и банковские подтверждения не вводятся в Эко-платформе.</span>
                </div>

                <div className="eco-tbank-summary">
                  <span><b>Сумма</b>{formatMoney(activeInvoice.remaining)}</span>
                  <span><b>Получатель</b>{activeInvoice.supplierRequisites.legalTitle || activeInvoice.counterpartyName || "не указан"}</span>
                  <span><b>ИНН / КПП</b>{activeInvoice.supplierRequisites.inn || "—"} / {activeInvoice.supplierRequisites.kpp || "0"}</span>
                  <span><b>БИК</b>{activeInvoice.supplierRequisites.bik || "—"}</span>
                  <span><b>Счёт получателя</b>{activeInvoice.supplierRequisites.checkingAccount || "—"}</span>
                  <span><b>Банк</b>{activeInvoice.supplierRequisites.bankName || "—"}</span>
                </div>

                {latestTBankPayment(activeInvoice) && (
                  <div className="eco-tbank-current">
                    <div>
                      <strong>{tbankStatusMeta(latestTBankPayment(activeInvoice)).label}</strong>
                      <span>
                        {latestTBankPayment(activeInvoice)?.tbankDocumentId
                          ? `Документ ${latestTBankPayment(activeInvoice)?.tbankDocumentId}`
                          : "Черновик связан со счётом"}
                        {latestTBankPayment(activeInvoice)?.providerStatus ? ` · ${latestTBankPayment(activeInvoice)?.providerStatus}` : ""}
                      </span>
                    </div>
                    <div className="eco-actions">
                      {latestTBankPayment(activeInvoice)?.confirmationUrl && (
                        <a className="eco-btn eco-btn--sm" href={latestTBankPayment(activeInvoice)?.confirmationUrl} target="_blank" rel="noreferrer">
                          <ExternalLink aria-hidden className="eco-icon" />
                          Открыть T-Business
                        </a>
                      )}
                      <EcoButton
                        type="button"
                        size="sm"
                        onClick={() => {
                          const payment = latestTBankPayment(activeInvoice);
                          if (payment) void refreshTBankStatus(payment);
                        }}
                        disabled={tbankWorking !== null}
                      >
                        {tbankWorking === "refresh" ? <Loader2 aria-hidden className="eco-icon eco-invoices-spin" /> : <RefreshCw aria-hidden className="eco-icon" />}
                        Обновить статус
                      </EcoButton>
                    </div>
                  </div>
                )}

                {tbankPrecheck && (
                  <div className="eco-tbank-confirm">
                    <div className="eco-tbank-confirm__head">
                      <div>
                        <strong>Проверьте платёж</strong>
                        <span>{tbankPrecheck.integration.connected ? "Интеграция подключена" : "Интеграция требует настройки"}</span>
                      </div>
                      <EcoBadge tone={tbankPrecheck.ok ? "success" : "warning"}>
                        {tbankPrecheck.ok ? "можно создать" : "нужна проверка"}
                      </EcoBadge>
                    </div>

                    {tbankPrecheck.integration.accounts.length > 0 && (
                      <label className="eco-tbank-field">
                        <span>Счёт списания</span>
                        <EcoSelect
                          value={tbankAccountId}
                          onChange={(event) => {
                            setTbankAccountId(event.target.value);
                            setTbankPrecheck(null);
                          }}
                        >
                          <option value="">Счёт по умолчанию</option>
                          {tbankPrecheck.integration.accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.accountNumberMasked} · {account.currency}{account.accountName ? ` · ${account.accountName}` : ""}
                            </option>
                          ))}
                        </EcoSelect>
                      </label>
                    )}

                    <label className="eco-tbank-field">
                      <span>Назначение платежа</span>
                      <textarea
                        className="eco-input eco-tbank-purpose"
                        value={tbankPurpose}
                        maxLength={tbankPrecheck.payment?.paymentPurposeMaxLength ?? 210}
                        onChange={(event) => {
                          setTbankPurpose(event.target.value);
                          const warning = "Назначение изменено. Запустите проверку ещё раз перед созданием черновика.";
                          setTbankPrecheck((current) => current
                            ? { ...current, ok: false, warnings: current.warnings.includes(warning) ? current.warnings : [...current.warnings, warning] }
                            : current);
                        }}
                      />
                      <small>{tbankPurpose.length} / {tbankPrecheck.payment?.paymentPurposeMaxLength ?? 210}</small>
                    </label>

                    {(tbankPrecheck.errors.length > 0 || tbankPrecheck.warnings.length > 0) && (
                      <div className="eco-tbank-messages">
                        {tbankPrecheck.errors.map((item) => (
                          <span key={item} className="is-error"><AlertTriangle aria-hidden className="eco-icon" />{item}</span>
                        ))}
                        {tbankPrecheck.warnings.map((item) => (
                          <span key={item}><AlertTriangle aria-hidden className="eco-icon" />{item}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="eco-tbank-actions">
                  <EcoButton type="button" onClick={() => void runTBankPrecheck()} disabled={tbankWorking !== null}>
                    {tbankWorking === "precheck" ? <Loader2 aria-hidden className="eco-icon eco-invoices-spin" /> : <CheckCircle2 aria-hidden className="eco-icon" />}
                    Проверить реквизиты
                  </EcoButton>
                  <EcoButton
                    type="button"
                    variant="primary"
                    onClick={() => void createTBankDraft()}
                    disabled={tbankWorking !== null || (tbankPrecheck !== null && !tbankPrecheck.ok)}
                  >
                    {tbankWorking === "create" ? <Loader2 aria-hidden className="eco-icon eco-invoices-spin" /> : <Send aria-hidden className="eco-icon" />}
                    Создать черновик в T-Bank
                  </EcoButton>
                  <EcoButton type="button" variant="ghost" onClick={() => void markPaidManually()} disabled={tbankWorking !== null}>
                    <Landmark aria-hidden className="eco-icon" />
                    Отметить вручную
                  </EcoButton>
                </div>
              </section>

              <section className="eco-invoices-detail-block">
                <h3>Связанный складской документ</h3>
                {activeInvoice.document?.id ? (
                  <Link href={`/inventory/receipts?document=${activeInvoice.document.id}`} className="eco-invoices-linked-document">
                    <div>
                      <b>{activeInvoice.document.name}</b>
                      <span>{formatDate(activeInvoice.document.documentDate)} · {activeInvoice.document.storeName || "склад не указан"}</span>
                    </div>
                    <EcoBadge tone={activeInvoice.document.applicable ? "success" : "warning"}>
                      {activeInvoice.document.applicable ? "Проведена" : "Черновик"}
                    </EcoBadge>
                    <ExternalLink aria-hidden className="eco-icon" />
                  </Link>
                ) : (
                  <div className="eco-invoices-warning-line">
                    <span>Не связан с приёмкой</span>
                    <EcoButton type="button" size="sm">Связать с документом</EcoButton>
                  </div>
                )}
              </section>

              <section className="eco-invoices-detail-block">
                <h3>Позиции счёта</h3>
                {activeInvoice.document.positions.length > 0 ? (
                  <div className="eco-invoices-position-list">
                    {activeInvoice.document.positions.map((position) => (
                      <div key={position.id}>
                        <span>
                          <b>{position.name}</b>
                          <small>{position.quantity.toLocaleString("ru-RU")} шт. · {formatMoney(position.price)}</small>
                        </span>
                        <strong>{formatMoney(position.sum)}</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>Позиции не загружены для этого документа.</p>
                )}
              </section>

              <section className="eco-invoices-detail-block">
                <h3>Оплаты</h3>
                {activeInvoice.payments.length > 0 ? (
                  <div className="eco-invoices-payment-list">
                    {activeInvoice.payments.map((payment) => (
                      <div key={payment.id}>
                        <span>
                          <b>{formatDate(payment.paymentDate)} · {formatMoney(payment.amount)}</b>
                          <small>
                            {paymentTypeLabel(payment.paymentType)}
                            {payment.cashExpenseOrder ? ` · ${payment.cashExpenseOrder.number}` : ""}
                            {payment.comment ? ` · ${payment.comment}` : ""}
                          </small>
                        </span>
                        {payment.cashExpenseOrder && <EcoBadge tone="success">РКО</EcoBadge>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p>Оплат по счёту пока нет.</p>
                )}
              </section>

              <section className="eco-invoices-detail-block">
                <h3>Комментарии и история</h3>
                <p>{activeInvoice.comment || "Комментариев нет. Последнее обновление: " + formatDate(activeInvoice.updatedAt.slice(0, 10))}</p>
              </section>
            </div>

            {activeInvoice.remainingAmountCents > 0 && activeInvoice.status !== "cancelled" && (
              <form className="eco-invoices-payment-form" onSubmit={(event) => void submitPayment(event)}>
                <div className="eco-card__head eco-card__head--plain">
                  <div>
                    <h3>Провести оплату</h3>
                    <p>Можно оплатить полностью или сохранить частичную оплату.</p>
                  </div>
                </div>
                <div className="eco-invoices-payment-grid">
                  <label>
                    <span>Сумма оплаты</span>
                    <EcoInput
                      required
                      inputMode="decimal"
                      value={paymentAmount}
                      onChange={(event) => setPaymentAmount(event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Дата оплаты</span>
                    <EcoInput type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
                  </label>
                  <label>
                    <span>Тип оплаты</span>
                    <EcoSelect value={paymentType} onChange={(event) => setPaymentType(event.target.value as PaymentType)}>
                      <option value="cash">Наличные</option>
                      <option value="card">Карта</option>
                      <option value="bank_transfer">Перевод</option>
                    </EcoSelect>
                  </label>
                  <label className="eco-invoices-payment-comment">
                    <span>Комментарий</span>
                    <textarea className="eco-input" value={paymentComment} onChange={(event) => setPaymentComment(event.target.value)} placeholder="Назначение, чек или примечание" />
                  </label>
                </div>
                {paymentType === "cash" && (
                  <div className="eco-invoices-warning-line">
                    Наличная оплата создаст расходный ордер в текущей кассовой смене.
                  </div>
                )}
                <div className="eco-invoices-drawer__footer">
                  <EcoButton type="button" onClick={() => setPaymentAmount(paymentAmountInput(activeInvoice.remaining))}>
                    Весь остаток
                  </EcoButton>
                  <EcoButton type="submit" variant={activeInvoice.status === "overdue" ? "danger" : "primary"} disabled={paymentSubmitting}>
                    {paymentSubmitting && <Loader2 aria-hidden className="eco-icon eco-invoices-spin" />}
                    Оплатить
                  </EcoButton>
                </div>
              </form>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
