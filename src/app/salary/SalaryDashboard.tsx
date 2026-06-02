"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileText,
  History,
  Loader2,
  PanelRightOpen,
  Printer,
  RefreshCw,
  Save,
  Search,
  Settings2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import MoneyInput, { parseMoneyInput } from "@/components/MoneyInput";
import {
  EcoBadge,
  EcoButton,
  EcoInput,
  EcoKpi,
  EcoSelect,
} from "@/components/platform/EcoUI";
import { SERVICE_TIME_ZONE, formatServiceDateTime } from "@/lib/date-time";
import {
  getCurrentMonthRange,
  toLocalDateInputValue,
  useOwnerUsers,
  type OwnerUser,
} from "../cabinet/useOwnerUsers";

type UserRole = "owner" | "admin" | "master";
type PayrollMode = "owner" | "employee";
type SalaryTab = "calculation" | "workdays" | "rules" | "rates" | "history";
type StatusKey =
  | "not_calculated"
  | "calculated"
  | "has_errors"
  | "awaiting_payment"
  | "paid"
  | "closed";

type PayrollByLogin = {
  shiftTotalCents: number;
  pieceworkCents: number;
  bonusPenaltyCents: number;
  paidOutCents: number;
  remainingCents: number;
  totalCents: number;
  shiftsCount: number;
};

type VehicleRecord = {
  demandId: string;
  demandName: string;
  date: string;
  agentName: string;
  sumCents: number;
  works?: { name: string; quantity: number; priceCents: number }[];
  products?: { name: string; pathName?: string; quantity: number; priceCents: number }[];
  earningsByLogin: Record<string, number>;
  pieceworkBreakdownByLogin: Record<
    string,
    { category: "work" | "product"; label: string; quantity: number; amountCents: number }[]
  >;
};

type Payroll = {
  dateFrom: string;
  dateTo: string;
  byLogin: Record<string, PayrollByLogin>;
  vehicleHistory?: VehicleRecord[];
  cashoutHistory?: {
    cashoutId: string;
    name: string;
    date: string;
    agentName: string;
    sumCents: number;
    paymentPurpose: string;
    description: string;
    login: string;
  }[];
};

type ShiftRateItem = {
  login: string;
  name: string;
  amountCents: number | null;
};

type WorkingDayItem = {
  id: string;
  userLogin: string;
  date: string;
  createdByLogin: string;
  source?: "scheduled" | "actual" | "both";
  removable?: boolean;
};

type PieceworkRuleItem = {
  targetType: "service" | "product_group";
  targetId: string;
  targetName: string;
  role: "master" | "admin";
  mode: "fixed" | "percent";
  fixedCents: number | null;
  percentBasisPoints: number | null;
  isDefault: boolean;
};

type DraftRule = {
  mode: "fixed" | "percent";
  value: string;
};

type HistoryItem = {
  id: string;
  entityType: string;
  entityId: string;
  action: "create" | "update" | "delete";
  oldValue: unknown;
  newValue: unknown;
  performedByLogin: string;
  createdAt: string;
};

type PayrollRow = {
  login: string;
  name: string;
  role: UserRole;
  payroll: PayrollByLogin;
  rateCents: number | null;
  workDaysCount: number;
  actualShiftsCount: number;
  status: StatusKey;
};

const EMPTY_PAYROLL_ROW: PayrollByLogin = {
  shiftTotalCents: 0,
  pieceworkCents: 0,
  bonusPenaltyCents: 0,
  paidOutCents: 0,
  remainingCents: 0,
  totalCents: 0,
  shiftsCount: 0,
};

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const PAYROLL_PAID_STORAGE_KEY = "eco-payroll-paid-overrides";
const PAYROLL_CLOSED_STORAGE_KEY = "eco-payroll-closed-periods";

const TAB_META: Record<
  SalaryTab,
  {
    label: string;
    description: string;
    icon: typeof ClipboardList;
  }
> = {
  calculation: {
    label: "Расчёт",
    description: "Итоговые выплаты по сотрудникам",
    icon: ClipboardList,
  },
  workdays: {
    label: "Рабочие дни",
    description: "Календарь рабочих дней и фактических смен",
    icon: CalendarDays,
  },
  rules: {
    label: "Правила сдельной части",
    description: "Проценты и фиксированные начисления",
    icon: Settings2,
  },
  rates: {
    label: "Ставки",
    description: "Базовые ставки сотрудников",
    icon: Banknote,
  },
  history: {
    label: "История выплат",
    description: "Закрытые периоды, выплаты и изменения",
    icon: History,
  },
};

const STATUS_META: Record<StatusKey, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  not_calculated: { label: "Не рассчитано", tone: "neutral" },
  calculated: { label: "Рассчитано", tone: "success" },
  has_errors: { label: "Есть ошибки", tone: "danger" },
  awaiting_payment: { label: "Ожидает выплаты", tone: "warning" },
  paid: { label: "Выплачено", tone: "success" },
  closed: { label: "Закрытый период", tone: "neutral" },
};

function normalizeLogin(value: string) {
  return value.trim().toLowerCase();
}

function normalizeRole(value: string): UserRole {
  if (value === "owner" || value === "admin" || value === "master") return value;
  return "master";
}

function roleLabel(role: string) {
  if (role === "owner") return "Владелец";
  if (role === "admin") return "Администратор";
  return "Сотрудник";
}

function roleShortLabel(role: string) {
  if (role === "owner") return "Владелец";
  if (role === "admin") return "Админ";
  return "Мастер";
}

function formatMoney(amountCents: number) {
  const amount = amountCents / 100;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amount);
}

function formatRateInput(amountCents: number | null) {
  if (amountCents == null) return "";
  return Number.isInteger(amountCents / 100)
    ? String(amountCents / 100)
    : (amountCents / 100).toFixed(2);
}

function formatFixedInput(amountCents: number | null) {
  return formatRateInput(amountCents);
}

function formatPercentInput(percentBasisPoints: number | null) {
  if (percentBasisPoints == null) return "";
  const value = percentBasisPoints / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(parsed);
}

function formatDateTime(value: string) {
  const formatted = formatServiceDateTime(value);
  return formatted === "—" ? value : formatted;
}

function formatDays(count: number) {
  const abs = Math.abs(count);
  const suffix =
    abs % 10 === 1 && abs % 100 !== 11
      ? "день"
      : abs % 10 >= 2 && abs % 10 <= 4 && (abs % 100 < 10 || abs % 100 >= 20)
        ? "дня"
        : "дней";
  return `${count} ${suffix}`;
}

function formatHours(count: number) {
  return `${count} ч`;
}

function getMonthBounds(year: number, month: number) {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  return {
    dateFrom: toLocalDateInputValue(first),
    dateTo: toLocalDateInputValue(last),
    daysInMonth: last.getDate(),
    startPad: (first.getDay() + 6) % 7,
  };
}

function getMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: SERVICE_TIME_ZONE,
    month: "long",
    year: "numeric",
  }).format(date);
}

function getPresetRange(preset: "current" | "previous" | "7" | "30") {
  const now = new Date();
  if (preset === "current") return getCurrentMonthRange();
  if (preset === "previous") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { dateFrom: toLocalDateInputValue(first), dateTo: toLocalDateInputValue(last) };
  }
  const days = preset === "7" ? 7 : 30;
  const from = new Date(now);
  from.setDate(now.getDate() - days + 1);
  return { dateFrom: toLocalDateInputValue(from), dateTo: toLocalDateInputValue(now) };
}

function getDateRangeKeys(startKey: string, endKey: string) {
  const start = new Date(`${startKey}T00:00:00`);
  const end = new Date(`${endKey}T00:00:00`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const from = start <= end ? start : end;
  const to = start <= end ? end : start;
  const keys: string[] = [];
  for (const date = new Date(from); date <= to; date.setDate(date.getDate() + 1)) {
    keys.push(toLocalDateInputValue(date));
  }
  return keys;
}

function getWeekRangeKeys(dateKey: string, monthDate: Date) {
  const date = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return [];
  const dayOffset = (date.getDay() + 6) % 7;
  const start = new Date(date);
  start.setDate(date.getDate() - dayOffset);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const month = monthDate.getMonth();
  const year = monthDate.getFullYear();
  return getDateRangeKeys(toLocalDateInputValue(start), toLocalDateInputValue(end)).filter((key) => {
    const parsed = new Date(`${key}T00:00:00`);
    return parsed.getFullYear() === year && parsed.getMonth() === month;
  });
}

function ruleKey(rule: Pick<PieceworkRuleItem, "targetType" | "targetId" | "role">) {
  return `${rule.targetType}:${rule.targetId}:${rule.role}`;
}

function makeRuleDraft(rule: PieceworkRuleItem): DraftRule {
  return {
    mode: rule.mode,
    value: rule.mode === "fixed" ? formatFixedInput(rule.fixedCents) : formatPercentInput(rule.percentBasisPoints),
  };
}

function targetTypeLabel(targetType: PieceworkRuleItem["targetType"]) {
  return targetType === "service" ? "Услуга" : "Группа товаров";
}

function ruleBasisLabel(rule: Pick<PieceworkRuleItem, "targetType">, mode: DraftRule["mode"]) {
  if (mode === "fixed") return rule.targetType === "service" ? "за услугу" : "за единицу";
  return rule.targetType === "service" ? "от суммы продажи" : "от чистой прибыли";
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const error = payload as { error?: unknown };
    throw new Error(typeof error?.error === "string" ? error.error : fallbackMessage);
  }

  return payload as T;
}

function StatusBadge({ status }: { status: StatusKey }) {
  const meta = STATUS_META[status];
  return (
    <EcoBadge tone={meta.tone} dot>
      {meta.label}
    </EcoBadge>
  );
}

function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="eco-payroll-empty">
      <strong>{title}</strong>
      <span>{text}</span>
      {action && <div>{action}</div>}
    </div>
  );
}

function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="eco-payroll-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

function FieldLabel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="eco-payroll-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function getRowStatus(params: {
  closed: boolean;
  hasData: boolean;
  payroll: PayrollByLogin;
  role: UserRole;
  rateCents: number | null;
  workDaysCount: number;
  paidOverride: boolean;
}): StatusKey {
  const { closed, hasData, payroll, role, rateCents, workDaysCount, paidOverride } = params;
  if (closed) return "closed";
  if (paidOverride || (payroll.paidOutCents > 0 && payroll.remainingCents <= 0)) return "paid";
  if (!hasData || payroll.totalCents === 0) return "not_calculated";
  if (role !== "owner" && rateCents == null && workDaysCount > 0) return "has_errors";
  if (payroll.remainingCents > 0) return "awaiting_payment";
  return "calculated";
}

function summarizeHistoryValue(value: unknown) {
  if (!value || typeof value !== "object") return "—";
  const record = value as Record<string, unknown>;
  const bits: string[] = [];

  if (typeof record.userLogin === "string") bits.push(record.userLogin);
  if (typeof record.targetName === "string") bits.push(record.targetName);
  if (typeof record.role === "string") bits.push(roleShortLabel(record.role));
  if (typeof record.date === "string") bits.push(formatDate(record.date));
  if (typeof record.effectiveFrom === "string") bits.push(`с ${formatDate(record.effectiveFrom)}`);
  if (typeof record.mode === "string") bits.push(record.mode === "fixed" ? "Фикс" : "Процент");
  if (typeof record.amountCents === "number") bits.push(formatMoney(record.amountCents));
  if (typeof record.fixedCents === "number") bits.push(formatMoney(record.fixedCents));
  if (typeof record.percentBasisPoints === "number") bits.push(`${record.percentBasisPoints / 100}%`);
  if (typeof record.comment === "string" && record.comment) bits.push(record.comment);

  return bits.length > 0 ? bits.join(" · ") : "Изменение данных";
}

export default function SalaryDashboard({
  role,
  login,
  name,
  isOwner,
}: {
  role: string;
  login: string;
  name: string;
  isOwner: boolean;
}) {
  const defaults = getCurrentMonthRange();
  const [mode, setMode] = useState<PayrollMode>(isOwner ? "owner" : "employee");
  const [activeTab, setActiveTab] = useState<SalaryTab>("calculation");
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [userFilter, setUserFilter] = useState("");
  const [payroll, setPayroll] = useState<Payroll | null>(null);
  const [payrollWorkingDays, setPayrollWorkingDays] = useState<WorkingDayItem[]>([]);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [payrollError, setPayrollError] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [rates, setRates] = useState<ShiftRateItem[]>([]);
  const [ratesLoading, setRatesLoading] = useState(false);
  const [rules, setRules] = useState<PieceworkRuleItem[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [draftRules, setDraftRules] = useState<Record<string, DraftRule>>({});
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({});
  const [rulesSaving, setRulesSaving] = useState(false);
  const [rulesMessage, setRulesMessage] = useState<string | null>(null);
  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleRoleFilter, setRuleRoleFilter] = useState("all");
  const [ruleModeFilter, setRuleModeFilter] = useState("all");
  const [ruleStatusFilter, setRuleStatusFilter] = useState("all");
  const [calendarDate, setCalendarDate] = useState(() => new Date());
  const [calendarLogin, setCalendarLogin] = useState(isOwner ? "" : login);
  const [calendarFilter, setCalendarFilter] = useState<"all" | "working" | "actual" | "absence">("all");
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateInputValue(new Date()));
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set([toLocalDateInputValue(new Date())]));
  const [selectionAnchor, setSelectionAnchor] = useState(() => toLocalDateInputValue(new Date()));
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
  const [calendarSaveStatus, setCalendarSaveStatus] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const [calendarDays, setCalendarDays] = useState<WorkingDayItem[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [dayComments, setDayComments] = useState<Record<string, string>>({});
  const [shiftOverrides, setShiftOverrides] = useState<Set<string>>(() => new Set());
  const [absenceOverrides, setAbsenceOverrides] = useState<Set<string>>(() => new Set());
  const [selectedLogin, setSelectedLogin] = useState<string | null>(null);
  const [drawerComment, setDrawerComment] = useState("");
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentType, setAdjustmentType] = useState<"bonus" | "penalty_manual">("bonus");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentComment, setAdjustmentComment] = useState("");
  const [adjustmentDate, setAdjustmentDate] = useState(() => toLocalDateInputValue(new Date()));
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const [paidOverrides, setPaidOverrides] = useState<Set<string>>(() => new Set());
  const [closedPeriods, setClosedPeriods] = useState<Set<string>>(() => new Set());
  const [rateDrawerLogin, setRateDrawerLogin] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const autoLoadedRef = useRef(false);
  const dragStartDateRef = useRef<string | null>(null);
  const suppressNextClickRef = useRef(false);

  const viewingAsEmployee = mode === "employee";
  const canManagePayroll = isOwner && mode === "owner";
  const roleAsUserRole = normalizeRole(role);
  const currentUser = useMemo<OwnerUser>(
    () => ({ login, name: name || login, role: roleAsUserRole }),
    [login, name, roleAsUserRole]
  );
  const { users } = useOwnerUsers(isOwner);
  const teamUsers = useMemo(() => {
    const fromApi = users.map((user) => ({ ...user, role: normalizeRole(user.role ?? "master") }));
    if (!isOwner) return [currentUser];
    if (fromApi.some((user) => normalizeLogin(user.login) === normalizeLogin(login))) return fromApi;
    return [{ ...currentUser, role: roleAsUserRole }, ...fromApi];
  }, [currentUser, isOwner, login, roleAsUserRole, users]);

  const userByLogin = useMemo(() => {
    const map = new Map<string, OwnerUser>();
    for (const user of teamUsers) map.set(normalizeLogin(user.login), user);
    return map;
  }, [teamUsers]);

  const rateByLogin = useMemo(() => {
    const map = new Map<string, ShiftRateItem>();
    for (const rate of rates) map.set(normalizeLogin(rate.login), rate);
    return map;
  }, [rates]);

  const periodKey = `${dateFrom}:${dateTo}`;
  const isClosedPeriod = closedPeriods.has(periodKey);
  const activeScopedLogin = viewingAsEmployee ? login : userFilter;

  useEffect(() => {
    try {
      const paid = window.localStorage.getItem(PAYROLL_PAID_STORAGE_KEY);
      const closed = window.localStorage.getItem(PAYROLL_CLOSED_STORAGE_KEY);
      if (paid) setPaidOverrides(new Set(JSON.parse(paid) as string[]));
      if (closed) setClosedPeriods(new Set(JSON.parse(closed) as string[]));
    } catch {
      // Local persistence is best-effort; payroll data still comes from the APIs.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PAYROLL_PAID_STORAGE_KEY, JSON.stringify(Array.from(paidOverrides)));
    } catch {}
  }, [paidOverrides]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PAYROLL_CLOSED_STORAGE_KEY, JSON.stringify(Array.from(closedPeriods)));
    } catch {}
  }, [closedPeriods]);

  const fetchWorkingDays = useCallback(async (from: string, to: string, targetLogin?: string) => {
    const params = new URLSearchParams({ dateFrom: from, dateTo: to });
    if (targetLogin) params.set("user", targetLogin);
    const response = await fetch(`/api/working-days?${params.toString()}`, { cache: "no-store" });
    return readJson<WorkingDayItem[]>(response, "Не удалось загрузить рабочие дни");
  }, []);

  const loadRates = useCallback(async () => {
    setRatesLoading(true);
    try {
      const response = await fetch("/api/shift-rates", { cache: "no-store" });
      const payload = await readJson<{ rates?: ShiftRateItem[]; login?: string; amountCents?: number | null }>(
        response,
        "Не удалось загрузить ставки"
      );
      const nextRates = Array.isArray(payload.rates)
        ? payload.rates
        : typeof payload.login === "string"
          ? [{ login: payload.login, name: payload.login, amountCents: payload.amountCents ?? null }]
          : [];
      setRates(nextRates);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось загрузить ставки");
    } finally {
      setRatesLoading(false);
    }
  }, []);

  const loadRules = useCallback(async () => {
    if (!isOwner) return;
    setRulesLoading(true);
    try {
      const response = await fetch("/api/piecework-rules", { cache: "no-store" });
      const payload = await readJson<{ rules?: PieceworkRuleItem[] }>(response, "Не удалось загрузить правила");
      const nextRules = Array.isArray(payload.rules) ? payload.rules : [];
      setRules(nextRules);
      setDraftRules(Object.fromEntries(nextRules.map((rule) => [ruleKey(rule), makeRuleDraft(rule)])));
      setRuleErrors({});
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось загрузить правила");
    } finally {
      setRulesLoading(false);
    }
  }, [isOwner]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch("/api/payroll/history?limit=50", { cache: "no-store" });
      const payload = await readJson<{ history?: HistoryItem[] }>(response, "Не удалось загрузить историю");
      setHistory(Array.isArray(payload.history) ? payload.history : []);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось загрузить историю");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const loadPayroll = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setPayrollLoading(true);
    setPayrollError(null);
    setProgressText("Считаем рабочие дни, услуги и сдельные начисления...");

    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (isOwner && activeScopedLogin) params.set("user", activeScopedLogin);
      const [payrollResponse, workingDaysResponse] = await Promise.all([
        fetch(`/api/payroll?${params.toString()}`, { cache: "no-store" }),
        fetchWorkingDays(dateFrom, dateTo, isOwner ? activeScopedLogin || undefined : undefined),
      ]);
      const nextPayroll = await readJson<Payroll>(payrollResponse, "Не удалось рассчитать зарплату");
      setPayroll(nextPayroll);
      setPayrollWorkingDays(workingDaysResponse);
      setProgressText(null);
      await Promise.all([loadRates(), loadHistory()]);
    } catch (error) {
      setPayroll(null);
      setPayrollWorkingDays([]);
      setPayrollError(error instanceof Error ? error.message : "Не удалось рассчитать зарплату");
      setProgressText(null);
    } finally {
      setPayrollLoading(false);
    }
  }, [activeScopedLogin, dateFrom, dateTo, fetchWorkingDays, isOwner, loadHistory, loadRates]);

  const loadCalendarDays = useCallback(async () => {
    const { dateFrom: monthFrom, dateTo: monthTo } = getMonthBounds(
      calendarDate.getFullYear(),
      calendarDate.getMonth()
    );
    setCalendarLoading(true);
    try {
      const nextDays = await fetchWorkingDays(
        monthFrom,
        monthTo,
        isOwner ? calendarLogin || undefined : undefined
      );
      setCalendarDays(nextDays);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось загрузить календарь");
      setCalendarDays([]);
    } finally {
      setCalendarLoading(false);
    }
  }, [calendarDate, calendarLogin, fetchWorkingDays, isOwner]);

  useEffect(() => {
    if (autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    void loadPayroll();
    void loadRules();
  }, [loadPayroll, loadRules]);

  useEffect(() => {
    if (!isOwner) setMode("employee");
  }, [isOwner]);

  useEffect(() => {
    if (!isOwner) setCalendarLogin(login);
  }, [isOwner, login]);

  useEffect(() => {
    void loadCalendarDays();
  }, [loadCalendarDays]);

  useEffect(() => {
    const { dateFrom: monthFrom, dateTo: monthTo } = getMonthBounds(
      calendarDate.getFullYear(),
      calendarDate.getMonth()
    );
    if (selectedDate >= monthFrom && selectedDate <= monthTo) return;
    setSelectedDate(monthFrom);
    setSelectionAnchor(monthFrom);
    setSelectedDates(new Set([monthFrom]));
  }, [calendarDate, selectedDate]);

  const hasUnsavedRuleChanges = useMemo(
    () =>
      rules.some((rule) => {
        const draft = draftRules[ruleKey(rule)] ?? makeRuleDraft(rule);
        const original = makeRuleDraft(rule);
        return draft.mode !== original.mode || draft.value !== original.value;
      }),
    [draftRules, rules]
  );

  useEffect(() => {
    if (!hasUnsavedRuleChanges) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedRuleChanges]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!selectedLogin) return;
    setDrawerComment("");
    setAdjustmentOpen(false);
    setAdjustmentAmount("");
    setAdjustmentComment("");
    setAdjustmentDate(dateTo || toLocalDateInputValue(new Date()));
  }, [dateTo, selectedLogin]);

  useEffect(() => {
    if (!rateDrawerLogin) return;
    const rate = rateByLogin.get(normalizeLogin(rateDrawerLogin))?.amountCents ?? null;
    setRateDraft(formatRateInput(rate));
  }, [rateByLogin, rateDrawerLogin]);

  const scopedUsers = useMemo(() => {
    if (viewingAsEmployee) return [currentUser];
    if (userFilter) {
      return teamUsers.filter((user) => normalizeLogin(user.login) === normalizeLogin(userFilter));
    }
    return teamUsers;
  }, [currentUser, teamUsers, userFilter, viewingAsEmployee]);

  const workdayCountsByLogin = useMemo(() => {
    const map = new Map<string, { working: Set<string>; actual: Set<string> }>();
    for (const item of payrollWorkingDays) {
      const key = normalizeLogin(item.userLogin);
      const entry = map.get(key) ?? { working: new Set<string>(), actual: new Set<string>() };
      if (item.source === "scheduled" || item.source === "both") entry.working.add(item.date);
      if (item.source === "actual" || item.source === "both") entry.actual.add(item.date);
      map.set(key, entry);
    }
    return map;
  }, [payrollWorkingDays]);

  const payrollRows = useMemo<PayrollRow[]>(() => {
    const logins = new Set<string>();
    for (const user of scopedUsers) logins.add(normalizeLogin(user.login));
    if (payroll?.byLogin) {
      for (const loginKey of Object.keys(payroll.byLogin)) logins.add(normalizeLogin(loginKey));
    }

    return Array.from(logins)
      .map((loginKey) => {
        const user = userByLogin.get(loginKey);
        const sourceLogin = user?.login ?? loginKey;
        const payrollEntry =
          Object.entries(payroll?.byLogin ?? {}).find(([entryLogin]) => normalizeLogin(entryLogin) === loginKey)?.[1] ??
          EMPTY_PAYROLL_ROW;
        const counts = workdayCountsByLogin.get(loginKey);
        const roleValue = normalizeRole(user?.role ?? (loginKey === normalizeLogin(login) ? role : "master"));
        const rate = rateByLogin.get(loginKey)?.amountCents ?? null;
        const status = getRowStatus({
          closed: isClosedPeriod,
          hasData: Boolean(payroll),
          payroll: payrollEntry,
          role: roleValue,
          rateCents: rate,
          workDaysCount: counts?.working.size ?? payrollEntry.shiftsCount,
          paidOverride: paidOverrides.has(`${periodKey}:${loginKey}`),
        });

        return {
          login: sourceLogin,
          name: user?.name ?? sourceLogin,
          role: roleValue,
          payroll: payrollEntry,
          rateCents: rate,
          workDaysCount: counts?.working.size ?? payrollEntry.shiftsCount,
          actualShiftsCount: counts?.actual.size ?? payrollEntry.shiftsCount,
          status,
        };
      })
      .filter((row) => (viewingAsEmployee ? normalizeLogin(row.login) === normalizeLogin(login) : true))
      .sort((a, b) => b.payroll.totalCents - a.payroll.totalCents || a.name.localeCompare(b.name, "ru"));
  }, [
    isClosedPeriod,
    login,
    paidOverrides,
    periodKey,
    payroll,
    rateByLogin,
    role,
    scopedUsers,
    userByLogin,
    viewingAsEmployee,
    workdayCountsByLogin,
  ]);

  const selectedRow = selectedLogin
    ? payrollRows.find((row) => normalizeLogin(row.login) === normalizeLogin(selectedLogin)) ?? null
    : null;
  const rateDrawerRow = rateDrawerLogin
    ? payrollRows.find((row) => normalizeLogin(row.login) === normalizeLogin(rateDrawerLogin)) ??
      teamUsers
        .map((user) => ({
          login: user.login,
          name: user.name,
          role: normalizeRole(user.role ?? "master"),
          payroll: EMPTY_PAYROLL_ROW,
          rateCents: rateByLogin.get(normalizeLogin(user.login))?.amountCents ?? null,
          workDaysCount: 0,
          actualShiftsCount: 0,
          status: "not_calculated" as StatusKey,
        }))
        .find((row) => normalizeLogin(row.login) === normalizeLogin(rateDrawerLogin)) ??
      null
    : null;

  const totals = useMemo(() => {
    const totalAccrued = payrollRows.reduce((sum, row) => sum + row.payroll.totalCents, 0);
    const totalPaid = payrollRows.reduce((sum, row) => sum + row.payroll.paidOutCents, 0);
    const totalRemaining = payrollRows.reduce((sum, row) => sum + row.payroll.remainingCents, 0);
    const totalWorkingDays = payrollRows.reduce((sum, row) => sum + row.workDaysCount, 0);
    return { totalAccrued, totalPaid, totalRemaining, totalWorkingDays };
  }, [payrollRows]);

  const problems = useMemo(() => {
    const next: { title: string; text: string; severity: "warning" | "danger" }[] = [];
    if (payrollError) {
      next.push({
        title: "Не удалось рассчитать зарплату",
        text: "Проверьте рабочие дни, ставки и правила сдельной части.",
        severity: "danger",
      });
    }
    for (const row of payrollRows) {
      if (row.role !== "owner" && row.rateCents == null && row.workDaysCount > 0) {
        next.push({
          title: `${row.name}: нет ставки`,
          text: "Фиксированная часть за смены не будет начислена.",
          severity: "warning",
        });
      }
      if (row.payroll.bonusPenaltyCents < 0 && row.payroll.totalCents < 0) {
        next.push({
          title: `${row.name}: отрицательное начисление`,
          text: "Проверьте удержания и ручные корректировки.",
          severity: "danger",
        });
      }
    }
    if (!rulesLoading && canManagePayroll && rules.length === 0) {
      next.push({
        title: "Правила сдельной части не настроены",
        text: "Добавьте правила для услуг и групп товаров.",
        severity: "warning",
      });
    }
    if (payroll && payrollRows.length === 0) {
      next.push({
        title: "Сотрудники не найдены",
        text: "Добавьте сотрудников в настройках доступа.",
        severity: "warning",
      });
    }
    if (payroll && payrollWorkingDays.length === 0) {
      next.push({
        title: "Рабочие дни не заполнены",
        text: "Календарь графика пуст за выбранный период.",
        severity: "warning",
      });
    }
    return next.slice(0, 8);
  }, [canManagePayroll, payroll, payrollError, payrollRows, payrollWorkingDays.length, rules.length, rulesLoading]);

  const availableTabs = useMemo<SalaryTab[]>(
    () => (viewingAsEmployee ? ["calculation", "workdays", "history"] : ["calculation", "workdays", "rules", "rates", "history"]),
    [viewingAsEmployee]
  );

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) setActiveTab("calculation");
  }, [activeTab, availableTabs]);

  const vehicleHistory = payroll?.vehicleHistory ?? [];
  const cashoutHistory = payroll?.cashoutHistory ?? [];

  function setPeriodPreset(preset: "current" | "previous" | "7" | "30") {
    const range = getPresetRange(preset);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
  }

  function changeTab(tab: SalaryTab) {
    if (activeTab === tab) return;
    if (hasUnsavedRuleChanges && !window.confirm("Есть несохранённые изменения правил. Перейти без сохранения?")) {
      return;
    }
    setActiveTab(tab);
  }

  function changeMode(nextMode: PayrollMode) {
    if (mode === nextMode) return;
    if (hasUnsavedRuleChanges && !window.confirm("Есть несохранённые изменения правил. Сменить режим без сохранения?")) {
      return;
    }
    setMode(nextMode);
    setActiveTab("calculation");
    setUserFilter("");
  }

  function getCalendarMonthDateKeys() {
    const { daysInMonth } = getMonthBounds(calendarDate.getFullYear(), calendarDate.getMonth());
    return Array.from({ length: daysInMonth }, (_, index) => {
      const day = index + 1;
      return `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    });
  }

  function applyDateSelection(nextDates: Iterable<string>, nextAnchor?: string) {
    const monthDates = new Set(getCalendarMonthDateKeys());
    const normalized = Array.from(new Set(Array.from(nextDates).filter((date) => monthDates.has(date)))).sort();
    const fallback = nextAnchor && monthDates.has(nextAnchor) ? nextAnchor : normalized[normalized.length - 1] ?? selectedDate;
    setSelectedDates(new Set(normalized.length > 0 ? normalized : [fallback]));
    setSelectedDate(fallback);
    setSelectionAnchor(fallback);
  }

  function handleCalendarDayClick(dateKey: string, event: ReactMouseEvent<HTMLButtonElement>) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    if (event.shiftKey && selectionAnchor) {
      applyDateSelection(getDateRangeKeys(selectionAnchor, dateKey), selectionAnchor);
      setMultiSelectEnabled(true);
      return;
    }

    if (event.metaKey || event.ctrlKey || multiSelectEnabled) {
      const next = new Set(selectedDates);
      if (next.has(dateKey) && next.size > 1) {
        next.delete(dateKey);
      } else {
        next.add(dateKey);
      }
      applyDateSelection(next, dateKey);
      setMultiSelectEnabled(true);
      return;
    }

    applyDateSelection([dateKey], dateKey);
  }

  function handleCalendarPointerDown(dateKey: string, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    dragStartDateRef.current = dateKey;
    suppressNextClickRef.current = false;
  }

  function handleCalendarPointerEnter(dateKey: string) {
    const startDate = dragStartDateRef.current;
    if (!startDate || startDate === dateKey) return;
    suppressNextClickRef.current = true;
    setMultiSelectEnabled(true);
    applyDateSelection(getDateRangeKeys(startDate, dateKey), startDate);
  }

  function endCalendarDrag() {
    dragStartDateRef.current = null;
  }

  function toggleMultiSelectMode() {
    setMultiSelectEnabled((enabled) => {
      const next = !enabled;
      if (!next && selectedDates.size > 1) {
        applyDateSelection([selectedDate], selectedDate);
      }
      return next;
    });
  }

  function selectCalendarPreset(kind: "weekdays" | "weekends" | "week" | "month" | "clear") {
    if (kind === "clear") {
      applyDateSelection([selectedDate], selectedDate);
      setMultiSelectEnabled(false);
      return;
    }

    const monthDates = getCalendarMonthDateKeys();
    const dates =
      kind === "month"
        ? monthDates
        : kind === "week"
          ? getWeekRangeKeys(selectedDate, calendarDate)
          : monthDates.filter((dateKey) => {
              const date = new Date(`${dateKey}T00:00:00`);
              const isWeekend = date.getDay() === 0 || date.getDay() === 6;
              return kind === "weekends" ? isWeekend : !isWeekend;
            });
    applyDateSelection(dates, dates[0] ?? selectedDate);
    setMultiSelectEnabled(true);
  }

  function getCalendarItemsForDate(date: string, targetLogin = calendarLogin) {
    return calendarDays.filter((item) => {
      if (targetLogin && normalizeLogin(item.userLogin) !== normalizeLogin(targetLogin)) return false;
      return item.date === date;
    });
  }

  function getCalendarCountsByLogin() {
    const counts = new Map<string, Set<string>>();
    for (const item of calendarDays) {
      if (item.source !== "scheduled" && item.source !== "both") continue;
      const key = normalizeLogin(item.userLogin);
      const set = counts.get(key) ?? new Set<string>();
      set.add(item.date);
      counts.set(key, set);
    }
    return counts;
  }

  const calendarCounts = getCalendarCountsByLogin();

  const sortedSelectedDates = Array.from(selectedDates).sort();
  const selectedDatesCount = sortedSelectedDates.length;
  const firstSelectedDate = sortedSelectedDates[0] ?? selectedDate;
  const lastSelectedDate = sortedSelectedDates[sortedSelectedDates.length - 1] ?? selectedDate;

  function getTargetUsersForCalendarAction() {
    if (calendarLogin) {
      return teamUsers.filter((user) => normalizeLogin(user.login) === normalizeLogin(calendarLogin));
    }
    return teamUsers;
  }

  function calendarOverrideKey(userLogin: string, date: string) {
    return `${normalizeLogin(userLogin)}:${date}`;
  }

  function getEffectiveDayState(date: string, targetLogin = calendarLogin) {
    const targetUsers = targetLogin
      ? teamUsers.filter((user) => normalizeLogin(user.login) === normalizeLogin(targetLogin))
      : teamUsers;
    const items = getCalendarItemsForDate(date, targetLogin);
    const hasWorking = items.some((item) => item.source === "scheduled" || item.source === "both");
    const hasActualFromApi = items.some((item) => item.source === "actual" || item.source === "both");
    const hasShiftOverride = targetUsers.some((user) => shiftOverrides.has(calendarOverrideKey(user.login, date)));
    const hasAbsenceOverride = targetUsers.some((user) => absenceOverrides.has(calendarOverrideKey(user.login, date)));
    const hasActual = hasActualFromApi || hasShiftOverride;
    const todayKey = toLocalDateInputValue(new Date());
    const hasAbsence = hasAbsenceOverride || (hasWorking && !hasActual && date < todayKey);
    return { hasWorking, hasActual, hasAbsence, items };
  }

  async function runSelectedDaysAction(
    action:
      | "mark-working"
      | "clear-working"
      | "add-shift"
      | "clear-shift"
      | "add-comment"
      | "clear-comment"
      | "mark-absence"
      | "reset-local"
  ) {
    if (!canManagePayroll || calendarBusy || selectedDatesCount === 0) return;

    const targetUsers = getTargetUsersForCalendarAction();
    if (targetUsers.length === 0) {
      setToast("Выберите сотрудника для массового действия");
      return;
    }

    const targetLabel = calendarLogin
      ? teamUsers.find((user) => normalizeLogin(user.login) === normalizeLogin(calendarLogin))?.name ?? calendarLogin
      : "всех сотрудников";
    const dangerous = action === "clear-working" || action === "clear-shift" || action === "clear-comment" || !calendarLogin;
    const actionLabels = {
      "mark-working": "Отметить",
      "clear-working": "Снять рабочие дни",
      "add-shift": "Добавить смену",
      "clear-shift": "Очистить смены",
      "add-comment": "Добавить комментарий",
      "clear-comment": "Очистить комментарии",
      "mark-absence": "Отметить отсутствием",
      "reset-local": "Сбросить выбранные изменения",
    };

    if (dangerous && !window.confirm(`${actionLabels[action]} для ${selectedDatesCount} дней: ${targetLabel}?`)) {
      return;
    }

    setCalendarSaveStatus("saving");
    setCalendarBusy(true);
    try {
      if (action === "mark-working") {
        for (const user of targetUsers) {
          for (const date of sortedSelectedDates) {
            const response = await fetch("/api/working-days", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userLogin: user.login, date }),
            });
            await readJson(response, "Не удалось назначить рабочие дни");
          }
        }
        setToast(`${selectedDatesCount} дней отмечены рабочими`);
      }

      if (action === "clear-working") {
        const removable = calendarDays.filter((item) => {
          if (!sortedSelectedDates.includes(item.date)) return false;
          if (item.source !== "scheduled" && item.source !== "both") return false;
          if (calendarLogin && normalizeLogin(item.userLogin) !== normalizeLogin(calendarLogin)) return false;
          return item.removable !== false;
        });
        for (const item of removable) {
          const response = await fetch(`/api/working-days/${item.id}`, { method: "DELETE" });
          await readJson(response, "Не удалось снять рабочие дни");
        }
        setToast(`${selectedDatesCount} дней сняты с графика`);
      }

      if (action === "add-shift") {
        setShiftOverrides((prev) => {
          const next = new Set(prev);
          for (const user of targetUsers) {
            for (const date of sortedSelectedDates) next.add(calendarOverrideKey(user.login, date));
          }
          return next;
        });
        setAbsenceOverrides((prev) => {
          const next = new Set(prev);
          for (const user of targetUsers) {
            for (const date of sortedSelectedDates) next.delete(calendarOverrideKey(user.login, date));
          }
          return next;
        });
        setToast(`${selectedDatesCount} смен добавлены в календарь`);
      }

      if (action === "clear-shift") {
        setShiftOverrides((prev) => {
          const next = new Set(prev);
          for (const user of targetUsers) {
            for (const date of sortedSelectedDates) next.delete(calendarOverrideKey(user.login, date));
          }
          return next;
        });
        setToast("Локальные смены очищены");
      }

      if (action === "add-comment") {
        const comment = window.prompt(`Комментарий для ${selectedDatesCount} дней`);
        if (comment == null) {
          setCalendarSaveStatus("idle");
          return;
        }
        setDayComments((prev) => {
          const next = { ...prev };
          for (const date of sortedSelectedDates) {
            next[`${calendarLogin || "all"}:${date}`] = comment;
          }
          return next;
        });
        setToast("Комментарий добавлен");
      }

      if (action === "clear-comment") {
        setDayComments((prev) => {
          const next = { ...prev };
          for (const date of sortedSelectedDates) delete next[`${calendarLogin || "all"}:${date}`];
          return next;
        });
        setToast("Комментарии очищены");
      }

      if (action === "mark-absence") {
        setAbsenceOverrides((prev) => {
          const next = new Set(prev);
          for (const user of targetUsers) {
            for (const date of sortedSelectedDates) next.add(calendarOverrideKey(user.login, date));
          }
          return next;
        });
        setShiftOverrides((prev) => {
          const next = new Set(prev);
          for (const user of targetUsers) {
            for (const date of sortedSelectedDates) next.delete(calendarOverrideKey(user.login, date));
          }
          return next;
        });
        setToast(`${selectedDatesCount} дней отмечены отсутствием`);
      }

      if (action === "reset-local") {
        setShiftOverrides((prev) => {
          const next = new Set(prev);
          for (const user of targetUsers) {
            for (const date of sortedSelectedDates) next.delete(calendarOverrideKey(user.login, date));
          }
          return next;
        });
        setAbsenceOverrides((prev) => {
          const next = new Set(prev);
          for (const user of targetUsers) {
            for (const date of sortedSelectedDates) next.delete(calendarOverrideKey(user.login, date));
          }
          return next;
        });
        setDayComments((prev) => {
          const next = { ...prev };
          for (const date of sortedSelectedDates) delete next[`${calendarLogin || "all"}:${date}`];
          return next;
        });
        setToast("Выбранные локальные изменения сброшены");
      }

      await loadCalendarDays();
      await loadPayroll();
      setCalendarSaveStatus("saved");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось выполнить массовое действие");
      setCalendarSaveStatus("dirty");
    } finally {
      setCalendarBusy(false);
    }
  }

  async function toggleWorkingDay(targetDate: string, shouldBeWorking: boolean) {
    if (!canManagePayroll) return;
    if (!calendarLogin) {
      setToast("Выберите сотрудника для изменения конкретного дня");
      return;
    }
    const item = getCalendarItemsForDate(targetDate, calendarLogin).find(
      (candidate) => candidate.source === "scheduled" || candidate.source === "both"
    );
    setCalendarBusy(true);
    try {
      if (shouldBeWorking && !item) {
        const response = await fetch("/api/working-days", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userLogin: calendarLogin, date: targetDate }),
        });
        await readJson(response, "Не удалось назначить рабочий день");
        setToast("Рабочий день назначен");
      }
      if (!shouldBeWorking && item) {
        const response = await fetch(`/api/working-days/${item.id}`, { method: "DELETE" });
        await readJson(response, "Не удалось снять рабочий день");
        setToast("Рабочий день снят");
      }
      await loadCalendarDays();
      await loadPayroll();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось обновить рабочий день");
    } finally {
      setCalendarBusy(false);
    }
  }

  async function runBulkWorkingDays(kind: "weekdays" | "copy" | "clear" | "masters") {
    if (!canManagePayroll || calendarBusy) return;
    const { dateFrom: monthFrom, dateTo: monthTo, daysInMonth } = getMonthBounds(
      calendarDate.getFullYear(),
      calendarDate.getMonth()
    );
    const targetUsers = calendarLogin
      ? teamUsers.filter((user) => normalizeLogin(user.login) === normalizeLogin(calendarLogin))
      : teamUsers.filter((user) => user.role !== "owner");

    const messages = {
      weekdays: "Назначить будни рабочими для выбранного набора сотрудников?",
      copy: "Скопировать график прошлого месяца в текущий?",
      clear: "Очистить назначенные рабочие дни за месяц?",
      masters: "Применить график выбранного сотрудника ко всем мастерам?",
    };
    if (!window.confirm(messages[kind])) return;

    setCalendarBusy(true);
    try {
      if (kind === "weekdays") {
        const dates = Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const date = new Date(calendarDate.getFullYear(), calendarDate.getMonth(), day);
          return { date, key: toLocalDateInputValue(date) };
        }).filter(({ date }) => date.getDay() !== 0 && date.getDay() !== 6);

        for (const user of targetUsers) {
          for (const item of dates) {
            await fetch("/api/working-days", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userLogin: user.login, date: item.key }),
            });
          }
        }
        setToast("Будни назначены рабочими");
      }

      if (kind === "clear") {
        const removable = calendarDays.filter((item) => {
          if (item.source !== "scheduled" && item.source !== "both") return false;
          if (calendarLogin && normalizeLogin(item.userLogin) !== normalizeLogin(calendarLogin)) return false;
          return item.removable !== false;
        });
        for (const item of removable) {
          await fetch(`/api/working-days/${item.id}`, { method: "DELETE" });
        }
        setToast("Месяц очищен");
      }

      if (kind === "copy") {
        const prevDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
        const prevBounds = getMonthBounds(prevDate.getFullYear(), prevDate.getMonth());
        const previousDays = await fetchWorkingDays(
          prevBounds.dateFrom,
          prevBounds.dateTo,
          isOwner ? calendarLogin || undefined : undefined
        );
        const scheduledPrevious = previousDays.filter(
          (item) => item.source === "scheduled" || item.source === "both"
        );
        for (const item of scheduledPrevious) {
          const day = Number(item.date.slice(8, 10));
          if (!Number.isFinite(day) || day < 1 || day > daysInMonth) continue;
          const targetDate = `${monthFrom.slice(0, 8)}${String(day).padStart(2, "0")}`;
          if (targetDate > monthTo) continue;
          await fetch("/api/working-days", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userLogin: item.userLogin, date: targetDate }),
          });
        }
        setToast("График прошлого месяца скопирован");
      }

      if (kind === "masters") {
        if (!calendarLogin) {
          setToast("Выберите сотрудника-источник");
        } else {
          const sourceDates = calendarDays
            .filter(
              (item) =>
                normalizeLogin(item.userLogin) === normalizeLogin(calendarLogin) &&
                (item.source === "scheduled" || item.source === "both")
            )
            .map((item) => item.date);
          const masters = teamUsers.filter(
            (user) => user.role === "master" && normalizeLogin(user.login) !== normalizeLogin(calendarLogin)
          );
          for (const user of masters) {
            for (const date of sourceDates) {
              await fetch("/api/working-days", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userLogin: user.login, date }),
              });
            }
          }
          setToast("График применён ко всем мастерам");
        }
      }

      await loadCalendarDays();
      await loadPayroll();
    } finally {
      setCalendarBusy(false);
    }
  }

  function updateRuleDraft(key: string, patch: Partial<DraftRule>) {
    setDraftRules((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } as DraftRule }));
    setRuleErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function getRuleStatus(rule: PieceworkRuleItem) {
    const key = ruleKey(rule);
    const draft = draftRules[key] ?? makeRuleDraft(rule);
    const original = makeRuleDraft(rule);
    const numericValue = Number(draft.value.replace(",", "."));
    if (draft.mode !== original.mode || draft.value !== original.value) return "changed";
    if (!draft.value.trim() || Number.isNaN(numericValue)) return "missing";
    if (numericValue === 0) return "disabled";
    return rule.isDefault ? "default" : "custom";
  }

  function validateRule(rule: PieceworkRuleItem) {
    const key = ruleKey(rule);
    const draft = draftRules[key] ?? makeRuleDraft(rule);
    const value = Number(draft.value.replace(",", "."));
    if (!draft.mode) return "Выберите режим";
    if (!draft.value.trim() || Number.isNaN(value)) return "Укажите значение";
    if (value < 0) return "Значение не может быть меньше 0";
    if (draft.mode === "percent" && value > 100) return "Процент не может быть больше 100";
    return null;
  }

  async function saveChangedRules() {
    const changed = rules.filter((rule) => getRuleStatus(rule) === "changed");
    if (changed.length === 0) return;

    const nextErrors: Record<string, string> = {};
    for (const rule of changed) {
      const error = validateRule(rule);
      if (error) nextErrors[ruleKey(rule)] = error;
    }
    setRuleErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setRulesSaving(true);
    setRulesMessage(null);
    try {
      for (const rule of changed) {
        const key = ruleKey(rule);
        const draft = draftRules[key] ?? makeRuleDraft(rule);
        const value = Number(draft.value.replace(",", "."));
        const response = await fetch("/api/piecework-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetType: rule.targetType,
            targetId: rule.targetId,
            targetName: rule.targetName,
            role: rule.role,
            mode: draft.mode,
            fixedCents: draft.mode === "fixed" ? Math.round(value * 100) : null,
            percentBasisPoints: draft.mode === "percent" ? Math.round(value * 100) : null,
          }),
        });
        await readJson(response, "Не удалось сохранить правило");
      }
      setRulesMessage("Правила сохранены");
      setToast("Правила сохранены");
      await Promise.all([loadRules(), loadPayroll()]);
    } catch (error) {
      setRulesMessage(error instanceof Error ? error.message : "Не удалось сохранить правила");
    } finally {
      setRulesSaving(false);
    }
  }

  function resetRuleDrafts() {
    setDraftRules(Object.fromEntries(rules.map((rule) => [ruleKey(rule), makeRuleDraft(rule)])));
    setRuleErrors({});
    setRulesMessage("Изменения отменены");
  }

  async function saveRate(applyToMonth: boolean) {
    if (!rateDrawerRow) return;
    const rub = parseMoneyInput(rateDraft);
    if (Number.isNaN(rub) || rub < 0) {
      setToast("Укажите ставку не меньше 0");
      return;
    }

    setRateSaving(true);
    try {
      const response = await fetch("/api/shift-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userLogin: rateDrawerRow.login,
          amountCents: Math.round(rub * 100),
          effectiveFrom: applyToMonth ? dateFrom : undefined,
          applyToMonth,
        }),
      });
      await readJson(response, "Не удалось сохранить ставку");
      setToast(applyToMonth ? "Ставка применена к периоду" : "Ставка сохранена");
      await Promise.all([loadRates(), loadPayroll()]);
      setRateDrawerLogin(null);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось сохранить ставку");
    } finally {
      setRateSaving(false);
    }
  }

  async function submitAdjustment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRow) return;
    const amount = parseMoneyInput(adjustmentAmount);
    if (!adjustmentDate || amount <= 0) {
      setToast("Укажите дату и сумму корректировки");
      return;
    }

    setAdjustmentSaving(true);
    try {
      const response = await fetch("/api/bonus-penalties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userLogin: selectedRow.login,
          date: adjustmentDate,
          amountCents: Math.round(amount * 100),
          type: adjustmentType,
          comment: adjustmentComment.trim() || null,
        }),
      });
      await readJson(response, "Не удалось добавить корректировку");
      setToast("Корректировка добавлена");
      setAdjustmentOpen(false);
      setAdjustmentAmount("");
      setAdjustmentComment("");
      await loadPayroll();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось добавить корректировку");
    } finally {
      setAdjustmentSaving(false);
    }
  }

  function markAsPaid(row: PayrollRow) {
    setPaidOverrides((prev) => {
      const next = new Set(prev);
      next.add(`${periodKey}:${normalizeLogin(row.login)}`);
      return next;
    });
    setToast(`${row.name}: отмечено как выплачено`);
  }

  function closePeriod() {
    if (!window.confirm("После закрытия периода расчёт станет доступен только для просмотра.")) return;
    setClosedPeriods((prev) => {
      const next = new Set(prev);
      next.add(periodKey);
      return next;
    });
    setToast("Период закрыт для просмотра");
  }

  const changedRulesCount = rules.filter((rule) => getRuleStatus(rule) === "changed").length;
  const filteredRules = rules.filter((rule) => {
    const key = ruleKey(rule);
    const draft = draftRules[key] ?? makeRuleDraft(rule);
    const status = getRuleStatus(rule);
    const search = ruleSearch.trim().toLowerCase();
    if (search && !`${rule.targetName} ${rule.targetId}`.toLowerCase().includes(search)) return false;
    if (ruleRoleFilter !== "all" && rule.role !== ruleRoleFilter) return false;
    if (ruleModeFilter !== "all" && draft.mode !== ruleModeFilter) return false;
    if (ruleStatusFilter !== "all" && status !== ruleStatusFilter) return false;
    return true;
  });

  const ruleSections = [
    {
      id: "service",
      title: "Услуги",
      rows: filteredRules.filter((rule) => rule.targetType === "service"),
    },
    {
      id: "product_group",
      title: "Группы товаров",
      rows: filteredRules.filter((rule) => rule.targetType === "product_group"),
    },
  ] as const;

  const selectedDayState = getEffectiveDayState(selectedDate);
  const selectedDayItems = selectedDayState.items;
  const selectedDayWorking = selectedDayState.hasWorking;
  const selectedDayActual = selectedDayState.hasActual;
  const selectedDayCommentKey = `${calendarLogin || "all"}:${selectedDate}`;
  const selectedBulkStats = sortedSelectedDates.reduce(
    (stats, date) => {
      const state = getEffectiveDayState(date);
      if (state.hasWorking) stats.working += 1;
      if (state.hasActual) stats.actual += 1;
      if (state.hasAbsence) stats.absence += 1;
      return stats;
    },
    { working: 0, actual: 0, absence: 0 }
  );

  const selectedBreakdown = selectedRow
    ? vehicleHistory
        .filter((vehicle) => (vehicle.earningsByLogin[selectedRow.login] ?? 0) > 0)
        .flatMap((vehicle) =>
          (vehicle.pieceworkBreakdownByLogin[selectedRow.login] ?? []).map((item) => ({
            ...item,
            date: vehicle.date,
            demandName: vehicle.demandName,
            agentName: vehicle.agentName,
          }))
        )
    : [];
  const selectedWorkPiecework = selectedBreakdown
    .filter((item) => item.category === "work")
    .reduce((sum, item) => sum + item.amountCents, 0);
  const selectedProductPiecework = selectedBreakdown
    .filter((item) => item.category === "product")
    .reduce((sum, item) => sum + item.amountCents, 0);
  const selectedCashouts = selectedRow
    ? cashoutHistory.filter((item) => normalizeLogin(item.login) === normalizeLogin(selectedRow.login))
    : [];

  return (
    <main className="eco-page eco-page--wide eco-payroll-page">
      <section className="eco-page-head eco-payroll-head">
        <div>
          <div className="eco-page-crumbs">
            <Link href="/">Главная</Link>
            <span className="sep">/</span>
            <span>Финансы</span>
            <span className="sep">/</span>
            <span className="cur">Зарплата</span>
          </div>
          <div className="eco-title-row">
            <h1 className="eco-page-title">Зарплата</h1>
            <EcoBadge tone={isClosedPeriod ? "neutral" : "rust"}>
              {isClosedPeriod ? "Закрытый период" : "Текущий период"}
            </EcoBadge>
            <EcoBadge tone={isOwner ? "success" : role === "admin" ? "info" : "neutral"} dot>
              {roleLabel(role)}
            </EcoBadge>
          </div>
          <p className="eco-page-subtitle">
            Расчёт выплат, рабочих дней и сдельных правил по текущим данным платформы.
          </p>
        </div>
        <div className="eco-page-actions eco-payroll-head-actions">
          <div className="eco-payroll-mode" aria-label="Режим просмотра зарплаты">
            <button
              type="button"
              className={mode === "owner" ? "is-active" : ""}
              onClick={() => changeMode("owner")}
              disabled={!isOwner}
            >
              <UsersRound size={15} />
              Владелец
            </button>
            <button
              type="button"
              className={mode === "employee" ? "is-active" : ""}
              onClick={() => changeMode("employee")}
            >
              <UserRound size={15} />
              Сотрудник
            </button>
          </div>
          <EcoButton type="button" variant="primary" onClick={() => void loadPayroll()} disabled={payrollLoading}>
            {payrollLoading ? <Loader2 size={15} className="eco-spin" /> : <RefreshCw size={15} />}
            Рассчитать
          </EcoButton>
          <EcoButton type="button" onClick={() => window.print()}>
            <Printer size={15} />
            Печать ведомости
          </EcoButton>
        </div>
      </section>

      <section className="eco-grid eco-grid--kpi eco-salary-metrics eco-payroll-metrics">
        {viewingAsEmployee ? (
          <>
            <EcoKpi label="Начислено" value={formatMoney(totals.totalAccrued)} sub={`за ${formatDate(dateFrom)} - ${formatDate(dateTo)}`} tone="rust" />
            <EcoKpi label="Выплачено" value={formatMoney(totals.totalPaid)} sub="по данным расходных ордеров" tone="success" />
            <EcoKpi label="К выплате" value={formatMoney(totals.totalRemaining)} sub="личный остаток" tone={totals.totalRemaining > 0 ? "warning" : "success"} />
            <EcoKpi label="Рабочих дней" value={formatDays(totals.totalWorkingDays)} sub="по графику и сменам" tone="info" />
          </>
        ) : (
          <>
            <EcoKpi label="Сотрудников" value={payrollRows.length} sub="в текущем расчёте" tone="info" />
            <EcoKpi label="Начислено за период" value={formatMoney(totals.totalAccrued)} sub={`${formatDate(dateFrom)} - ${formatDate(dateTo)}`} tone="rust" />
            <EcoKpi label="Выплачено" value={formatMoney(totals.totalPaid)} sub="по РКО и авансам" tone="success" />
            <EcoKpi label="К выплате" value={formatMoney(totals.totalRemaining)} sub="остаток по сотрудникам" tone={totals.totalRemaining > 0 ? "warning" : "success"} />
            <EcoKpi label="Рабочих дней" value={totals.totalWorkingDays} sub="по всем сотрудникам" tone="info" />
            <EcoKpi label="Не настроено" value={problems.length} sub="требуют проверки" tone={problems.length > 0 ? "warning" : "success"} />
          </>
        )}
      </section>

      <div className="eco-payroll-context">
        <span>Контекст</span>
        <strong>@{login}</strong>
        <span>{roleLabel(role)}</span>
        <span>{viewingAsEmployee ? "Личный режим: видны только собственные выплаты" : "Режим владельца: видны сотрудники, ставки и правила"}</span>
      </div>

      <nav className="eco-tabs eco-salary-tabs eco-payroll-tabs" aria-label="Разделы зарплаты">
        {availableTabs.map((tab) => {
          const Icon = TAB_META[tab].icon;
          const count =
            tab === "calculation"
              ? payrollRows.length
              : tab === "workdays"
                ? payrollWorkingDays.length || calendarDays.length
                : tab === "rules"
                  ? changedRulesCount || rules.length
                  : tab === "rates"
                    ? rates.length
                    : history.length + cashoutHistory.length;
          return (
            <button
              key={tab}
              type="button"
              className={`eco-tab ${activeTab === tab ? "is-active" : ""}`}
              onClick={() => changeTab(tab)}
            >
              <Icon size={15} />
              <span>{TAB_META[tab].label}</span>
              <span className="eco-tab__count">{count}</span>
            </button>
          );
        })}
      </nav>

      {toast && (
        <div className="eco-payroll-toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}

      {activeTab === "calculation" && (
        <section className="eco-payroll-workspace">
          <div className="eco-payroll-toolbar">
            <div>
              <div className="eco-page-kicker">Период расчёта</div>
              <p>Выберите даты, сотрудника и запустите расчёт.</p>
            </div>
            <div className="eco-payroll-controls">
              <FieldLabel label="С">
                <EcoInput type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              </FieldLabel>
              <FieldLabel label="По">
                <EcoInput type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </FieldLabel>
              {!viewingAsEmployee && (
                <FieldLabel label="Сотрудник">
                  <EcoSelect value={userFilter} onChange={(event) => setUserFilter(event.target.value)}>
                    <option value="">Все сотрудники</option>
                    {teamUsers.map((user) => (
                      <option key={user.login} value={user.login}>
                        {user.name}
                      </option>
                    ))}
                  </EcoSelect>
                </FieldLabel>
              )}
              <EcoButton type="button" variant="primary" onClick={() => void loadPayroll()} disabled={payrollLoading}>
                {payrollLoading ? <Loader2 size={15} className="eco-spin" /> : <RefreshCw size={15} />}
                Рассчитать
              </EcoButton>
            </div>
            <div className="eco-payroll-presets" aria-label="Быстрый выбор периода">
              <button type="button" onClick={() => setPeriodPreset("current")}>Текущий месяц</button>
              <button type="button" onClick={() => setPeriodPreset("previous")}>Прошлый месяц</button>
              <button type="button" onClick={() => setPeriodPreset("7")}>7 дней</button>
              <button type="button" onClick={() => setPeriodPreset("30")}>30 дней</button>
            </div>
          </div>

          {progressText && (
            <div className="eco-payroll-progress">
              <Loader2 size={16} className="eco-spin" />
              {progressText}
            </div>
          )}

          {payrollError && (
            <div className="eco-payroll-error">
              <AlertTriangle size={18} />
              <div>
                <strong>Не удалось рассчитать зарплату</strong>
                <span>{payrollError}</span>
              </div>
              <EcoButton type="button" size="sm" onClick={() => void loadPayroll()}>
                Повторить
              </EcoButton>
              <EcoButton type="button" size="sm" variant="ghost" onClick={() => setActiveTab("rules")}>
                Показать проблемы
              </EcoButton>
            </div>
          )}

          {problems.length > 0 && (
            <div className="eco-payroll-problems">
              <div className="eco-payroll-problems__head">
                <AlertTriangle size={17} />
                <div>
                  <strong>Проблемы расчёта</strong>
                  <span>Проверьте эти пункты перед закрытием периода.</span>
                </div>
              </div>
              <div className="eco-payroll-problem-list">
                {problems.map((problem, index) => (
                  <div key={`${problem.title}-${index}`} className={`is-${problem.severity}`}>
                    <strong>{problem.title}</strong>
                    <span>{problem.text}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {payrollLoading ? (
            <SkeletonRows rows={6} />
          ) : !payroll ? (
            <EmptyState
              title="Расчёт ещё не выполнен"
              text="Выберите период и нажмите “Рассчитать”, чтобы увидеть выплаты сотрудников."
              action={
                <EcoButton type="button" variant="primary" onClick={() => void loadPayroll()}>
                  Рассчитать
                </EcoButton>
              }
            />
          ) : payrollRows.length === 0 ? (
            <EmptyState
              title="Сотрудники не найдены"
              text="Добавьте сотрудников в настройках доступа."
            />
          ) : (
            <div className="eco-table-wrap eco-payroll-table-wrap">
              <table className="eco-table eco-payroll-table">
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th>Роль</th>
                    <th className="is-num">Рабочих дней</th>
                    <th className="is-num">Смен</th>
                    <th className="is-num">Фикс</th>
                    <th className="is-num">Сдельная часть</th>
                    <th className="is-num">Бонусы</th>
                    <th className="is-num">Штрафы</th>
                    <th className="is-num">Итого начислено</th>
                    <th className="is-num">Выплачено</th>
                    <th className="is-num">К выплате</th>
                    <th>Статус</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {payrollRows.map((row) => {
                    const bonuses = Math.max(0, row.payroll.bonusPenaltyCents);
                    const penalties = Math.min(0, row.payroll.bonusPenaltyCents);
                    return (
                      <tr
                        key={row.login}
                        className="eco-payroll-clickable-row"
                        onClick={() => setSelectedLogin(row.login)}
                      >
                        <td>
                          <div className="eco-payroll-person">
                            <span>{row.name.slice(0, 2).toUpperCase()}</span>
                            <div>
                              <strong>{row.name}</strong>
                              <small>@{row.login}</small>
                            </div>
                          </div>
                        </td>
                        <td>{roleShortLabel(row.role)}</td>
                        <td className="is-num">{formatDays(row.workDaysCount)}</td>
                        <td className="is-num">{row.actualShiftsCount}</td>
                        <td className="is-num">{formatMoney(row.payroll.shiftTotalCents)}</td>
                        <td className="is-num">{formatMoney(row.payroll.pieceworkCents)}</td>
                        <td className="is-num is-positive">{formatMoney(bonuses)}</td>
                        <td className="is-num is-negative">{formatMoney(penalties)}</td>
                        <td className="is-num is-strong">{formatMoney(row.payroll.totalCents)}</td>
                        <td className="is-num">{formatMoney(row.payroll.paidOutCents)}</td>
                        <td className="is-num is-strong">{formatMoney(row.payroll.remainingCents)}</td>
                        <td><StatusBadge status={row.status} /></td>
                        <td className="is-actions">
                          <button
                            type="button"
                            className="eco-icon-btn"
                            title="Открыть детализацию"
                            onClick={(event) => {
                              event.stopPropagation();
                              setSelectedLogin(row.login);
                            }}
                          >
                            <PanelRightOpen size={15} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {canManagePayroll && payroll && (
            <div className="eco-payroll-close-row">
              <div>
                <strong>{isClosedPeriod ? "Период закрыт" : "Закрытие периода"}</strong>
                <span>
                  После закрытия расчёт доступен только для просмотра, а новые правила не влияют задним числом.
                </span>
              </div>
              <EcoButton type="button" onClick={closePeriod} disabled={isClosedPeriod || payrollRows.some((row) => row.status === "has_errors")}>
                <FileText size={15} />
                Закрыть период
              </EcoButton>
            </div>
          )}
        </section>
      )}

      {activeTab === "workdays" && (
        <section className="eco-payroll-workspace eco-payroll-calendar-view">
          <div className="eco-payroll-toolbar">
            <div>
              <div className="eco-page-kicker">Рабочие дни сотрудников</div>
              <p>Крупный календарь графика, фактических смен и пропусков.</p>
            </div>
            <div className="eco-payroll-controls">
              <div className="eco-payroll-month-nav">
                <button type="button" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))}>
                  <ChevronLeft size={16} />
                </button>
                <strong>{getMonthLabel(calendarDate)}</strong>
                <button type="button" onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))}>
                  <ChevronRight size={16} />
                </button>
              </div>
              <EcoButton type="button" size="sm" onClick={() => {
                const today = new Date();
                const todayKey = toLocalDateInputValue(today);
                setCalendarDate(new Date(today.getFullYear(), today.getMonth(), 1));
                applyDateSelection([todayKey], todayKey);
              }}>
                Сегодня
              </EcoButton>
            </div>
          </div>

          <div className="eco-payroll-calendar-topline">
            <div className="eco-payroll-calendar-filters" aria-label="Фильтр дней">
              {[
                ["all", "Все"],
                ["working", "Рабочие"],
                ["actual", "Смены"],
                ["absence", "Пропуски"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={calendarFilter === value ? "is-active" : ""}
                  onClick={() => setCalendarFilter(value as typeof calendarFilter)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className={`eco-payroll-save-state is-${calendarSaveStatus}`}>
              {calendarBusy || calendarSaveStatus === "saving"
                ? "Сохраняем..."
                : calendarSaveStatus === "saved"
                  ? "Сохранено"
                  : selectedDatesCount > 1
                    ? "Есть выбранные дни"
                    : "Готово"}
            </div>
          </div>

          <div className="eco-payroll-employee-strip">
            {isOwner && (
              <button
                type="button"
                className={!calendarLogin ? "is-active" : ""}
                onClick={() => setCalendarLogin("")}
              >
                Все сотрудники
              </button>
            )}
            {teamUsers.map((user) => (
              <button
                key={user.login}
                type="button"
                className={normalizeLogin(calendarLogin) === normalizeLogin(user.login) ? "is-active" : ""}
                onClick={() => setCalendarLogin(user.login)}
              >
                {user.name} · {calendarCounts.get(normalizeLogin(user.login))?.size ?? 0}
              </button>
            ))}
          </div>

          {canManagePayroll && (
            <div className="eco-payroll-selection-tools">
              <div className="eco-payroll-quick-select">
                <EcoButton type="button" size="sm" onClick={toggleMultiSelectMode}>
                  {multiSelectEnabled ? "Одиночный выбор" : "Выбрать несколько"}
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => selectCalendarPreset("weekdays")}>
                  Выбрать будни
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => selectCalendarPreset("weekends")}>
                  Выбрать выходные
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => selectCalendarPreset("week")}>
                  Выбрать всю неделю
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => selectCalendarPreset("month")}>
                  Выбрать весь месяц
                </EcoButton>
                <EcoButton type="button" size="sm" variant="ghost" onClick={() => selectCalendarPreset("clear")}>
                  Очистить выбор
                </EcoButton>
              </div>
              <div className="eco-payroll-bulk-actions">
                <EcoButton type="button" size="sm" variant="primary" onClick={() => void runSelectedDaysAction("mark-working")} disabled={calendarBusy || selectedDatesCount === 0}>
                  Назначить выбранные рабочими
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => void runSelectedDaysAction("clear-working")} disabled={calendarBusy || selectedDatesCount === 0}>
                  Снять рабочие дни
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => void runSelectedDaysAction("add-shift")} disabled={calendarBusy || selectedDatesCount === 0}>
                  Добавить смену
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => void runSelectedDaysAction("clear-shift")} disabled={calendarBusy || selectedDatesCount === 0}>
                  Очистить смены
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => void runSelectedDaysAction("mark-absence")} disabled={calendarBusy || selectedDatesCount === 0}>
                  Отметить пропуском
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => void runSelectedDaysAction("add-comment")} disabled={calendarBusy || selectedDatesCount === 0}>
                  Добавить комментарий
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => void runSelectedDaysAction("clear-comment")} disabled={calendarBusy || selectedDatesCount === 0}>
                  Очистить комментарии
                </EcoButton>
                <EcoButton type="button" size="sm" variant="ghost" onClick={() => void runSelectedDaysAction("reset-local")} disabled={calendarBusy || selectedDatesCount === 0}>
                  Сбросить выбранные изменения
                </EcoButton>
              </div>
              <div className="eco-payroll-month-actions">
                <EcoButton type="button" size="sm" onClick={() => void runBulkWorkingDays("copy")} disabled={calendarBusy}>
                  Скопировать график прошлого месяца
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => void runBulkWorkingDays("clear")} disabled={calendarBusy}>
                  Очистить месяц
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => void runBulkWorkingDays("masters")} disabled={calendarBusy || !calendarLogin}>
                  Применить ко всем мастерам
                </EcoButton>
              </div>
            </div>
          )}

          <div className="eco-payroll-calendar-layout">
            <div className="eco-payroll-calendar-shell">
              <div className="eco-payroll-calendar-legend">
                <span><i className="is-working" /> Рабочий день</span>
                <span><i className="is-actual" /> Фактическая смена</span>
                <span><i className="is-absence" /> Отсутствие / пропуск</span>
              </div>
              {calendarLoading ? (
                <SkeletonRows rows={5} />
              ) : (
                <div className="eco-payroll-calendar-grid" onPointerLeave={endCalendarDrag}>
                  {WEEKDAYS.map((weekday) => (
                    <div key={weekday} className="eco-payroll-calendar-weekday">{weekday}</div>
                  ))}
                  {(() => {
                    const { daysInMonth, startPad } = getMonthBounds(calendarDate.getFullYear(), calendarDate.getMonth());
                    const todayKey = toLocalDateInputValue(new Date());
                    const cells = [
                      ...Array.from({ length: startPad }, (_, index) => ({ key: `empty-${index}`, day: null as number | null })),
                      ...Array.from({ length: daysInMonth }, (_, index) => ({ key: `day-${index + 1}`, day: index + 1 })),
                    ];
                    return cells.map(({ key, day }) => {
                      if (day == null) return <span key={key} className="eco-payroll-calendar-empty" />;
                      const dateKey = `${calendarDate.getFullYear()}-${String(calendarDate.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                      const dayState = getEffectiveDayState(dateKey);
                      const { hasWorking, hasActual, hasAbsence, items } = dayState;
                      const hiddenByFilter =
                        (calendarFilter === "working" && !hasWorking) ||
                        (calendarFilter === "actual" && !hasActual) ||
                        (calendarFilter === "absence" && !hasAbsence);
                      const isSelected = selectedDates.has(dateKey);
                      const prevDate = getDateRangeKeys(dateKey, dateKey)[0]
                        ? toLocalDateInputValue(new Date(new Date(`${dateKey}T00:00:00`).setDate(new Date(`${dateKey}T00:00:00`).getDate() - 1)))
                        : "";
                      const nextDate = getDateRangeKeys(dateKey, dateKey)[0]
                        ? toLocalDateInputValue(new Date(new Date(`${dateKey}T00:00:00`).setDate(new Date(`${dateKey}T00:00:00`).getDate() + 1)))
                        : "";
                      const isRangeStart = isSelected && !selectedDates.has(prevDate);
                      const isRangeEnd = isSelected && !selectedDates.has(nextDate);
                      return (
                        <button
                          key={dateKey}
                          type="button"
                          className={[
                            "eco-payroll-calendar-day",
                            isSelected ? "is-selected" : "",
                            isSelected && selectedDatesCount > 1 ? "is-range" : "",
                            isRangeStart && selectedDatesCount > 1 ? "is-range-start" : "",
                            isRangeEnd && selectedDatesCount > 1 ? "is-range-end" : "",
                            todayKey === dateKey ? "is-today" : "",
                            hasWorking ? "has-working" : "",
                            hasActual ? "has-actual" : "",
                            hasAbsence ? "has-absence" : "",
                            hiddenByFilter ? "is-muted" : "",
                          ].filter(Boolean).join(" ")}
                          onPointerDown={(event) => handleCalendarPointerDown(dateKey, event)}
                          onPointerEnter={() => handleCalendarPointerEnter(dateKey)}
                          onPointerUp={endCalendarDrag}
                          onClick={(event) => handleCalendarDayClick(dateKey, event)}
                        >
                          <span>{day}</span>
                          <small>{items.length > 1 ? items.length : ""}</small>
                          <i />
                        </button>
                      );
                    });
                  })()}
                </div>
              )}
            </div>

            <aside className="eco-payroll-day-panel">
              {selectedDatesCount > 1 ? (
                <>
                  <div className="eco-page-kicker">Выбрано дней</div>
                  <h3>{selectedDatesCount}</h3>
                  <dl>
                    <div>
                      <dt>Сотрудник</dt>
                      <dd>
                        {calendarLogin
                          ? teamUsers.find((user) => normalizeLogin(user.login) === normalizeLogin(calendarLogin))?.name ?? calendarLogin
                          : "Все сотрудники"}
                      </dd>
                    </div>
                    <div>
                      <dt>Период</dt>
                      <dd>{formatDate(firstSelectedDate)} - {formatDate(lastSelectedDate)}</dd>
                    </div>
                    <div>
                      <dt>Рабочих уже</dt>
                      <dd>{selectedBulkStats.working}</dd>
                    </div>
                    <div>
                      <dt>Выходных</dt>
                      <dd>{selectedDatesCount - selectedBulkStats.working}</dd>
                    </div>
                    <div>
                      <dt>Со сменами</dt>
                      <dd>{selectedBulkStats.actual}</dd>
                    </div>
                    <div>
                      <dt>Пропуски</dt>
                      <dd>{selectedBulkStats.absence}</dd>
                    </div>
                  </dl>
                  <div className="eco-payroll-day-actions">
                    <EcoButton type="button" size="sm" variant="primary" onClick={() => void runSelectedDaysAction("mark-working")} disabled={!canManagePayroll || calendarBusy}>
                      Отметить рабочими
                    </EcoButton>
                    <EcoButton type="button" size="sm" onClick={() => void runSelectedDaysAction("clear-working")} disabled={!canManagePayroll || calendarBusy}>
                      Снять рабочие дни
                    </EcoButton>
                    <EcoButton type="button" size="sm" onClick={() => void runSelectedDaysAction("add-shift")} disabled={!canManagePayroll || calendarBusy}>
                      Добавить смену
                    </EcoButton>
                    <EcoButton type="button" size="sm" onClick={() => void runSelectedDaysAction("clear-shift")} disabled={!canManagePayroll || calendarBusy}>
                      Очистить смены
                    </EcoButton>
                    <EcoButton type="button" size="sm" onClick={() => void runSelectedDaysAction("add-comment")} disabled={!canManagePayroll || calendarBusy}>
                      Добавить комментарий
                    </EcoButton>
                    <EcoButton type="button" size="sm" variant="ghost" onClick={() => selectCalendarPreset("clear")}>
                      Сбросить выбор
                    </EcoButton>
                  </div>
                </>
              ) : (
                <>
                  <div className="eco-page-kicker">Выбранный день</div>
                  <h3>{formatDate(selectedDate)}</h3>
                  <dl>
                    <div>
                      <dt>Сотрудник</dt>
                      <dd>
                        {calendarLogin
                          ? teamUsers.find((user) => normalizeLogin(user.login) === normalizeLogin(calendarLogin))?.name ?? calendarLogin
                          : `Все сотрудники (${selectedDayItems.length})`}
                      </dd>
                    </div>
                    <div>
                      <dt>Рабочий день</dt>
                      <dd>{selectedDayWorking ? "Да" : "Нет"}</dd>
                    </div>
                    <div>
                      <dt>Фактическая смена</dt>
                      <dd>{selectedDayActual ? "Есть" : "Нет"}</dd>
                    </div>
                    <div>
                      <dt>Часы</dt>
                      <dd>{selectedDayActual || selectedDayWorking ? formatHours(8) : "—"}</dd>
                    </div>
                  </dl>
                  <textarea
                    className="eco-input eco-payroll-comment"
                    value={dayComments[selectedDayCommentKey] ?? ""}
                    onChange={(event) =>
                      setDayComments((prev) => ({ ...prev, [selectedDayCommentKey]: event.target.value }))
                    }
                    placeholder="Комментарий к дню"
                    rows={3}
                  />
                  <div className="eco-payroll-day-actions">
                    <EcoButton type="button" size="sm" onClick={() => void toggleWorkingDay(selectedDate, true)} disabled={!canManagePayroll || calendarBusy || selectedDayWorking}>
                      Отметить рабочим
                    </EcoButton>
                    <EcoButton type="button" size="sm" onClick={() => void toggleWorkingDay(selectedDate, false)} disabled={!canManagePayroll || calendarBusy || !selectedDayWorking}>
                      Снять рабочий день
                    </EcoButton>
                    <EcoButton type="button" size="sm" onClick={() => void runSelectedDaysAction("add-shift")} disabled={!canManagePayroll || calendarBusy}>
                      Добавить смену
                    </EcoButton>
                    <EcoButton type="button" size="sm" variant="ghost" onClick={() => setToast("Комментарий сохранён локально")}>
                      Добавить комментарий
                    </EcoButton>
                  </div>
                </>
              )}
            </aside>
          </div>
        </section>
      )}

      {activeTab === "rules" && canManagePayroll && (
        <section className="eco-payroll-workspace eco-payroll-rules-view">
          <div className="eco-payroll-toolbar">
            <div>
              <div className="eco-page-kicker">Правила сдельной части</div>
              <p>Проценты и фиксированные начисления по услугам и товарным группам.</p>
            </div>
            <div className="eco-payroll-rule-summary">
              <span>Услуги · {rules.filter((rule) => rule.targetType === "service").length}</span>
              <span>Группы товаров · {rules.filter((rule) => rule.targetType === "product_group").length}</span>
              <span>Индивидуальные · 0</span>
              <span>Дефолтные · {rules.filter((rule) => rule.isDefault).length}</span>
            </div>
          </div>

          <div className="eco-payroll-rule-filters">
            <label className="eco-payroll-search">
              <Search size={15} />
              <EcoInput
                value={ruleSearch}
                onChange={(event) => setRuleSearch(event.target.value)}
                placeholder="Поиск по услуге или группе"
              />
            </label>
            <EcoSelect value={ruleRoleFilter} onChange={(event) => setRuleRoleFilter(event.target.value)}>
              <option value="all">Все роли</option>
              <option value="master">Мастер</option>
              <option value="admin">Администратор</option>
            </EcoSelect>
            <EcoSelect value={ruleModeFilter} onChange={(event) => setRuleModeFilter(event.target.value)}>
              <option value="all">Все режимы</option>
              <option value="percent">Процент</option>
              <option value="fixed">Фикс</option>
            </EcoSelect>
            <EcoSelect value={ruleStatusFilter} onChange={(event) => setRuleStatusFilter(event.target.value)}>
              <option value="all">Все статусы</option>
              <option value="changed">Изменённые</option>
              <option value="default">Дефолтные</option>
              <option value="missing">Без правила</option>
              <option value="disabled">Отключено</option>
            </EcoSelect>
          </div>

          {rulesLoading ? (
            <SkeletonRows rows={6} />
          ) : rules.length === 0 ? (
            <EmptyState
              title="Правила сдельной части не настроены"
              text="Добавьте правила для услуг и групп товаров."
            />
          ) : (
            <div className="eco-payroll-rule-sections">
              {ruleSections.map((section) => (
                <div key={section.id} className="eco-payroll-rule-section">
                  <div className="eco-payroll-section-title">
                    <strong>{section.title}</strong>
                    <span>{section.rows.length}</span>
                  </div>
                  {section.rows.length === 0 ? (
                    <EmptyState title="Нет правил в этой группе" text="Измените поиск или фильтры." />
                  ) : (
                    <div className="eco-table-wrap eco-payroll-rules-table-wrap">
                      <table className="eco-table eco-payroll-rules-table">
                        <thead>
                          <tr>
                            <th>Тип</th>
                            <th>Название</th>
                            <th>Роль</th>
                            <th>Режим</th>
                            <th>Значение</th>
                            <th>Основа расчёта</th>
                            <th>Статус</th>
                            <th>Действия</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.map((rule) => {
                            const key = ruleKey(rule);
                            const draft = draftRules[key] ?? makeRuleDraft(rule);
                            const status = getRuleStatus(rule);
                            const error = ruleErrors[key];
                            return (
                              <tr key={key} className={status === "changed" ? "is-dirty" : ""}>
                                <td>{targetTypeLabel(rule.targetType)}</td>
                                <td>
                                  <strong>{rule.targetName}</strong>
                                  <small>{rule.targetId}</small>
                                </td>
                                <td>{roleShortLabel(rule.role)}</td>
                                <td>
                                  <EcoSelect
                                    value={draft.mode}
                                    onChange={(event) => {
                                      const modeValue = event.target.value as DraftRule["mode"];
                                      updateRuleDraft(key, {
                                        mode: modeValue,
                                        value:
                                          modeValue === "fixed"
                                            ? formatFixedInput(rule.fixedCents)
                                            : formatPercentInput(rule.percentBasisPoints),
                                      });
                                    }}
                                  >
                                    <option value="percent">Процент</option>
                                    <option value="fixed">Фикс</option>
                                  </EcoSelect>
                                </td>
                                <td>
                                  <div className="eco-payroll-value-field">
                                    {draft.mode === "fixed" ? (
                                      <MoneyInput
                                        value={draft.value}
                                        onValueChange={(value, valueDraft) =>
                                          updateRuleDraft(key, { value: valueDraft ? String(value) : "" })
                                        }
                                        className="eco-input"
                                        placeholder="0"
                                      />
                                    ) : (
                                      <EcoInput
                                        inputMode="decimal"
                                        value={draft.value}
                                        onChange={(event) => updateRuleDraft(key, { value: event.target.value })}
                                        placeholder="0"
                                      />
                                    )}
                                    <span>{draft.mode === "fixed" ? "₽" : "%"}</span>
                                  </div>
                                  {error && <small className="eco-payroll-row-error">{error}</small>}
                                </td>
                                <td>{ruleBasisLabel(rule, draft.mode)}</td>
                                <td>
                                  {status === "changed" && <EcoBadge tone="rust">Есть изменения</EcoBadge>}
                                  {status === "default" && <EcoBadge tone="neutral">Дефолт</EcoBadge>}
                                  {status === "custom" && <EcoBadge tone="rust">Изменено</EcoBadge>}
                                  {status === "missing" && <EcoBadge tone="warning">Не настроено</EcoBadge>}
                                  {status === "disabled" && <EcoBadge tone="neutral">Отключено</EcoBadge>}
                                </td>
                                <td>
                                  <button
                                    type="button"
                                    className="eco-icon-btn"
                                    title="Отменить изменение строки"
                                    onClick={() =>
                                      setDraftRules((prev) => ({ ...prev, [key]: makeRuleDraft(rule) }))
                                    }
                                    disabled={status !== "changed"}
                                  >
                                    <X size={14} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="eco-payroll-rules-footer">
            <div>
              <strong>{changedRulesCount > 0 ? `${changedRulesCount} правил изменено` : "Нет несохранённых изменений"}</strong>
              <span>{rulesMessage ?? "Изменённые строки сохраняются одной кнопкой."}</span>
            </div>
            <EcoButton type="button" onClick={resetRuleDrafts} disabled={!hasUnsavedRuleChanges || rulesSaving}>
              Отменить изменения
            </EcoButton>
            <EcoButton type="button" variant="primary" onClick={() => void saveChangedRules()} disabled={!hasUnsavedRuleChanges || rulesSaving}>
              {rulesSaving ? <Loader2 size={15} className="eco-spin" /> : <Save size={15} />}
              Сохранить изменения
            </EcoButton>
          </div>
        </section>
      )}

      {activeTab === "rates" && canManagePayroll && (
        <section className="eco-payroll-workspace">
          <div className="eco-payroll-toolbar">
            <div>
              <div className="eco-page-kicker">Ставки</div>
              <p>Фиксированная ставка за смену, сдельная часть, активность и дата изменения.</p>
            </div>
            <EcoButton type="button" onClick={() => void loadRates()} disabled={ratesLoading}>
              {ratesLoading ? <Loader2 size={15} className="eco-spin" /> : <RefreshCw size={15} />}
              Обновить
            </EcoButton>
          </div>

          {ratesLoading && rates.length === 0 ? (
            <SkeletonRows rows={5} />
          ) : (
            <div className="eco-table-wrap eco-payroll-table-wrap">
              <table className="eco-table eco-payroll-table">
                <thead>
                  <tr>
                    <th>Сотрудник</th>
                    <th>Роль</th>
                    <th className="is-num">Ставка</th>
                    <th>Сдельная часть</th>
                    <th>Активен</th>
                    <th>Дата изменения</th>
                    <th>Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {teamUsers.map((user) => {
                    const rate = rateByLogin.get(normalizeLogin(user.login))?.amountCents ?? null;
                    const row = payrollRows.find((item) => normalizeLogin(item.login) === normalizeLogin(user.login));
                    return (
                      <tr key={user.login}>
                        <td>
                          <div className="eco-payroll-person">
                            <span>{user.name.slice(0, 2).toUpperCase()}</span>
                            <div>
                              <strong>{user.name}</strong>
                              <small>@{user.login}</small>
                            </div>
                          </div>
                        </td>
                        <td>{roleShortLabel(user.role ?? "master")}</td>
                        <td className="is-num">{rate == null ? "Не задана" : `${formatMoney(rate)} / смена`}</td>
                        <td>{row ? formatMoney(row.payroll.pieceworkCents) : "—"}</td>
                        <td><EcoBadge tone="success">Активен</EcoBadge></td>
                        <td>{formatDate(dateFrom)}</td>
                        <td>
                          <EcoButton type="button" size="sm" onClick={() => setRateDrawerLogin(user.login)}>
                            Редактировать
                          </EcoButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === "history" && (
        <section className="eco-payroll-workspace">
          <div className="eco-payroll-toolbar">
            <div>
              <div className="eco-page-kicker">История выплат и изменений</div>
              <p>Кто, когда и что менял в ставках, правилах, рабочих днях и корректировках.</p>
            </div>
            <div className="eco-payroll-controls">
              <EcoButton type="button" onClick={() => void loadHistory()} disabled={historyLoading}>
                {historyLoading ? <Loader2 size={15} className="eco-spin" /> : <RefreshCw size={15} />}
                Обновить
              </EcoButton>
              <EcoButton type="button" onClick={() => window.print()}>
                <Download size={15} />
                Экспорт
              </EcoButton>
            </div>
          </div>

          <div className="eco-payroll-history-grid">
            <div className="eco-payroll-history-block">
              <div className="eco-payroll-section-title">
                <strong>Фактические выплаты</strong>
                <span>{cashoutHistory.length}</span>
              </div>
              {cashoutHistory.length === 0 ? (
                <EmptyState title="Выплат за период нет" text="Когда появятся РКО по зарплате или авансам, они отобразятся здесь." />
              ) : (
                <div className="eco-payroll-history-list">
                  {cashoutHistory.map((item) => (
                    <div key={item.cashoutId}>
                      <span>{formatDate(item.date)}</span>
                      <strong>{formatMoney(item.sumCents)}</strong>
                      <p>{userByLogin.get(normalizeLogin(item.login))?.name ?? item.login} · {item.paymentPurpose || item.name}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="eco-payroll-history-block">
              <div className="eco-payroll-section-title">
                <strong>История изменений</strong>
                <span>{history.length}</span>
              </div>
              {historyLoading ? (
                <SkeletonRows rows={5} />
              ) : history.length === 0 ? (
                <EmptyState title="История пока пуста" text="Сохранённые правила, ставки и корректировки появятся в этом журнале." />
              ) : (
                <div className="eco-payroll-history-list">
                  {history.map((item) => (
                    <div key={item.id}>
                      <span>{formatDateTime(item.createdAt)} · @{item.performedByLogin}</span>
                      <strong>{item.entityType.replaceAll("_", " ")} · {item.action}</strong>
                      <p>
                        {summarizeHistoryValue(item.oldValue)} → {summarizeHistoryValue(item.newValue)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {selectedRow && (
        <div className="eco-payroll-drawer-backdrop" onClick={() => setSelectedLogin(null)}>
          <aside className="eco-payroll-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="eco-payroll-drawer__head">
              <div>
                <span className="eco-page-kicker">Детализация сотрудника</span>
                <h2>{selectedRow.name}</h2>
                <p>{roleShortLabel(selectedRow.role)} · {formatDate(dateFrom)} - {formatDate(dateTo)}</p>
              </div>
              <button type="button" className="eco-icon-btn" onClick={() => setSelectedLogin(null)} title="Закрыть">
                <X size={16} />
              </button>
            </div>

            <div className="eco-payroll-drawer-total">
              <span>Итог к выплате</span>
              <strong>{formatMoney(selectedRow.payroll.remainingCents)}</strong>
              <StatusBadge status={selectedRow.status} />
            </div>

            <div className="eco-payroll-detail-grid">
              <div>
                <span>Рабочие дни</span>
                <strong>{formatDays(selectedRow.workDaysCount)}</strong>
              </div>
              <div>
                <span>Смены</span>
                <strong>{selectedRow.actualShiftsCount}</strong>
              </div>
              <div>
                <span>Фиксированная ставка</span>
                <strong>{formatMoney(selectedRow.payroll.shiftTotalCents)}</strong>
              </div>
              <div>
                <span>Сдельная часть</span>
                <strong>{formatMoney(selectedRow.payroll.pieceworkCents)}</strong>
              </div>
              <div>
                <span>Услуги</span>
                <strong>{formatMoney(selectedWorkPiecework)}</strong>
              </div>
              <div>
                <span>Продажи товаров</span>
                <strong>{formatMoney(selectedProductPiecework)}</strong>
              </div>
              <div>
                <span>Ручные корректировки</span>
                <strong>{formatMoney(selectedRow.payroll.bonusPenaltyCents)}</strong>
              </div>
              <div>
                <span>Выплаты</span>
                <strong>{formatMoney(selectedRow.payroll.paidOutCents)}</strong>
              </div>
            </div>

            <div className="eco-payroll-drawer-section">
              <strong>Сдельные начисления</strong>
              {selectedBreakdown.length === 0 ? (
                <p>За выбранный период сдельных начислений нет.</p>
              ) : (
                <div className="eco-payroll-breakdown-list">
                  {selectedBreakdown.slice(0, 12).map((item, index) => (
                    <div key={`${item.demandName}-${item.label}-${index}`}>
                      <span>{formatDate(item.date)} · {item.category === "work" ? "Услуга" : "Товар"}</span>
                      <strong>{formatMoney(item.amountCents)}</strong>
                      <p>{item.label} × {item.quantity} · {item.demandName}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="eco-payroll-drawer-section">
              <strong>Выплаты</strong>
              {selectedCashouts.length === 0 ? (
                <p>Фактических выплат за период нет.</p>
              ) : (
                <div className="eco-payroll-breakdown-list">
                  {selectedCashouts.map((item) => (
                    <div key={item.cashoutId}>
                      <span>{formatDate(item.date)} · {item.agentName || "Расходный ордер"}</span>
                      <strong>{formatMoney(item.sumCents)}</strong>
                      <p>{item.paymentPurpose || item.description || item.name}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="eco-payroll-drawer-section">
              <strong>Комментарий</strong>
              <textarea
                className="eco-input eco-payroll-comment"
                value={drawerComment}
                onChange={(event) => setDrawerComment(event.target.value)}
                placeholder="Комментарий к расчёту"
                rows={3}
              />
            </div>

            {adjustmentOpen && canManagePayroll && (
              <form className="eco-payroll-adjustment" onSubmit={submitAdjustment}>
                <FieldLabel label="Дата">
                  <EcoInput type="date" value={adjustmentDate} onChange={(event) => setAdjustmentDate(event.target.value)} />
                </FieldLabel>
                <FieldLabel label="Тип">
                  <EcoSelect value={adjustmentType} onChange={(event) => setAdjustmentType(event.target.value as typeof adjustmentType)}>
                    <option value="bonus">Бонус</option>
                    <option value="penalty_manual">Удержание</option>
                  </EcoSelect>
                </FieldLabel>
                <FieldLabel label="Сумма">
                  <MoneyInput
                    value={adjustmentAmount}
                    onValueChange={(_, draft) => setAdjustmentAmount(draft)}
                    className="eco-input"
                    placeholder="0"
                  />
                </FieldLabel>
                <FieldLabel label="Комментарий">
                  <EcoInput value={adjustmentComment} onChange={(event) => setAdjustmentComment(event.target.value)} />
                </FieldLabel>
                <EcoButton type="submit" variant="primary" disabled={adjustmentSaving}>
                  {adjustmentSaving ? <Loader2 size={15} className="eco-spin" /> : <Save size={15} />}
                  Сохранить корректировку
                </EcoButton>
              </form>
            )}

            <div className="eco-payroll-drawer__footer">
              <EcoButton type="button" onClick={() => setToast("Расчёт сохранён")}>
                <Save size={15} />
                Сохранить расчёт
              </EcoButton>
              {canManagePayroll && (
                <EcoButton type="button" onClick={() => markAsPaid(selectedRow)}>
                  <Check size={15} />
                  Отметить как выплачено
                </EcoButton>
              )}
              {canManagePayroll && (
                <EcoButton type="button" onClick={() => setAdjustmentOpen((value) => !value)}>
                  Добавить корректировку
                </EcoButton>
              )}
              <EcoButton type="button" onClick={() => window.print()}>
                <Printer size={15} />
                Печать расчёта
              </EcoButton>
            </div>
          </aside>
        </div>
      )}

      {rateDrawerRow && (
        <div className="eco-payroll-drawer-backdrop" onClick={() => setRateDrawerLogin(null)}>
          <aside className="eco-payroll-drawer eco-payroll-rate-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="eco-payroll-drawer__head">
              <div>
                <span className="eco-page-kicker">Редактирование ставки</span>
                <h2>{rateDrawerRow.name}</h2>
                <p>{roleShortLabel(rateDrawerRow.role)} · действует с выбранной даты</p>
              </div>
              <button type="button" className="eco-icon-btn" onClick={() => setRateDrawerLogin(null)} title="Закрыть">
                <X size={16} />
              </button>
            </div>
            <FieldLabel label="Ставка за смену">
              <MoneyInput
                value={rateDraft}
                onValueChange={(_, draft) => setRateDraft(draft)}
                className="eco-input"
                placeholder="0"
              />
            </FieldLabel>
            <div className="eco-payroll-detail-grid">
              <div>
                <span>Текущая ставка</span>
                <strong>{rateDrawerRow.rateCents == null ? "Не задана" : formatMoney(rateDrawerRow.rateCents)}</strong>
              </div>
              <div>
                <span>Рабочие дни</span>
                <strong>{formatDays(rateDrawerRow.workDaysCount)}</strong>
              </div>
              <div>
                <span>Сдельная часть</span>
                <strong>{formatMoney(rateDrawerRow.payroll.pieceworkCents)}</strong>
              </div>
              <div>
                <span>Активность</span>
                <strong>Активен</strong>
              </div>
            </div>
            <div className="eco-payroll-drawer__footer">
              <EcoButton type="button" onClick={() => void saveRate(false)} disabled={rateSaving}>
                Сохранить ставку
              </EcoButton>
              <EcoButton type="button" variant="primary" onClick={() => void saveRate(true)} disabled={rateSaving}>
                {rateSaving ? <Loader2 size={15} className="eco-spin" /> : <Save size={15} />}
                Применить на период
              </EcoButton>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
