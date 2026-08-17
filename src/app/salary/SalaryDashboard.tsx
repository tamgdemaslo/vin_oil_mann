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
type SalaryTab =
  | "calculation"
  | "workdays"
  | "rates"
  | "rules"
  | "adjustments"
  | "payments"
  | "motivation"
  | "history";
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
    {
      category: "work" | "product";
      label: string;
      quantity: number;
      amountCents: number;
      ruleLabel?: string;
      basisLabel?: string;
      status?: "CONFIRMED" | "PRELIMINARY" | "NEEDS_DISTRIBUTION" | "MISSING_RULE" | "CONFLICT" | "REVERSED" | "PAID";
    }[]
  >;
  unallocatedPiecework?: {
    category: "work" | "product";
    label: string;
    quantity: number;
    baseCents: number;
    reason: "missing_master" | "multiple_masters" | "missing_admin" | "multiple_admins" | "missing_rule";
    logins?: string[];
  }[];
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
    sourceType?: "cash_expense_order" | "payroll_payment";
    paymentMethod?: string;
    operationType?: string;
    cashOrderId?: string | null;
  }[];
};

type SavedAdjustment = {
  employeeName: string;
  operationTitle: string;
  amountCents: number;
  date: string;
  refreshFailed: boolean;
};

type UnallocatedPieceworkReason = NonNullable<VehicleRecord["unallocatedPiecework"]>[number]["reason"];

type UnallocatedPieceworkLine = NonNullable<VehicleRecord["unallocatedPiecework"]>[number] & {
  demandId: string;
  demandName: string;
  date: string;
  agentName: string;
};

type ShiftProblemContext = {
  date: string;
  role: "master" | "admin";
  needsSingleEmployee: boolean;
  item?: UnallocatedPieceworkLine;
};

type PayrollProblemAction =
  | { kind: "retry" }
  | { kind: "rate"; employeeLogin: string }
  | { kind: "rules"; role: "master" | "admin" | null; instruction: string }
  | { kind: "shifts"; date: string; role: "master" | "admin"; needsSingleEmployee: boolean }
  | { kind: "unallocated"; reason: UnallocatedPieceworkReason }
  | { kind: "adjustments" }
  | { kind: "none" };

type PayrollProblem = {
  id: string;
  title: string;
  text: string;
  severity: "warning" | "danger";
  actionLabel?: string;
  action: PayrollProblemAction;
};

type ShiftRateItem = {
  login: string;
  name: string;
  amountCents: number | null;
};

type PayrollShiftItem = {
  id: string;
  userLogin: string;
  date: string;
  createdByLogin: string;
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

type BonusPenaltyItem = {
  id: string;
  userLogin?: string;
  employeeId?: string;
  date?: string;
  operationDate?: string;
  amountCents: number;
  type: string;
  reasonCode?: string | null;
  comment: string | null;
  status?: string;
  sourceType?: string | null;
  sourceId?: string | null;
  createdByLogin?: string;
  createdById?: string;
  createdAt: string;
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

type PayrollPeriodItem = {
  id: string;
  organizationId: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  closedByLogin: string;
  closedAt: string;
  totalAccruedCents: number;
  totalPaidCents: number;
  totalRemainingCents: number;
  employeesCount: number;
  createdAt: string;
  updatedAt: string;
};

type EmployeeAccrualStatus =
  | "CONFIRMED"
  | "PRELIMINARY"
  | "NEEDS_DISTRIBUTION"
  | "MISSING_RULE"
  | "CONFLICT"
  | "REVERSED"
  | "PAID";

type EmployeeShipmentCard = {
  id: string;
  name: string;
  date: string;
  clientName: string;
  vehicleLabel: string;
  roleInCalculation: "master" | "admin" | "employee";
  positionsCount: number;
  servicesCount: number;
  productsCount: number;
  earningsCents: number;
  status: EmployeeAccrualStatus;
  shipmentUrl: string;
  items: {
    category: "work" | "product";
    label: string;
    quantity: number;
    amountCents: number;
    ruleLabel?: string;
    basisLabel?: string;
    status?: EmployeeAccrualStatus;
  }[];
};

type EmployeeDashboardPeriod = {
  dateFrom: string;
  dateTo: string;
  totalCents: number;
  pieceworkCents: number;
  fixedCents: number;
  adjustmentsCents: number;
  paidCents: number;
  payableCents: number;
  workDays: number;
  shipments: number;
};

type EmployeeDashboardData = {
  employee: { login: string; name: string; role: string; preview?: boolean };
  status: EmployeeAccrualStatus;
  period: { dateFrom: string; dateTo: string };
  lastUpdatedAt: string;
  summary: EmployeeDashboardPeriod;
  today: EmployeeDashboardPeriod;
  shift: EmployeeDashboardPeriod;
  week: EmployeeDashboardPeriod;
  month: EmployeeDashboardPeriod;
  paid: number;
  payable: number;
  confirmed: { amountCents: number; note: string };
  preliminary: { amountCents: number; note: string };
  goals: {
    id: string;
    title: string;
    currentValue: number;
    targetValue: number;
    baselineValue?: number | null;
    stretchValue?: number | null;
    unit: "money" | "count" | "percent";
    status: string;
  }[];
  forecast: { available: boolean; lowCents: number; highCents: number; note: string };
  latestAccruals: EmployeeShipmentCard[];
  recentShipments: EmployeeShipmentCard[];
  teamProgress: {
    label: string;
    shipments: number;
    services: number;
    products: number;
    ownEarningsCents: number;
    goalLabel: string;
  };
  quality: { items: { label: string; value: string; tone: "neutral" | "success" | "warning" }[] };
  achievements: { id: string; title: string; text: string; unlockedAt: string }[];
  recognition: { id: string; title: string; message: string; authorName: string; createdAt: string }[];
  opportunities: { title: string; text: string; href: string }[];
};

type MotivationGoalItem = {
  id: string;
  employeeLogin: string | null;
  role: string | null;
  periodType: "SHIFT" | "WEEK" | "MONTH";
  metric: string;
  targetValue: number;
  baselineValue: number | null;
  stretchValue: number | null;
  startsAt: string;
  endsAt: string;
  status: string;
};

type MotivationRecognitionItem = {
  id: string;
  employeeLogin: string;
  authorLogin: string;
  title: string;
  message: string;
  reason: string;
  visibility: "PRIVATE" | "TEAM";
  createdAt: string;
};

type MotivationOverview = {
  users: { login: string; name: string; role: string }[];
  goals: MotivationGoalItem[];
  recognition: MotivationRecognitionItem[];
  metrics: {
    employeesWithGoals: number;
    activeGoals: number;
    recognitionCount: number;
  };
};

type PayrollRow = {
  login: string;
  name: string;
  role: UserRole;
  payroll: PayrollByLogin;
  rateCents: number | null;
  shiftsCount: number;
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
    label: "Смены",
    description: "Календарь смен, по которым начисляется зарплата",
    icon: CalendarDays,
  },
  rules: {
    label: "Сдельные правила",
    description: "Проценты и фиксированные начисления",
    icon: Settings2,
  },
  rates: {
    label: "Ставки смен",
    description: "Базовые ставки сотрудников",
    icon: Banknote,
  },
  adjustments: {
    label: "Корректировки",
    description: "Бонусы, штрафы, доплаты и удержания",
    icon: FileText,
  },
  payments: {
    label: "Выплаты",
    description: "Фактические выплаты и авансы",
    icon: Banknote,
  },
  motivation: {
    label: "Мотивация",
    description: "Цели, признание и видимость сотруднического экрана",
    icon: UserRound,
  },
  history: {
    label: "Периоды",
    description: "Закрытые периоды и журнал изменений",
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

const ACCRUAL_STATUS_META: Record<
  EmployeeAccrualStatus,
  { label: string; className: string }
> = {
  CONFIRMED: { label: "Подтверждено", className: "is-confirmed" },
  PRELIMINARY: { label: "Предварительно", className: "is-preliminary" },
  NEEDS_DISTRIBUTION: { label: "Требует распределения", className: "is-action" },
  MISSING_RULE: { label: "Требует правила", className: "is-action" },
  CONFLICT: { label: "Конфликт", className: "is-error" },
  REVERSED: { label: "Отменено", className: "is-muted" },
  PAID: { label: "Выплачено", className: "is-confirmed" },
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

function adjustmentTypeLabel(type: string) {
  const normalized = type.toUpperCase();
  if (type === "bonus" || normalized === "BONUS") return "Бонус";
  if (type === "penalty_late") return "Штраф за опоздание";
  if (type === "penalty_unclosed") return "Штраф за незакрытую смену";
  if (type === "penalty_manual" || normalized === "DEDUCTION") return "Удержание";
  if (normalized === "PENALTY") return "Штраф";
  if (normalized === "EXTRA_PAY") return "Доплата";
  if (normalized === "COMPENSATION") return "Компенсация";
  if (normalized === "ADVANCE_OFFSET") return "Зачёт аванса";
  if (normalized === "REVERSAL") return "Отмена операции";
  return type;
}

function adjustmentLogin(item: BonusPenaltyItem) {
  return item.employeeId ?? item.userLogin ?? "";
}

function getAdjustmentDate(item: BonusPenaltyItem) {
  return item.operationDate ?? item.date ?? "";
}

function adjustmentCreator(item: BonusPenaltyItem) {
  return item.createdById ?? item.createdByLogin ?? "";
}

function paymentOperationLabel(value?: string) {
  if (value === "ADVANCE") return "Аванс";
  if (value === "COMPENSATION") return "Компенсация";
  return "Зарплата";
}

function paymentOperationTitle(value: "SALARY" | "ADVANCE" | "COMPENSATION") {
  if (value === "ADVANCE") return "Аванс сотруднику";
  if (value === "COMPENSATION") return "Компенсация расходов";
  return "Выплата сотруднику";
}

function adjustmentOperationTitle(value: "BONUS" | "PENALTY" | "DEDUCTION" | "EXTRA_PAY" | "COMPENSATION") {
  if (value === "PENALTY") return "Штраф сотруднику";
  if (value === "DEDUCTION") return "Удержание из зарплаты";
  if (value === "EXTRA_PAY") return "Доплата сотруднику";
  if (value === "COMPENSATION") return "Компенсация к зарплате";
  return "Бонус сотруднику";
}

function paymentMethodLabel(value?: string) {
  if (value === "CASH") return "Наличные";
  if (value === "BANK_TRANSFER") return "Перевод";
  return "Другое";
}

function motivationMetricLabel(metric: string) {
  if (metric === "ACCRUAL_AMOUNT") return "Начисления";
  if (metric === "VEHICLES") return "Автомобили";
  if (metric === "SERVICES") return "Услуги";
  if (metric === "PRODUCTS") return "Товары";
  if (metric === "SHIPMENTS") return "Отгрузки";
  if (metric === "QUALITY") return "Качество";
  if (metric === "DIAGNOSTICS") return "Диагностики";
  if (metric === "APPROVED_RECOMMENDATIONS") return "Согласованные рекомендации";
  return metric;
}

function formatMotivationValue(metric: string, value: number) {
  return metric === "ACCRUAL_AMOUNT" ? formatMoney(value) : String(value);
}

function parseSalaryTab(value: string | null): SalaryTab {
  if (value === "workdays" || value === "shifts" || value === "working-days") return "workdays";
  if (value === "shift-rates" || value === "rates") return "rates";
  if (value === "piecework-rules" || value === "rules") return "rules";
  if (value === "adjustments" || value === "corrections") return "adjustments";
  if (value === "payments" || value === "payouts") return "payments";
  if (value === "motivation" || value === "goals") return "motivation";
  if (value === "history" || value === "periods") return "history";
  return "calculation";
}

function salaryTabQuery(tab: SalaryTab) {
  if (tab === "calculation") return "";
  if (tab === "rates") return "shift-rates";
  if (tab === "rules") return "piecework-rules";
  if (tab === "history") return "periods";
  return tab;
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

function getMonthBounds(year: number, month: number) {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    dateFrom: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    dateTo: `${year}-${String(month + 1).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`,
    daysInMonth,
    startPad: (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7,
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
  if (preset === "current") return getCurrentMonthRange();
  if (preset === "previous") {
    const [yearText, monthText] = getCurrentMonthRange().dateFrom.split("-");
    const previous = new Date(Date.UTC(Number(yearText), Number(monthText) - 2, 1));
    return getMonthBounds(previous.getUTCFullYear(), previous.getUTCMonth());
  }
  const days = preset === "7" ? 7 : 30;
  const dateTo = toLocalDateInputValue(new Date());
  const end = new Date(`${dateTo}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - days + 1);
  return { dateFrom: end.toISOString().slice(0, 10), dateTo };
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

function AccrualStatusPill({ status }: { status: EmployeeAccrualStatus }) {
  const meta = ACCRUAL_STATUS_META[status] ?? ACCRUAL_STATUS_META.PRELIMINARY;
  return <span className={`eco-payroll-accrual-status ${meta.className}`}>{meta.label}</span>;
}

function EmployeeShipmentCardView({ shipment }: { shipment: EmployeeShipmentCard }) {
  const [open, setOpen] = useState(false);
  const positionLabel =
    shipment.servicesCount > 0
      ? `${shipment.servicesCount} услуг`
      : shipment.productsCount > 0
        ? `${shipment.productsCount} товаров`
        : `${shipment.positionsCount} поз.`;

  return (
    <article className={`eco-payroll-earning-card ${open ? "is-open" : ""}`}>
      <button type="button" onClick={() => setOpen((value) => !value)} className="eco-payroll-earning-card__main">
        <div>
          <span>{formatDate(shipment.date)} · {shipment.clientName || "Клиент не указан"}</span>
          <strong>{shipment.name}</strong>
          <small>{shipment.vehicleLabel} · {positionLabel}</small>
        </div>
        <div>
          <b>{formatMoney(shipment.earningsCents)}</b>
          <AccrualStatusPill status={shipment.status} />
        </div>
      </button>

      {open && (
        <div className="eco-payroll-earning-card__details">
          {shipment.items.length === 0 ? (
            <p>Позиции пока не вошли в расчёт.</p>
          ) : (
            shipment.items.map((item, index) => (
              <div key={`${shipment.id}-${item.label}-${index}`}>
                <span>{item.category === "work" ? "Услуга" : "Товар"} · {item.ruleLabel ?? "Правило не указано"}</span>
                <strong>{formatMoney(item.amountCents)}</strong>
                <p>{item.label} × {item.quantity} · {item.basisLabel ?? "основа расчёта не указана"}</p>
              </div>
            ))
          )}
          <Link href={shipment.shipmentUrl}>Открыть отгрузку</Link>
        </div>
      )}
    </article>
  );
}

function EmployeeDashboardView({
  dashboard,
  loading,
  error,
  onReload,
}: {
  dashboard: EmployeeDashboardData | null;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const [shipmentFilter, setShipmentFilter] = useState<"all" | "today" | "week" | "month" | "preliminary">("all");

  if (loading && !dashboard) return <SkeletonRows rows={8} />;

  if (error && !dashboard) {
    return (
      <div className="eco-payroll-error">
        <AlertTriangle size={18} />
        <div>
          <strong>Не удалось загрузить мой заработок</strong>
          <span>{error}</span>
        </div>
        <EcoButton type="button" size="sm" onClick={onReload}>
          Повторить
        </EcoButton>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <EmptyState
        title="Данные заработка пока не загружены"
        text="Нажмите “Обновить”, чтобы получить личный расчёт по текущим данным платформы."
        action={<EcoButton type="button" variant="primary" onClick={onReload}>Обновить</EcoButton>}
      />
    );
  }

  const filteredShipments = dashboard.recentShipments.filter((shipment) => {
    if (shipmentFilter === "today") return shipment.date === dashboard.today.dateFrom;
    if (shipmentFilter === "week") return shipment.date >= dashboard.week.dateFrom && shipment.date <= dashboard.week.dateTo;
    if (shipmentFilter === "month") return shipment.date >= dashboard.month.dateFrom && shipment.date <= dashboard.month.dateTo;
    if (shipmentFilter === "preliminary") return shipment.status === "PRELIMINARY";
    return true;
  });
  const primaryGoal = dashboard.goals[0] ?? null;
  const goalPercent = primaryGoal ? Math.min(100, Math.round((primaryGoal.currentValue / Math.max(1, primaryGoal.targetValue)) * 100)) : 0;

  return (
    <section className="eco-payroll-employee-dashboard">
      <div className="eco-payroll-employee-hero">
        <div>
          <div className="eco-page-kicker">Мой заработок</div>
          <h2>{dashboard.employee.name}</h2>
          <p>
            {roleLabel(dashboard.employee.role)} · {formatDate(dashboard.period.dateFrom)} - {formatDate(dashboard.period.dateTo)}
          </p>
          <div className="eco-payroll-employee-badges">
            {dashboard.employee.preview && <EcoBadge tone="info">Режим предпросмотра</EcoBadge>}
            <AccrualStatusPill status={dashboard.status} />
            <span>Обновлено {formatDateTime(dashboard.lastUpdatedAt)}</span>
          </div>
        </div>
        <EcoButton type="button" onClick={onReload} disabled={loading}>
          {loading ? <Loader2 size={15} className="eco-spin" /> : <RefreshCw size={15} />}
          Обновить
        </EcoButton>
      </div>

      <div className="eco-payroll-employee-kpis">
        <EcoKpi label="Сегодня" value={formatMoney(dashboard.today.totalCents)} sub={`${dashboard.today.shipments} отгрузок`} tone="rust" />
        <EcoKpi label="Текущая смена" value={formatMoney(dashboard.shift.totalCents)} sub="по данным дня" tone="info" />
        <EcoKpi label="Эта неделя" value={formatMoney(dashboard.week.totalCents)} sub={`${formatDate(dashboard.week.dateFrom)} - ${formatDate(dashboard.week.dateTo)}`} tone="neutral" />
        <EcoKpi label="Этот месяц" value={formatMoney(dashboard.month.totalCents)} sub={`${dashboard.month.shipments} отгрузок`} tone="rust" />
        <EcoKpi label="Выплачено" value={formatMoney(dashboard.paid)} sub="по расходным ордерам" tone="success" />
        <EcoKpi label="К выплате" value={formatMoney(dashboard.payable)} sub="остаток периода" tone={dashboard.payable > 0 ? "warning" : "success"} />
      </div>

      <div className="eco-payroll-employee-clarity">
        <div>
          <span>Начислено подтверждённо</span>
          <strong>{formatMoney(dashboard.confirmed.amountCents)}</strong>
          <p>{dashboard.confirmed.note}</p>
        </div>
        <div>
          <span>Предварительно</span>
          <strong>{formatMoney(dashboard.preliminary.amountCents)}</strong>
          <p>{dashboard.preliminary.note}</p>
        </div>
      </div>

      <div className="eco-payroll-employee-grid">
        <div className="eco-payroll-employee-main">
          <section className="eco-payroll-employee-panel">
            <div className="eco-payroll-panel-head">
              <div>
                <strong>Последние начисления</strong>
                <span>Группируются по отгрузкам, не по каждой мелкой позиции.</span>
              </div>
            </div>
            {dashboard.latestAccruals.length === 0 ? (
              <EmptyState title="Начислений пока нет" text="Проведённые отгрузки вашей рабочей команды появятся здесь." />
            ) : (
              <div className="eco-payroll-earnings-feed">
                {dashboard.latestAccruals.map((shipment) => (
                  <EmployeeShipmentCardView key={shipment.id} shipment={shipment} />
                ))}
              </div>
            )}
          </section>

          <section className="eco-payroll-employee-panel">
            <div className="eco-payroll-panel-head">
              <div>
                <strong>Мои отгрузки</strong>
                <span>Только документы, где есть ваше начисление.</span>
              </div>
              <Link href="/salary?tab=calculation">Все мои отгрузки</Link>
            </div>
            <div className="eco-payroll-employee-filters">
              {[
                ["all", "Все"],
                ["today", "Сегодня"],
                ["week", "Неделя"],
                ["month", "Месяц"],
                ["preliminary", "Предварительные"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={shipmentFilter === value ? "is-active" : ""}
                  onClick={() => setShipmentFilter(value as typeof shipmentFilter)}
                >
                  {label}
                </button>
              ))}
            </div>
            {filteredShipments.length === 0 ? (
              <p className="eco-payroll-muted">По выбранному фильтру отгрузок нет.</p>
            ) : (
              <div className="eco-payroll-employee-shipments">
                {filteredShipments.slice(0, 10).map((shipment) => (
                  <EmployeeShipmentCardView key={`recent-${shipment.id}`} shipment={shipment} />
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="eco-payroll-employee-side">
          <section className="eco-payroll-employee-panel">
            <strong>Моя цель</strong>
            {primaryGoal ? (
              <div className="eco-payroll-goal">
                <div>
                  <span>{primaryGoal.title}</span>
                  <strong>{primaryGoal.unit === "money" ? formatMoney(primaryGoal.targetValue) : primaryGoal.targetValue}</strong>
                </div>
                <div className="eco-payroll-goal-bar"><span style={{ width: `${goalPercent}%` }} /></div>
                <p>Выполнено {goalPercent}%</p>
              </div>
            ) : (
              <p className="eco-payroll-muted">Цель ещё не назначена владельцем. Деньги не меняются от визуальных уровней без отдельного правила.</p>
            )}
          </section>

          <section className="eco-payroll-employee-panel">
            <strong>Прогноз на конец месяца</strong>
            {dashboard.forecast.available ? (
              <>
                <h3>{formatMoney(dashboard.forecast.lowCents)} - {formatMoney(dashboard.forecast.highCents)}</h3>
                <p>{dashboard.forecast.note}</p>
              </>
            ) : (
              <p className="eco-payroll-muted">Недостаточно подтверждённой истории для прогноза.</p>
            )}
          </section>

          <section className="eco-payroll-employee-panel">
            <strong>Команда смены</strong>
            <dl className="eco-payroll-team-progress">
              <div><dt>{dashboard.teamProgress.label}</dt><dd>{dashboard.teamProgress.goalLabel}</dd></div>
              <div><dt>Отгрузки</dt><dd>{dashboard.teamProgress.shipments}</dd></div>
              <div><dt>Услуги</dt><dd>{dashboard.teamProgress.services}</dd></div>
              <div><dt>Товары</dt><dd>{dashboard.teamProgress.products}</dd></div>
              <div><dt>Мой заработок</dt><dd>{formatMoney(dashboard.teamProgress.ownEarningsCents)}</dd></div>
            </dl>
            <p className="eco-payroll-muted">Точные выплаты напарников скрыты.</p>
          </section>

          <section className="eco-payroll-employee-panel">
            <strong>Качество работы</strong>
            <div className="eco-payroll-quality-list">
              {dashboard.quality.items.map((item) => (
                <div key={item.label} className={`is-${item.tone}`}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="eco-payroll-employee-panel">
            <strong>Что поможет увеличить результат</strong>
            {dashboard.opportunities.length === 0 ? (
              <p className="eco-payroll-muted">Сейчас нет действий, которые требуют внимания.</p>
            ) : (
              <div className="eco-payroll-opportunity-list">
                {dashboard.opportunities.map((item) => (
                  <Link key={item.title} href={item.href}>
                    <strong>{item.title}</strong>
                    <span>{item.text}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="eco-payroll-employee-panel">
            <strong>Достижения и признание</strong>
            {dashboard.achievements.length === 0 && dashboard.recognition.length === 0 ? (
              <p className="eco-payroll-muted">Здесь появятся достижения и похвала владельца. Они не меняют зарплату автоматически.</p>
            ) : (
              <div className="eco-payroll-opportunity-list">
                {dashboard.achievements.map((item) => (
                  <div key={item.id}><strong>{item.title}</strong><span>{item.text}</span></div>
                ))}
                {dashboard.recognition.map((item) => (
                  <div key={item.id}><strong>{item.title}</strong><span>{item.authorName}: {item.message}</span></div>
                ))}
              </div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}

function getRowStatus(params: {
  closed: boolean;
  hasData: boolean;
  payroll: PayrollByLogin;
  role: UserRole;
  rateCents: number | null;
  shiftsCount: number;
  paidOverride: boolean;
}): StatusKey {
  const { closed, hasData, payroll, role, rateCents, shiftsCount, paidOverride } = params;
  if (closed) return "closed";
  if (paidOverride || (payroll.paidOutCents > 0 && payroll.remainingCents <= 0)) return "paid";
  if (!hasData || payroll.totalCents === 0) return "not_calculated";
  if (role !== "owner" && rateCents == null && shiftsCount > 0) return "has_errors";
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
  initialPersonalView = false,
}: {
  role: string;
  login: string;
  name: string;
  isOwner: boolean;
  initialPersonalView?: boolean;
}) {
  const defaults = getCurrentMonthRange();
  const [mode, setMode] = useState<PayrollMode>(isOwner && !initialPersonalView ? "owner" : "employee");
  const [activeTab, setActiveTab] = useState<SalaryTab>(() => {
    if (typeof window === "undefined") return "calculation";
    return parseSalaryTab(new URLSearchParams(window.location.search).get("tab"));
  });
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);
  const [userFilter, setUserFilter] = useState("");
  const [payroll, setPayroll] = useState<Payroll | null>(null);
  const [employeeDashboard, setEmployeeDashboard] = useState<EmployeeDashboardData | null>(null);
  const [employeeDashboardLoading, setEmployeeDashboardLoading] = useState(false);
  const [employeeDashboardError, setEmployeeDashboardError] = useState<string | null>(null);
  const [payrollShifts, setPayrollShifts] = useState<PayrollShiftItem[]>([]);
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
  const [selectedDate, setSelectedDate] = useState(() => toLocalDateInputValue(new Date()));
  const [selectedDates, setSelectedDates] = useState<Set<string>>(() => new Set([toLocalDateInputValue(new Date())]));
  const [selectionAnchor, setSelectionAnchor] = useState(() => toLocalDateInputValue(new Date()));
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(false);
  const [calendarSaveStatus, setCalendarSaveStatus] = useState<"idle" | "dirty" | "saving" | "saved">("idle");
  const [calendarShifts, setCalendarShifts] = useState<PayrollShiftItem[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [selectedLogin, setSelectedLogin] = useState<string | null>(null);
  const [drawerComment, setDrawerComment] = useState("");
  const [unallocatedDrawerReason, setUnallocatedDrawerReason] = useState<UnallocatedPieceworkReason | null>(null);
  const [shiftProblemContext, setShiftProblemContext] = useState<ShiftProblemContext | null>(null);
  const [adjustmentOpen, setAdjustmentOpen] = useState(false);
  const [adjustmentType, setAdjustmentType] = useState<"BONUS" | "PENALTY" | "DEDUCTION" | "EXTRA_PAY" | "COMPENSATION">("BONUS");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentComment, setAdjustmentComment] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [adjustmentDate, setAdjustmentDate] = useState(() => toLocalDateInputValue(new Date()));
  const [adjustmentSaving, setAdjustmentSaving] = useState(false);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);
  const [savedAdjustment, setSavedAdjustment] = useState<SavedAdjustment | null>(null);
  const [adjustments, setAdjustments] = useState<BonusPenaltyItem[]>([]);
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentOperationType, setPaymentOperationType] = useState<"SALARY" | "ADVANCE" | "COMPENSATION">("SALARY");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => toLocalDateInputValue(new Date()));
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "BANK_TRANSFER" | "OTHER">("CASH");
  const [paymentComment, setPaymentComment] = useState("");
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [operationEmployeeLogin, setOperationEmployeeLogin] = useState("");
  const [paidOverrides, setPaidOverrides] = useState<Set<string>>(() => new Set());
  const [closedPeriods, setClosedPeriods] = useState<Set<string>>(() => new Set());
  const [payrollPeriods, setPayrollPeriods] = useState<PayrollPeriodItem[]>([]);
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [periodClosing, setPeriodClosing] = useState(false);
  const [rateDrawerLogin, setRateDrawerLogin] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [motivationOverview, setMotivationOverview] = useState<MotivationOverview | null>(null);
  const [motivationLoading, setMotivationLoading] = useState(false);
  const [goalEmployeeLogin, setGoalEmployeeLogin] = useState("");
  const [goalMetric, setGoalMetric] = useState("ACCRUAL_AMOUNT");
  const [goalPeriodType, setGoalPeriodType] = useState<"WEEK" | "MONTH">("MONTH");
  const [goalTargetValue, setGoalTargetValue] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);
  const [recognitionEmployeeLogin, setRecognitionEmployeeLogin] = useState("");
  const [recognitionMessage, setRecognitionMessage] = useState("");
  const [recognitionReason, setRecognitionReason] = useState("good_work");
  const [recognitionVisibility, setRecognitionVisibility] = useState<"PRIVATE" | "TEAM">("PRIVATE");
  const [recognitionSaving, setRecognitionSaving] = useState(false);
  const autoLoadedRef = useRef(false);
  const dragStartDateRef = useRef<string | null>(null);
  const suppressNextClickRef = useRef(false);
  const operationFormRef = useRef<HTMLDivElement | null>(null);

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
      if (paid) setPaidOverrides(new Set(JSON.parse(paid) as string[]));
    } catch {
      // Local persistence is best-effort; payroll data still comes from the APIs.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PAYROLL_PAID_STORAGE_KEY, JSON.stringify(Array.from(paidOverrides)));
    } catch {}
  }, [paidOverrides]);

  const fetchPayrollShifts = useCallback(async (from: string, to: string, targetLogin?: string) => {
    const params = new URLSearchParams({ dateFrom: from, dateTo: to });
    if (targetLogin) params.set("user", targetLogin);
    const response = await fetch(`/api/working-days?${params.toString()}`, { cache: "no-store" });
    return readJson<PayrollShiftItem[]>(response, "Не удалось загрузить смены");
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

  const loadPeriods = useCallback(async () => {
    setPeriodsLoading(true);
    try {
      const response = await fetch("/api/payroll/periods?limit=80", { cache: "no-store" });
      const payload = await readJson<{ periods?: PayrollPeriodItem[] }>(response, "Не удалось загрузить закрытые периоды");
      const periods = Array.isArray(payload.periods) ? payload.periods : [];
      setPayrollPeriods(periods);
      setClosedPeriods(new Set(periods.map((item) => `${item.dateFrom}:${item.dateTo}`)));
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось загрузить закрытые периоды");
      setPayrollPeriods([]);
      setClosedPeriods(new Set());
    } finally {
      setPeriodsLoading(false);
    }
  }, []);

  const loadEmployeeDashboard = useCallback(async () => {
    setEmployeeDashboardLoading(true);
    setEmployeeDashboardError(null);
    try {
      const response = await fetch("/api/payroll/self/dashboard", { cache: "no-store" });
      const payload = await readJson<EmployeeDashboardData>(response, "Не удалось загрузить мой заработок");
      setEmployeeDashboard(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось загрузить мой заработок";
      setEmployeeDashboardError(message);
      setToast(message);
    } finally {
      setEmployeeDashboardLoading(false);
    }
  }, []);

  const loadMotivationOverview = useCallback(async () => {
    if (!isOwner) return;
    setMotivationLoading(true);
    try {
      const response = await fetch("/api/payroll/motivation/overview", { cache: "no-store" });
      const payload = await readJson<MotivationOverview>(response, "Не удалось загрузить мотивацию");
      setMotivationOverview(payload);
      if (!goalEmployeeLogin && payload.users[0]) setGoalEmployeeLogin(payload.users[0].login);
      if (!recognitionEmployeeLogin && payload.users[0]) setRecognitionEmployeeLogin(payload.users[0].login);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось загрузить мотивацию");
    } finally {
      setMotivationLoading(false);
    }
  }, [goalEmployeeLogin, isOwner, recognitionEmployeeLogin]);

  const loadAdjustments = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setAdjustmentsLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (isOwner && activeScopedLogin) params.set("user", activeScopedLogin);
      const response = await fetch(`/api/payroll/adjustments?${params.toString()}`, { cache: "no-store" });
      const payload = await readJson<BonusPenaltyItem[]>(response, "Не удалось загрузить корректировки");
      setAdjustments(Array.isArray(payload) ? payload : []);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось загрузить корректировки");
    } finally {
      setAdjustmentsLoading(false);
    }
  }, [activeScopedLogin, dateFrom, dateTo, isOwner]);

  const loadPayroll = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    if (dateFrom > dateTo) {
      setPayroll(null);
      setPayrollShifts([]);
      setPayrollError("Дата начала расчёта не может быть позже даты окончания.");
      setProgressText(null);
      return;
    }
    setPayrollLoading(true);
    setPayrollError(null);
    setProgressText("Считаем смены, услуги и сдельные начисления...");

    try {
      const params = new URLSearchParams({ dateFrom, dateTo });
      if (isOwner && activeScopedLogin) params.set("user", activeScopedLogin);
      const [payrollResponse, workingDaysResponse] = await Promise.all([
        fetch(`/api/payroll?${params.toString()}`, { cache: "no-store" }),
        fetchPayrollShifts(dateFrom, dateTo, isOwner ? activeScopedLogin || undefined : undefined),
      ]);
      const nextPayroll = await readJson<Payroll>(payrollResponse, "Не удалось рассчитать зарплату");
      setPayroll(nextPayroll);
      setPayrollShifts(workingDaysResponse);
      if (viewingAsEmployee) {
        await loadEmployeeDashboard();
      }
      setProgressText(null);
      await Promise.all([loadRates(), loadAdjustments(), loadHistory(), loadPeriods()]);
    } catch (error) {
      setPayroll(null);
      setPayrollShifts([]);
      setPayrollError(error instanceof Error ? error.message : "Не удалось рассчитать зарплату");
      setProgressText(null);
    } finally {
      setPayrollLoading(false);
    }
  }, [activeScopedLogin, dateFrom, dateTo, fetchPayrollShifts, isOwner, loadAdjustments, loadEmployeeDashboard, loadHistory, loadPeriods, loadRates, viewingAsEmployee]);

  const loadCalendarShifts = useCallback(async () => {
    const { dateFrom: monthFrom, dateTo: monthTo } = getMonthBounds(
      calendarDate.getFullYear(),
      calendarDate.getMonth()
    );
    setCalendarLoading(true);
    try {
      const nextShifts = await fetchPayrollShifts(
        monthFrom,
        monthTo,
        isOwner ? calendarLogin || undefined : undefined
      );
      setCalendarShifts(nextShifts);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось загрузить смены");
      setCalendarShifts([]);
    } finally {
      setCalendarLoading(false);
    }
  }, [calendarDate, calendarLogin, fetchPayrollShifts, isOwner]);

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
    if (!viewingAsEmployee) return;
    const timer = window.setInterval(() => {
      void loadEmployeeDashboard();
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [loadEmployeeDashboard, viewingAsEmployee]);

  useEffect(() => {
    if (!isOwner) setCalendarLogin(login);
  }, [isOwner, login]);

  useEffect(() => {
    void loadCalendarShifts();
  }, [loadCalendarShifts]);

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
    setOperationEmployeeLogin(selectedLogin);
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

  const shiftCountsByLogin = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const item of payrollShifts) {
      const key = normalizeLogin(item.userLogin);
      const entry = map.get(key) ?? new Set<string>();
      entry.add(item.date);
      map.set(key, entry);
    }
    return map;
  }, [payrollShifts]);

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
        const shifts = shiftCountsByLogin.get(loginKey);
        const roleValue = normalizeRole(user?.role ?? (loginKey === normalizeLogin(login) ? role : "master"));
        const rate = rateByLogin.get(loginKey)?.amountCents ?? null;
        const status = getRowStatus({
          closed: isClosedPeriod,
          hasData: Boolean(payroll),
          payroll: payrollEntry,
          role: roleValue,
          rateCents: rate,
          shiftsCount: shifts?.size ?? payrollEntry.shiftsCount,
          paidOverride: paidOverrides.has(`${periodKey}:${loginKey}`),
        });

        return {
          login: sourceLogin,
          name: user?.name ?? sourceLogin,
          role: roleValue,
          payroll: payrollEntry,
          rateCents: rate,
          shiftsCount: shifts?.size ?? payrollEntry.shiftsCount,
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
    shiftCountsByLogin,
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
          shiftsCount: 0,
          status: "not_calculated" as StatusKey,
        }))
        .find((row) => normalizeLogin(row.login) === normalizeLogin(rateDrawerLogin)) ??
      null
    : null;

  const payrollOperationUsers = useMemo<OwnerUser[]>(() => {
    const map = new Map<string, OwnerUser>();
    const addUser = (user: OwnerUser) => {
      const key = normalizeLogin(user.login);
      if (!key || map.has(key)) return;
      map.set(key, { ...user, role: normalizeRole(user.role ?? "master") });
    };
    for (const user of teamUsers) addUser(user);
    for (const row of payrollRows) addUser({ login: row.login, name: row.name, role: row.role });
    if (viewingAsEmployee) {
      const own = map.get(normalizeLogin(login)) ?? currentUser;
      return [own];
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [currentUser, login, payrollRows, teamUsers, viewingAsEmployee]);

  const totals = useMemo(() => {
    const totalAccrued = payrollRows.reduce((sum, row) => sum + row.payroll.totalCents, 0);
    const totalPaid = payrollRows.reduce((sum, row) => sum + row.payroll.paidOutCents, 0);
    const totalRemaining = payrollRows.reduce((sum, row) => sum + row.payroll.remainingCents, 0);
    const totalShifts = payrollRows.reduce((sum, row) => sum + row.shiftsCount, 0);
    return { totalAccrued, totalPaid, totalRemaining, totalShifts };
  }, [payrollRows]);

  const unallocatedPiecework = useMemo<UnallocatedPieceworkLine[]>(() => {
    const lines: UnallocatedPieceworkLine[] = [];
    for (const vehicle of payroll?.vehicleHistory ?? []) {
      for (const item of vehicle.unallocatedPiecework ?? []) {
        lines.push({
          ...item,
          demandId: vehicle.demandId,
          demandName: vehicle.demandName,
          date: vehicle.date,
          agentName: vehicle.agentName,
        });
      }
    }
    return lines.sort((left, right) =>
      left.label.localeCompare(right.label, "ru") ||
      left.date.localeCompare(right.date) ||
      left.demandName.localeCompare(right.demandName, "ru")
    );
  }, [payroll?.vehicleHistory]);

  const unallocatedDrawerItems = useMemo(
    () => unallocatedPiecework.filter((item) => item.reason === unallocatedDrawerReason),
    [unallocatedDrawerReason, unallocatedPiecework]
  );

  const unallocatedDrawerRoles = useMemo(
    () => Array.from(new Set(unallocatedDrawerItems.map((item) => item.category === "work" ? "master" : "admin"))),
    [unallocatedDrawerItems]
  );

  const problems = useMemo(() => {
    const next: PayrollProblem[] = [];
    if (payrollError) {
      next.push({
        id: "payroll-error",
        title: "Не удалось рассчитать зарплату",
        text: "Расчёт не завершился. Попробуйте запустить его ещё раз.",
        severity: "danger",
        actionLabel: "Повторить расчёт",
        action: { kind: "retry" },
      });
    }
    for (const row of payrollRows) {
      if (row.role !== "owner" && row.rateCents == null && row.shiftsCount > 0) {
        next.push({
          id: `missing-rate:${row.login}`,
          title: `${row.name}: нет ставки`,
          text: `За ${row.shiftsCount} смен. фиксированная часть не начислена. Укажите ставку сотрудника.`,
          severity: "warning",
          actionLabel: "Указать ставку",
          action: { kind: "rate", employeeLogin: row.login },
        });
      }
      if (row.payroll.bonusPenaltyCents < 0 && row.payroll.totalCents < 0) {
        next.push({
          id: `negative-accrual:${row.login}`,
          title: `${row.name}: отрицательное начисление`,
          text: "Удержания превышают начисления. Проверьте ручные корректировки сотрудника.",
          severity: "danger",
          actionLabel: "Открыть корректировки",
          action: { kind: "adjustments" },
        });
      }
    }
    const unallocatedByReason = new Map<UnallocatedPieceworkReason, {
      count: number;
      sample: UnallocatedPieceworkLine;
    }>();
    for (const item of unallocatedPiecework) {
      const current = unallocatedByReason.get(item.reason);
      unallocatedByReason.set(item.reason, {
        count: (current?.count ?? 0) + 1,
        sample: current?.sample ?? item,
      });
    }
    for (const [reason, problem] of unallocatedByReason) {
      const role = problem.sample.category === "work" ? "master" : "admin";
      const roleLabel = role === "master" ? "мастера" : "администратора";
      const example = `${problem.sample.demandName} · ${formatDate(problem.sample.date)}`;
      const isMissingRule = reason === "missing_rule";
      const isMultiple = reason === "multiple_masters" || reason === "multiple_admins";
      next.push({
        id: `unallocated:${reason}`,
        title: isMissingRule
          ? `${problem.count} поз. без правила начисления`
          : `${problem.count} поз. без назначенной рабочей команды`,
        text: isMissingRule
          ? `Для «${problem.sample.label}» (${example}) нет правила для ${roleLabel}.`
          : isMultiple
            ? `В «${example}» назначено несколько ${roleLabel}. Оставьте в графике одного.`
            : `В «${example}» не назначен ${roleLabel}. Назначьте ему смену на этот день.`,
        severity: isMissingRule ? "warning" : "danger",
        actionLabel: `Показать ${problem.count} поз.`,
        action: { kind: "unallocated", reason },
      });
    }
    if (!rulesLoading && canManagePayroll && rules.length === 0) {
      next.push({
        id: "rules-empty",
        title: "Правила сдельной части не настроены",
        text: "Без них платформа не сможет начислить сдельную часть за услуги и товары.",
        severity: "warning",
        actionLabel: "Настроить правила",
        action: { kind: "rules", role: null, instruction: "Добавьте правило для услуги или группы товаров." },
      });
    }
    if (payroll && payrollRows.length === 0) {
      next.push({
        id: "payroll-users-empty",
        title: "Сотрудники не найдены",
        text: "Добавьте сотрудников в настройках доступа.",
        severity: "warning",
        action: { kind: "none" },
      });
    }
    if (payroll && payrollShifts.length === 0) {
      next.push({
        id: "shifts-empty",
        title: "Смены не назначены",
        text: "Назначьте смены сотрудникам за выбранный период — только они участвуют в начислении.",
        severity: "warning",
        actionLabel: "Открыть смены",
        action: { kind: "shifts", date: dateFrom, role: "master", needsSingleEmployee: false },
      });
    }
    return next.slice(0, 8);
  }, [canManagePayroll, dateFrom, payroll, payrollError, payrollRows, payrollShifts.length, rules.length, rulesLoading, unallocatedPiecework]);

  function openShiftProblem(
    date: string,
    role: "master" | "admin",
    needsSingleEmployee: boolean,
    item?: UnallocatedPieceworkLine
  ) {
    const selectedMonth = new Date(`${date}T12:00:00`);
    const roleUsers = teamUsers.filter((user) => normalizeRole(user.role ?? "master") === role);
    const assignedRoleUser = calendarShifts.find((shift) =>
      shift.date === date && roleUsers.some((user) => normalizeLogin(user.login) === normalizeLogin(shift.userLogin))
    );
    changeTab("workdays");
    setCalendarDate(new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1));
    setCalendarLogin(assignedRoleUser?.userLogin ?? roleUsers[0]?.login ?? "");
    setSelectedDate(date);
    setSelectedDates(new Set([date]));
    setSelectionAnchor(date);
    setMultiSelectEnabled(false);
    setShiftProblemContext({ date, role, needsSingleEmployee, item });
    setToast(
      needsSingleEmployee
        ? `На ${formatDate(date)} оставьте одну смену для ${role === "master" ? "мастера" : "администратора"}.`
        : `На ${formatDate(date)} назначьте смену для ${role === "master" ? "мастера" : "администратора"}.`
    );
  }

  function resolvePayrollProblem(problem: PayrollProblem) {
    const { action } = problem;
    if (action.kind === "retry") {
      setToast("Повторяем расчёт зарплаты…");
      void loadPayroll();
      return;
    }
    if (action.kind === "rate") {
      changeTab("rates");
      setRateDrawerLogin(action.employeeLogin);
      setToast("Укажите ставку и сохраните изменение.");
      return;
    }
    if (action.kind === "rules") {
      changeTab("rules");
      setRuleRoleFilter(action.role ?? "all");
      setToast(action.instruction);
      return;
    }
    if (action.kind === "shifts") {
      openShiftProblem(action.date, action.role, action.needsSingleEmployee);
      return;
    }
    if (action.kind === "unallocated") {
      setUnallocatedDrawerReason(action.reason);
      setToast("Открыли полный список позиций, требующих настройки.");
      return;
    }
    if (action.kind === "adjustments") {
      changeTab("adjustments");
      setToast("Открыли корректировки выбранного периода.");
    }
  }

  const availableTabs = useMemo<SalaryTab[]>(
    () =>
      viewingAsEmployee
        ? ["calculation", "workdays", "payments", "history"]
        : ["calculation", "workdays", "rates", "rules", "adjustments", "payments", "motivation", "history"],
    [viewingAsEmployee]
  );

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) setActiveTab("calculation");
  }, [activeTab, availableTabs]);

  useEffect(() => {
    if (activeTab !== "motivation" || !canManagePayroll) return;
    void loadMotivationOverview();
  }, [activeTab, canManagePayroll, loadMotivationOverview]);

  const vehicleHistory = payroll?.vehicleHistory ?? [];
  const cashoutHistory = payroll?.cashoutHistory ?? [];

  function setPeriodPreset(preset: "current" | "previous" | "7" | "30") {
    const range = getPresetRange(preset);
    setDateFrom(range.dateFrom);
    setDateTo(range.dateTo);
  }

  function updateDateFrom(value: string) {
    setDateFrom(value);
    if (value && dateTo && value > dateTo) setDateTo(value);
  }

  function updateDateTo(value: string) {
    setDateTo(value);
    if (value && dateFrom && value < dateFrom) setDateFrom(value);
  }

  async function saveMotivationGoal() {
    if (!goalEmployeeLogin) {
      setToast("Выберите сотрудника для цели");
      return;
    }
    const targetValue =
      goalMetric === "ACCRUAL_AMOUNT"
        ? Math.round(parseMoneyInput(goalTargetValue) * 100)
        : Math.round(Number(goalTargetValue));
    if (!Number.isFinite(targetValue) || targetValue <= 0) {
      setToast("Укажите положительное значение цели");
      return;
    }

    setGoalSaving(true);
    try {
      const response = await fetch("/api/payroll/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeLogin: goalEmployeeLogin,
          periodType: goalPeriodType,
          metric: goalMetric,
          targetValue,
          startsAt: dateFrom,
          endsAt: dateTo,
        }),
      });
      await readJson<{ id: string }>(response, "Не удалось сохранить цель");
      setGoalTargetValue("");
      setToast("Цель сотрудника сохранена");
      await loadMotivationOverview();
      if (viewingAsEmployee) await loadEmployeeDashboard();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось сохранить цель");
    } finally {
      setGoalSaving(false);
    }
  }

  async function saveEmployeeRecognition() {
    if (!recognitionEmployeeLogin) {
      setToast("Выберите сотрудника");
      return;
    }
    if (!recognitionMessage.trim()) {
      setToast("Добавьте короткий комментарий");
      return;
    }

    setRecognitionSaving(true);
    try {
      const response = await fetch("/api/payroll/recognition", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeLogin: recognitionEmployeeLogin,
          title: "Похвала от владельца",
          message: recognitionMessage.trim(),
          reason: recognitionReason,
          visibility: recognitionVisibility,
        }),
      });
      await readJson<{ id: string }>(response, "Не удалось отправить похвалу");
      setRecognitionMessage("");
      setToast("Похвала отправлена сотруднику");
      await loadMotivationOverview();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось отправить похвалу");
    } finally {
      setRecognitionSaving(false);
    }
  }

  function changeTab(tab: SalaryTab) {
    if (activeTab === tab) return;
    if (hasUnsavedRuleChanges && !window.confirm("Есть несохранённые изменения правил. Перейти без сохранения?")) {
      return;
    }
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      const tabQuery = salaryTabQuery(tab);
      if (tabQuery) url.searchParams.set("tab", tabQuery);
      else url.searchParams.delete("tab");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }

  function changeMode(nextMode: PayrollMode) {
    if (mode === nextMode) return;
    if (hasUnsavedRuleChanges && !window.confirm("Есть несохранённые изменения правил. Сменить режим без сохранения?")) {
      return;
    }
    setMode(nextMode);
    setActiveTab("calculation");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("tab");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
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

  function getCalendarShiftsForDate(date: string, targetLogin = calendarLogin) {
    return calendarShifts.filter((item) => {
      if (targetLogin && normalizeLogin(item.userLogin) !== normalizeLogin(targetLogin)) return false;
      return item.date === date;
    });
  }

  function getCalendarShiftCountsByLogin() {
    const counts = new Map<string, Set<string>>();
    for (const item of calendarShifts) {
      const key = normalizeLogin(item.userLogin);
      const set = counts.get(key) ?? new Set<string>();
      set.add(item.date);
      counts.set(key, set);
    }
    return counts;
  }

  const calendarShiftCounts = getCalendarShiftCountsByLogin();

  const sortedSelectedDates = Array.from(selectedDates).sort();
  const selectedDatesCount = sortedSelectedDates.length;
  const firstSelectedDate = sortedSelectedDates[0] ?? selectedDate;
  const lastSelectedDate = sortedSelectedDates[sortedSelectedDates.length - 1] ?? selectedDate;

  function getTargetUsersForCalendarAction() {
    if (calendarLogin) {
      return teamUsers.filter((user) => normalizeLogin(user.login) === normalizeLogin(calendarLogin));
    }
    return teamUsers.filter((user) => user.role === "master" || user.role === "admin");
  }

  function getEffectiveShiftState(date: string, targetLogin = calendarLogin) {
    const items = getCalendarShiftsForDate(date, targetLogin);
    return { hasShift: items.length > 0, items };
  }

  async function runSelectedShiftAction(action: "add" | "remove") {
    if (!canManagePayroll || calendarBusy || selectedDatesCount === 0) return;

    const targetUsers = getTargetUsersForCalendarAction();
    if (targetUsers.length === 0) {
      setToast("Выберите сотрудника для смены");
      return;
    }

    const targetLabel = calendarLogin
      ? teamUsers.find((user) => normalizeLogin(user.login) === normalizeLogin(calendarLogin))?.name ?? calendarLogin
      : "всех сотрудников";
    const label = action === "add" ? "Назначить смены" : "Снять смены";
    if ((action === "remove" || !calendarLogin) && !window.confirm(`${label} для ${selectedDatesCount} дн.: ${targetLabel}?`)) {
      return;
    }

    setCalendarSaveStatus("saving");
    setCalendarBusy(true);
    try {
      if (action === "add") {
        for (const user of targetUsers) {
          for (const date of sortedSelectedDates) {
            const response = await fetch("/api/working-days", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userLogin: user.login, date }),
            });
            await readJson(response, "Не удалось назначить смену");
          }
        }
      } else {
        const removable = calendarShifts.filter((item) => {
          if (!sortedSelectedDates.includes(item.date)) return false;
          if (calendarLogin && normalizeLogin(item.userLogin) !== normalizeLogin(calendarLogin)) return false;
          return true;
        });
        if (removable.length === 0) {
          setCalendarSaveStatus("saved");
          setToast("На выбранные даты смен нет");
          return;
        }
        for (const item of removable) {
          const response = await fetch(`/api/working-days/${item.id}`, { method: "DELETE" });
          await readJson(response, "Не удалось снять смену");
        }
      }

      await Promise.all([loadCalendarShifts(), loadPayroll()]);
      setCalendarSaveStatus("saved");
      setToast(action === "add" ? "Смены назначены: зарплата пересчитана" : "Смены сняты: зарплата пересчитана");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось изменить смены");
      setCalendarSaveStatus("dirty");
    } finally {
      setCalendarBusy(false);
    }
  }

  async function toggleShift(targetDate: string, shouldHaveShift: boolean) {
    if (!canManagePayroll) return;
    if (!calendarLogin) {
      setToast("Выберите сотрудника, чтобы изменить его смену");
      return;
    }
    const item = getCalendarShiftsForDate(targetDate, calendarLogin)[0];
    setCalendarSaveStatus("saving");
    setCalendarBusy(true);
    try {
      if (shouldHaveShift && !item) {
        const response = await fetch("/api/working-days", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userLogin: calendarLogin, date: targetDate }),
        });
        await readJson(response, "Не удалось назначить смену");
      }
      if (!shouldHaveShift && item) {
        const response = await fetch(`/api/working-days/${item.id}`, { method: "DELETE" });
        await readJson(response, "Не удалось снять смену");
      }
      await Promise.all([loadCalendarShifts(), loadPayroll()]);
      setCalendarSaveStatus("saved");
      setToast(shouldHaveShift ? "Смена назначена: зарплата пересчитана" : "Смена снята: зарплата пересчитана");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось изменить смену");
      setCalendarSaveStatus("dirty");
    } finally {
      setCalendarBusy(false);
    }
  }

  async function runBulkShifts(kind: "copy" | "clear" | "masters") {
    if (!canManagePayroll || calendarBusy) return;
    if (kind === "masters" && !calendarLogin) {
      setToast("Выберите сотрудника-источник");
      return;
    }
    const { dateFrom: monthFrom, dateTo: monthTo, daysInMonth } = getMonthBounds(
      calendarDate.getFullYear(),
      calendarDate.getMonth()
    );
    const messages = {
      copy: "Скопировать график прошлого месяца в текущий?",
      clear: "Снять все смены за месяц?",
      masters: "Применить график выбранного сотрудника ко всем мастерам?",
    };
    if (!window.confirm(messages[kind])) return;

    setCalendarSaveStatus("saving");
    setCalendarBusy(true);
    try {
      if (kind === "clear") {
        const removable = calendarShifts.filter((item) => {
          if (calendarLogin && normalizeLogin(item.userLogin) !== normalizeLogin(calendarLogin)) return false;
          return true;
        });
        for (const item of removable) {
          const response = await fetch(`/api/working-days/${item.id}`, { method: "DELETE" });
          await readJson(response, "Не удалось снять смену");
        }
      }

      if (kind === "copy") {
        const prevDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
        const prevBounds = getMonthBounds(prevDate.getFullYear(), prevDate.getMonth());
        const previousShifts = await fetchPayrollShifts(
          prevBounds.dateFrom,
          prevBounds.dateTo,
          isOwner ? calendarLogin || undefined : undefined
        );
        for (const item of previousShifts) {
          const day = Number(item.date.slice(8, 10));
          if (!Number.isFinite(day) || day < 1 || day > daysInMonth) continue;
          const targetDate = `${monthFrom.slice(0, 8)}${String(day).padStart(2, "0")}`;
          if (targetDate > monthTo) continue;
          const response = await fetch("/api/working-days", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userLogin: item.userLogin, date: targetDate }),
          });
          await readJson(response, "Не удалось скопировать смены");
        }
      }

      if (kind === "masters") {
        const sourceDates = calendarShifts
          .filter((item) => normalizeLogin(item.userLogin) === normalizeLogin(calendarLogin))
          .map((item) => item.date);
        const masters = teamUsers.filter(
          (user) => user.role === "master" && normalizeLogin(user.login) !== normalizeLogin(calendarLogin)
        );
        for (const user of masters) {
          for (const date of sourceDates) {
            const response = await fetch("/api/working-days", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userLogin: user.login, date }),
            });
            await readJson(response, "Не удалось применить смены");
          }
        }
      }

      await Promise.all([loadCalendarShifts(), loadPayroll()]);
      setCalendarSaveStatus("saved");
      setToast(
        kind === "copy"
          ? "Смены прошлого месяца скопированы: зарплата пересчитана"
          : kind === "clear"
            ? "Смены месяца сняты: зарплата пересчитана"
            : "Смены применены ко всем мастерам: зарплата пересчитана"
      );
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось изменить смены");
      setCalendarSaveStatus("dirty");
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
    setAdjustmentError(null);
    const employeeLogin = operationEmployeeLogin || selectedRow?.login || payrollOperationUsers[0]?.login || "";
    if (!employeeLogin) {
      setAdjustmentError("Выберите сотрудника для корректировки.");
      return;
    }
    const amount = parseMoneyInput(adjustmentAmount);
    if (!adjustmentDate || amount <= 0) {
      setAdjustmentError("Укажите дату и сумму корректировки больше нуля.");
      return;
    }

    setAdjustmentSaving(true);
    try {
      const response = await fetch("/api/payroll/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeLogin,
          periodFrom: dateFrom,
          periodTo: dateTo,
          operationDate: adjustmentDate,
          amountCents: Math.round(amount * 100),
          type: adjustmentType,
          reasonCode: adjustmentReason.trim() || null,
          comment: adjustmentComment.trim() || null,
        }),
      });
      await readJson(response, "Не удалось добавить корректировку");
      const employeeName = payrollOperationUsers.find(
        (user) => normalizeLogin(user.login) === normalizeLogin(employeeLogin)
      )?.name ?? employeeLogin;
      const saved = {
        employeeName,
        operationTitle: adjustmentOperationTitle(adjustmentType),
        amountCents: Math.round(amount * 100),
        date: adjustmentDate,
      };
      setAdjustmentOpen(false);
      setAdjustmentAmount("");
      setAdjustmentReason("");
      setAdjustmentComment("");
      setSavedAdjustment({ ...saved, refreshFailed: false });
      setToast("Корректировка сохранена");
      try {
        await Promise.all([loadPayroll(), loadAdjustments()]);
      } catch {
        // The settlement has already been persisted. Surface a refresh problem
        // separately instead of telling the owner that saving failed.
        setSavedAdjustment({ ...saved, refreshFailed: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Не удалось добавить корректировку";
      setAdjustmentError(message);
    } finally {
      setAdjustmentSaving(false);
    }
  }

  function focusOperationForm() {
    window.setTimeout(() => {
      operationFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  function openAdjustmentForm(type: typeof adjustmentType) {
    const employeeLogin = operationEmployeeLogin || selectedRow?.login || payrollRows[0]?.login || payrollOperationUsers[0]?.login || login;
    setPaymentOpen(false);
    setSavedAdjustment(null);
    setAdjustmentError(null);
    setOperationEmployeeLogin(employeeLogin);
    setAdjustmentType(type);
    setAdjustmentReason("");
    setAdjustmentOpen(true);
    setToast(`Открыта форма: ${adjustmentOperationTitle(type).toLowerCase()}`);
    focusOperationForm();
  }

  function openPaymentForm(row: PayrollRow, operationType: typeof paymentOperationType) {
    setSelectedLogin(row.login);
    setOperationEmployeeLogin(row.login);
    setAdjustmentOpen(false);
    setPaymentOperationType(operationType);
    setPaymentDate(toLocalDateInputValue(new Date()));
    setPaymentMethod("CASH");
    setPaymentAmount(operationType === "SALARY" ? formatFixedInput(Math.max(0, row.payroll.remainingCents)) : "");
    setPaymentComment("");
    setPaymentOpen(true);
    setSavedAdjustment(null);
    setAdjustmentError(null);
    setToast(`Открыта форма: ${paymentOperationTitle(operationType).toLowerCase()}`);
    focusOperationForm();
  }

  function closePayrollOperation() {
    setPaymentOpen(false);
    setAdjustmentOpen(false);
    setAdjustmentError(null);
    setSavedAdjustment(null);
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const employeeLogin = operationEmployeeLogin || selectedRow?.login || payrollOperationUsers[0]?.login || "";
    if (!employeeLogin) {
      setToast("Выберите сотрудника для выплаты");
      return;
    }
    const amount = parseMoneyInput(paymentAmount);
    if (!paymentDate || amount <= 0) {
      setToast("Укажите дату и сумму выплаты");
      return;
    }
    const paymentRow = payrollRows.find((row) => normalizeLogin(row.login) === normalizeLogin(employeeLogin));
    if (paymentOperationType === "SALARY" && paymentRow && amount * 100 > Math.max(0, paymentRow.payroll.remainingCents)) {
      setToast("Сумма выплаты больше суммы к выплате");
      return;
    }

    setPaymentSaving(true);
    try {
      const response = await fetch("/api/payroll/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeLogin,
          periodFrom: dateFrom,
          periodTo: dateTo,
          operationDate: paymentDate,
          operationType: paymentOperationType,
          amountCents: Math.round(amount * 100),
          paymentMethod,
          comment: paymentComment.trim() || null,
        }),
      });
      const payload = await readJson<{ cashOrderNumber?: string | null } | null>(response, "Не удалось создать выплату");
      setToast(payload?.cashOrderNumber ? `Выплата создана: РКО ${payload.cashOrderNumber}` : "Выплата создана");
      setPaymentOpen(false);
      setPaymentAmount("");
      setPaymentComment("");
      await loadPayroll();
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось создать выплату");
    } finally {
      setPaymentSaving(false);
    }
  }

  async function closePeriod() {
    if (!window.confirm("После закрытия периода расчёт станет доступен только для просмотра.")) return;
    setPeriodClosing(true);
    try {
      const response = await fetch("/api/payroll/periods/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      });
      const payload = await readJson<{ period: PayrollPeriodItem; created: boolean }>(
        response,
        "Не удалось закрыть период"
      );
      setToast(payload.created ? "Период закрыт и сохранён" : "Период уже был закрыт");
      await Promise.all([
        loadPeriods(),
        loadHistory(),
        viewingAsEmployee ? loadEmployeeDashboard() : Promise.resolve(),
      ]);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Не удалось закрыть период");
    } finally {
      setPeriodClosing(false);
    }
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

  const selectedDayState = getEffectiveShiftState(selectedDate);
  const selectedDayItems = selectedDayState.items;
  const selectedDayHasShift = selectedDayState.hasShift;
  const selectedShiftTargetUsers = getTargetUsersForCalendarAction();
  const selectedShiftAssignments = calendarShifts.filter(
    (shift) =>
      sortedSelectedDates.includes(shift.date) &&
      selectedShiftTargetUsers.some((user) => normalizeLogin(user.login) === normalizeLogin(shift.userLogin))
  ).length;
  const selectedShiftCapacity = selectedDatesCount * selectedShiftTargetUsers.length;
  const canAssignSelectedShifts = selectedShiftCapacity > selectedShiftAssignments;
  const canRemoveSelectedShifts = selectedShiftAssignments > 0;
  const shiftProblemRoleLabel = shiftProblemContext?.role === "master" ? "мастер" : "администратор";
  const shiftProblemSelectedUser = shiftProblemContext && calendarLogin
    ? teamUsers.find((user) => normalizeLogin(user.login) === normalizeLogin(calendarLogin)) ?? null
    : null;
  const shiftProblemAssignedUsers = shiftProblemContext
    ? calendarShifts
        .filter((shift) =>
          shift.date === shiftProblemContext.date &&
          teamUsers.some(
            (user) => normalizeLogin(user.login) === normalizeLogin(shift.userLogin) && normalizeRole(user.role ?? "master") === shiftProblemContext.role
          )
        )
        .map((shift) => teamUsers.find((user) => normalizeLogin(user.login) === normalizeLogin(shift.userLogin))?.name ?? shift.userLogin)
    : [];
  const shiftProblemResolved = Boolean(
    shiftProblemContext &&
    (shiftProblemContext.needsSingleEmployee
      ? shiftProblemAssignedUsers.length === 1
      : shiftProblemAssignedUsers.length >= 1)
  );

  const selectedShipmentBreakdown = selectedRow
    ? vehicleHistory
        .map((vehicle) => {
          const normalizedSelectedLogin = normalizeLogin(selectedRow.login);
          const earningsCents =
            Object.entries(vehicle.earningsByLogin).find(
              ([login]) => normalizeLogin(login) === normalizedSelectedLogin
            )?.[1] ?? 0;
          const items =
            Object.entries(vehicle.pieceworkBreakdownByLogin).find(
              ([login]) => normalizeLogin(login) === normalizedSelectedLogin
            )?.[1] ?? [];
          return { vehicle, earningsCents, items };
        })
        .filter((item) => item.earningsCents > 0 || item.items.length > 0)
    : [];
  const selectedBreakdown = selectedShipmentBreakdown.flatMap(({ vehicle, items }) =>
    items.map((item) => ({
            ...item,
            date: vehicle.date,
            demandName: vehicle.demandName,
            agentName: vehicle.agentName,
          }))
  );
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
            Расчёт выплат, смен и сдельных правил по текущим данным платформы.
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
            <EcoKpi label="Смен" value={totals.totalShifts} sub="назначено для оплаты" tone="info" />
          </>
        ) : (
          <>
            <EcoKpi label="Сотрудников" value={payrollRows.length} sub="в текущем расчёте" tone="info" />
            <EcoKpi label="Начислено за период" value={formatMoney(totals.totalAccrued)} sub={`${formatDate(dateFrom)} - ${formatDate(dateTo)}`} tone="rust" />
            <EcoKpi label="Выплачено" value={formatMoney(totals.totalPaid)} sub="по РКО и авансам" tone="success" />
            <EcoKpi label="К выплате" value={formatMoney(totals.totalRemaining)} sub="остаток по сотрудникам" tone={totals.totalRemaining > 0 ? "warning" : "success"} />
            <EcoKpi label="Смен" value={totals.totalShifts} sub="по всем сотрудникам" tone="info" />
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
          const tabLabel = viewingAsEmployee && tab === "calculation" ? "Мой заработок" : TAB_META[tab].label;
          const count =
            tab === "calculation"
              ? viewingAsEmployee
                ? employeeDashboard?.latestAccruals.length ?? payrollRows.length
                : payrollRows.length
              : tab === "workdays"
                ? payrollShifts.length || calendarShifts.length
                : tab === "rates"
                  ? rates.length
                  : tab === "rules"
                    ? changedRulesCount || rules.length
                    : tab === "adjustments"
                      ? adjustments.length
                      : tab === "payments"
                        ? cashoutHistory.length
                        : tab === "motivation"
                          ? motivationOverview?.metrics.activeGoals ?? 0
                          : history.length + payrollPeriods.length;
          return (
            <button
              key={tab}
              type="button"
              className={`eco-tab ${activeTab === tab ? "is-active" : ""}`}
              onClick={() => changeTab(tab)}
            >
              <Icon size={15} />
              <span>{tabLabel}</span>
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

      {activeTab === "calculation" && viewingAsEmployee && (
        <section className="eco-payroll-workspace">
          <EmployeeDashboardView
            dashboard={employeeDashboard}
            loading={employeeDashboardLoading || payrollLoading}
            error={employeeDashboardError || payrollError}
            onReload={() => void loadEmployeeDashboard()}
          />
        </section>
      )}

      {activeTab === "calculation" && !viewingAsEmployee && (
        <section className="eco-payroll-workspace">
          <div className="eco-payroll-toolbar">
            <div>
              <div className="eco-page-kicker">Период расчёта</div>
              <p>Выберите даты, сотрудника и запустите расчёт.</p>
            </div>
            <div className="eco-payroll-controls">
              <FieldLabel label="С">
                <EcoInput type="date" value={dateFrom} onChange={(event) => updateDateFrom(event.target.value)} />
              </FieldLabel>
              <FieldLabel label="По">
                <EcoInput type="date" value={dateTo} onChange={(event) => updateDateTo(event.target.value)} />
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
                  <span>Откройте пункт, чтобы перейти к нужному действию.</span>
                </div>
              </div>
              <div className="eco-payroll-problem-list">
                {problems.map((problem) =>
                  problem.action.kind === "none" ? (
                    <div key={problem.id} className={`is-${problem.severity}`}>
                      <strong>{problem.title}</strong>
                      <span>{problem.text}</span>
                    </div>
                  ) : (
                    <button
                      key={problem.id}
                      type="button"
                      className={`is-${problem.severity}`}
                      onClick={() => resolvePayrollProblem(problem)}
                      aria-label={`${problem.title}. ${problem.actionLabel ?? "Открыть действие"}`}
                    >
                      <span className="eco-payroll-problem-copy">
                        <strong>{problem.title}</strong>
                        <span>{problem.text}</span>
                      </span>
                      <span className="eco-payroll-problem-action">
                        {problem.actionLabel}
                        <ChevronRight size={16} aria-hidden="true" />
                      </span>
                    </button>
                  )
                )}
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
                        <td className="is-num">{row.shiftsCount}</td>
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
              <EcoButton
                type="button"
                onClick={() => void closePeriod()}
                disabled={periodClosing || isClosedPeriod || payrollRows.some((row) => row.status === "has_errors")}
              >
                {periodClosing ? <Loader2 size={15} className="eco-spin" /> : <FileText size={15} />}
                {periodClosing ? "Закрываем..." : "Закрыть период"}
              </EcoButton>
            </div>
          )}
        </section>
      )}

      {activeTab === "workdays" && (
        <section className="eco-payroll-workspace eco-payroll-calendar-view">
          <div className="eco-payroll-toolbar">
            <div>
              <div className="eco-page-kicker">Смены сотрудников</div>
              <p>Смена — единственное основание для начисления зарплаты за день.</p>
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
            <p className="eco-payroll-calendar-rule">Есть смена — зарплата за день начисляется. Нет смены — не начисляется.</p>
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

          {shiftProblemContext && (
            <section className="eco-payroll-resolution-guide" role="status" aria-live="polite">
              <div className="eco-payroll-resolution-guide__head">
                <div>
                  <span className="eco-page-kicker">Что нужно исправить</span>
                  <strong>
                    {shiftProblemResolved
                      ? "Проблема исправлена"
                      : shiftProblemContext.needsSingleEmployee
                      ? `Оставьте одного: ${shiftProblemRoleLabel}`
                      : `Назначьте смену: ${shiftProblemRoleLabel}`}
                  </strong>
                  <p>
                    {shiftProblemResolved
                      ? `На ${formatDate(shiftProblemContext.date)} назначен один ${shiftProblemRoleLabel}. Позиция попадёт в расчёт после повторного расчёта зарплаты.`
                      : shiftProblemContext.needsSingleEmployee
                      ? `На ${formatDate(shiftProblemContext.date)} система нашла несколько сотрудников этой роли и не может выбрать исполнителя для начисления.`
                      : `На ${formatDate(shiftProblemContext.date)} нет ${shiftProblemRoleLabel === "мастер" ? "мастера" : "администратора"} на смене, поэтому позиция не вошла в зарплату.`}
                  </p>
                </div>
                <button
                  type="button"
                  className="eco-icon-btn"
                  onClick={() => setShiftProblemContext(null)}
                  title="Скрыть инструкцию"
                  aria-label="Скрыть инструкцию"
                >
                  <X size={16} />
                </button>
              </div>

              <dl className="eco-payroll-resolution-guide__facts">
                {shiftProblemContext.item && (
                  <>
                    <div>
                      <dt>Позиция</dt>
                      <dd>{shiftProblemContext.item.label} × {shiftProblemContext.item.quantity}</dd>
                    </div>
                    <div>
                      <dt>Отгрузка</dt>
                      <dd>
                        <Link href={`/shipment/${encodeURIComponent(shiftProblemContext.item.demandId)}`}>
                          {shiftProblemContext.item.demandName}
                        </Link>
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>Дата смены</dt>
                  <dd>{formatDate(shiftProblemContext.date)} — уже выделена в календаре</dd>
                </div>
                <div>
                  <dt>Сотрудник</dt>
                  <dd>{shiftProblemSelectedUser?.name ?? `Выберите ${shiftProblemRoleLabel === "мастер" ? "мастера" : "администратора"}`}</dd>
                </div>
                {shiftProblemContext.needsSingleEmployee && (
                  <div>
                    <dt>Сейчас на смене</dt>
                    <dd>{shiftProblemAssignedUsers.length ? shiftProblemAssignedUsers.join(", ") : "Нет данных о назначениях"}</dd>
                  </div>
                )}
              </dl>

              <div className="eco-payroll-resolution-guide__action">
                <p>
                  {shiftProblemResolved
                    ? "Нажмите «Готово», вернитесь в расчёт и пересчитайте зарплату, чтобы обновить суммы и список проблем."
                    : shiftProblemContext.needsSingleEmployee
                    ? "Оставьте на этот день одного сотрудника нужной роли. Выбранного сотрудника можно снять со смены кнопкой ниже, затем выбрать другого в списке выше."
                    : "Сотрудник и дата уже выбраны. Подтвердите назначение смены одной кнопкой."}
                </p>
                <EcoButton
                  type="button"
                  variant="primary"
                  onClick={() => {
                    if (shiftProblemResolved) {
                      setShiftProblemContext(null);
                      changeTab("calculation");
                      return;
                    }
                    void toggleShift(shiftProblemContext.date, !shiftProblemContext.needsSingleEmployee);
                  }}
                  disabled={
                    !shiftProblemResolved && (
                      !canManagePayroll ||
                      calendarBusy ||
                      !shiftProblemSelectedUser ||
                      normalizeRole(shiftProblemSelectedUser.role ?? "master") !== shiftProblemContext.role ||
                      (shiftProblemContext.needsSingleEmployee ? !selectedDayHasShift : selectedDayHasShift)
                    )
                  }
                >
                  {shiftProblemResolved
                    ? "Готово — вернуться к расчёту"
                    : shiftProblemContext.needsSingleEmployee
                    ? `Снять смену у ${shiftProblemSelectedUser?.name ?? "сотрудника"}`
                    : `Назначить смену ${shiftProblemSelectedUser?.name ?? "сотруднику"}`}
                </EcoButton>
              </div>
            </section>
          )}

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
                {user.name} · {calendarShiftCounts.get(normalizeLogin(user.login))?.size ?? 0}
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
                <EcoButton type="button" size="sm" variant="primary" onClick={() => void runSelectedShiftAction("add")} disabled={calendarBusy || !canAssignSelectedShifts}>
                  Назначить смены
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => void runSelectedShiftAction("remove")} disabled={calendarBusy || !canRemoveSelectedShifts}>
                  Снять смены
                </EcoButton>
              </div>
              <div className="eco-payroll-month-actions">
                <EcoButton type="button" size="sm" onClick={() => void runBulkShifts("copy")} disabled={calendarBusy}>
                  Скопировать смены прошлого месяца
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => void runBulkShifts("clear")} disabled={calendarBusy}>
                  Снять все смены месяца
                </EcoButton>
                <EcoButton type="button" size="sm" onClick={() => void runBulkShifts("masters")} disabled={calendarBusy || !calendarLogin}>
                  Применить смены ко всем мастерам
                </EcoButton>
              </div>
            </div>
          )}

          <div className="eco-payroll-calendar-layout">
            <div className="eco-payroll-calendar-shell">
              <div className="eco-payroll-calendar-legend">
                <span><i className="is-shift" /> Назначенная смена</span>
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
                      const { hasShift, items } = getEffectiveShiftState(dateKey);
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
                            hasShift ? "has-shift" : "",
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
                      <dt>Смен назначено</dt>
                      <dd>{selectedShiftAssignments} из {selectedShiftCapacity}</dd>
                    </div>
                  </dl>
                  <div className="eco-payroll-day-actions">
                    <EcoButton type="button" size="sm" variant="primary" onClick={() => void runSelectedShiftAction("add")} disabled={!canManagePayroll || calendarBusy || !canAssignSelectedShifts}>
                      Назначить смены
                    </EcoButton>
                    <EcoButton type="button" size="sm" onClick={() => void runSelectedShiftAction("remove")} disabled={!canManagePayroll || calendarBusy || !canRemoveSelectedShifts}>
                      Снять смены
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
                      <dt>Смена</dt>
                      <dd>{selectedDayHasShift ? "Назначена" : "Не назначена"}</dd>
                    </div>
                  </dl>
                  <div className="eco-payroll-day-actions">
                    <EcoButton type="button" size="sm" variant="primary" onClick={() => void toggleShift(selectedDate, true)} disabled={!canManagePayroll || calendarBusy || !calendarLogin || selectedDayHasShift}>
                      Назначить смену
                    </EcoButton>
                    <EcoButton type="button" size="sm" onClick={() => void toggleShift(selectedDate, false)} disabled={!canManagePayroll || calendarBusy || !calendarLogin || !selectedDayHasShift}>
                      Снять смену
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
              <div className="eco-page-kicker">Ставки смен</div>
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

      {activeTab === "adjustments" && canManagePayroll && (
        <section className="eco-payroll-workspace">
          <div className="eco-payroll-toolbar">
            <div>
              <div className="eco-page-kicker">Корректировки</div>
              <p>Бонусы, штрафы, доплаты, компенсации и удержания без кассового движения.</p>
            </div>
            <div className="eco-payroll-controls">
              <EcoButton type="button" onClick={() => void loadAdjustments()} disabled={adjustmentsLoading}>
                {adjustmentsLoading ? <Loader2 size={15} className="eco-spin" /> : <RefreshCw size={15} />}
                Обновить
              </EcoButton>
              <EcoButton type="button" variant="primary" onClick={() => {
                setSelectedLogin(payrollRows[0]?.login ?? teamUsers[0]?.login ?? login);
                openAdjustmentForm("BONUS");
              }}>
                Добавить корректировку
              </EcoButton>
            </div>
          </div>

          {adjustmentsLoading && adjustments.length === 0 ? (
            <SkeletonRows rows={5} />
          ) : adjustments.length === 0 ? (
            <EmptyState title="Корректировок за период нет" text="Бонусы, штрафы, удержания и авансы появятся здесь после создания." />
          ) : (
            <div className="eco-table-wrap eco-payroll-table-wrap">
              <table className="eco-table eco-payroll-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Сотрудник</th>
                    <th>Тип</th>
                    <th className="is-num">Сумма</th>
                    <th>Комментарий</th>
                    <th>Кто создал</th>
                  </tr>
                </thead>
                <tbody>
                  {adjustments.map((item) => {
                    const itemLogin = adjustmentLogin(item);
                    const user = userByLogin.get(normalizeLogin(itemLogin));
                    return (
                      <tr key={item.id}>
                        <td>{formatDate(getAdjustmentDate(item))}</td>
                        <td>{user?.name ?? itemLogin}</td>
                        <td>{adjustmentTypeLabel(item.type)}</td>
                        <td className={`is-num ${item.amountCents < 0 ? "is-negative" : "is-positive"}`}>
                          {formatMoney(item.amountCents)}
                        </td>
                        <td>{item.comment || "—"}</td>
                        <td>@{adjustmentCreator(item) || "system"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === "payments" && (
        <section className="eco-payroll-workspace">
          <div className="eco-payroll-toolbar">
            <div>
              <div className="eco-page-kicker">Выплаты</div>
              <p>Фактические выплаты, авансы и связанные кассовые документы из зарплаты.</p>
            </div>
            <div className="eco-payroll-controls">
              <EcoButton type="button" onClick={() => void loadPayroll()} disabled={payrollLoading}>
                {payrollLoading ? <Loader2 size={15} className="eco-spin" /> : <RefreshCw size={15} />}
                Обновить
              </EcoButton>
              <EcoButton type="button" onClick={() => window.print()}>
                <Download size={15} />
                Экспорт
              </EcoButton>
            </div>
          </div>

          {payrollLoading ? (
            <SkeletonRows rows={5} />
          ) : cashoutHistory.length === 0 ? (
            <EmptyState title="Выплат за период нет" text="Когда появятся РКО по зарплате или авансам, они отобразятся здесь." />
          ) : (
            <div className="eco-table-wrap eco-payroll-table-wrap">
              <table className="eco-table eco-payroll-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Сотрудник</th>
                    <th>Документ</th>
                    <th>Назначение</th>
                    <th className="is-num">Сумма</th>
                    <th>Способ</th>
                  </tr>
                </thead>
                <tbody>
                  {cashoutHistory.map((item) => (
                    <tr key={item.cashoutId}>
                      <td>{formatDate(item.date)}</td>
                      <td>{userByLogin.get(normalizeLogin(item.login))?.name ?? item.login}</td>
                      <td>
                        {item.cashOrderId ? <Link href="/cash">{item.name}</Link> : item.name}
                      </td>
                      <td>
                        {item.sourceType === "payroll_payment" ? paymentOperationLabel(item.operationType) : item.paymentPurpose || item.description || "—"}
                      </td>
                      <td className="is-num is-strong">{formatMoney(item.sumCents)}</td>
                      <td>{paymentMethodLabel(item.paymentMethod)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {activeTab === "motivation" && canManagePayroll && (
        <section className="eco-payroll-workspace eco-payroll-motivation-view">
          <div className="eco-payroll-toolbar">
            <div>
              <div className="eco-page-kicker">Мотивация</div>
              <p>Личные цели, признание и видимость сотруднического экрана без изменения финансовых правил.</p>
            </div>
            <div className="eco-payroll-controls">
              <EcoButton type="button" onClick={() => void loadMotivationOverview()} disabled={motivationLoading}>
                {motivationLoading ? <Loader2 size={15} className="eco-spin" /> : <RefreshCw size={15} />}
                Обновить
              </EcoButton>
            </div>
          </div>

          <section className="eco-grid eco-grid--kpi eco-payroll-motivation-kpis">
            <EcoKpi label="Активных целей" value={motivationOverview?.metrics.activeGoals ?? 0} sub="по сотрудникам и ролям" tone="info" />
            <EcoKpi label="Сотрудников с целью" value={motivationOverview?.metrics.employeesWithGoals ?? 0} sub="личные цели" tone="rust" />
            <EcoKpi label="Похвал" value={motivationOverview?.metrics.recognitionCount ?? 0} sub="не меняют зарплату" tone="success" />
          </section>

          <div className="eco-payroll-motivation-grid">
            <section className="eco-payroll-employee-panel">
              <div className="eco-payroll-panel-head">
                <div>
                  <strong>Установить цель</strong>
                  <span>Визуальный ориентир. Деньги меняются только по финансовым правилам зарплаты.</span>
                </div>
              </div>
              <div className="eco-payroll-motivation-form">
                <FieldLabel label="Сотрудник">
                  <EcoSelect value={goalEmployeeLogin} onChange={(event) => setGoalEmployeeLogin(event.target.value)}>
                    {(motivationOverview?.users ?? teamUsers).map((user) => (
                      <option key={user.login} value={user.login}>{user.name}</option>
                    ))}
                  </EcoSelect>
                </FieldLabel>
                <FieldLabel label="Метрика">
                  <EcoSelect value={goalMetric} onChange={(event) => setGoalMetric(event.target.value)}>
                    <option value="ACCRUAL_AMOUNT">Начисления, ₽</option>
                    <option value="SHIPMENTS">Отгрузки</option>
                    <option value="VEHICLES">Автомобили</option>
                    <option value="SERVICES">Услуги</option>
                    <option value="PRODUCTS">Товары</option>
                    <option value="DIAGNOSTICS">Диагностики</option>
                  </EcoSelect>
                </FieldLabel>
                <FieldLabel label="Период">
                  <EcoSelect value={goalPeriodType} onChange={(event) => setGoalPeriodType(event.target.value as "WEEK" | "MONTH")}>
                    <option value="MONTH">Месяц</option>
                    <option value="WEEK">Неделя</option>
                  </EcoSelect>
                </FieldLabel>
                <FieldLabel label={goalMetric === "ACCRUAL_AMOUNT" ? "Цель, ₽" : "Цель, шт."}>
                  <EcoInput
                    value={goalTargetValue}
                    onChange={(event) => setGoalTargetValue(event.target.value)}
                    inputMode="decimal"
                    placeholder={goalMetric === "ACCRUAL_AMOUNT" ? "40000" : "10"}
                  />
                </FieldLabel>
                <EcoButton type="button" variant="primary" onClick={() => void saveMotivationGoal()} disabled={goalSaving}>
                  {goalSaving ? <Loader2 size={15} className="eco-spin" /> : <Save size={15} />}
                  Сохранить цель
                </EcoButton>
              </div>
            </section>

            <section className="eco-payroll-employee-panel">
              <div className="eco-payroll-panel-head">
                <div>
                  <strong>Похвалить сотрудника</strong>
                  <span>Признание появится в ленте сотрудника и не станет денежной корректировкой.</span>
                </div>
              </div>
              <div className="eco-payroll-motivation-form">
                <FieldLabel label="Сотрудник">
                  <EcoSelect value={recognitionEmployeeLogin} onChange={(event) => setRecognitionEmployeeLogin(event.target.value)}>
                    {(motivationOverview?.users ?? teamUsers).map((user) => (
                      <option key={user.login} value={user.login}>{user.name}</option>
                    ))}
                  </EcoSelect>
                </FieldLabel>
                <FieldLabel label="Причина">
                  <EcoSelect value={recognitionReason} onChange={(event) => setRecognitionReason(event.target.value)}>
                    <option value="good_work">Хорошая работа</option>
                    <option value="teamwork">Командная работа</option>
                    <option value="no_errors">Отгрузка без ошибок</option>
                    <option value="client_feedback">Положительный отзыв</option>
                  </EcoSelect>
                </FieldLabel>
                <FieldLabel label="Видимость">
                  <EcoSelect value={recognitionVisibility} onChange={(event) => setRecognitionVisibility(event.target.value as "PRIVATE" | "TEAM")}>
                    <option value="PRIVATE">Только сотруднику</option>
                    <option value="TEAM">Публично для команды</option>
                  </EcoSelect>
                </FieldLabel>
                <label className="eco-payroll-field is-wide">
                  <span>Комментарий</span>
                  <textarea
                    className="eco-input eco-payroll-comment"
                    value={recognitionMessage}
                    onChange={(event) => setRecognitionMessage(event.target.value)}
                    rows={3}
                    placeholder="Например: Отличная работа с клиентом"
                  />
                </label>
                <EcoButton type="button" variant="primary" onClick={() => void saveEmployeeRecognition()} disabled={recognitionSaving}>
                  {recognitionSaving ? <Loader2 size={15} className="eco-spin" /> : <Check size={15} />}
                  Отправить похвалу
                </EcoButton>
              </div>
            </section>
          </div>

          <div className="eco-payroll-motivation-grid">
            <section className="eco-payroll-employee-panel">
              <div className="eco-payroll-panel-head">
                <div>
                  <strong>Цели</strong>
                  <span>Последние настроенные ориентиры.</span>
                </div>
              </div>
              {motivationLoading ? (
                <SkeletonRows rows={4} />
              ) : !motivationOverview?.goals.length ? (
                <EmptyState title="Целей пока нет" text="Создайте первую цель для сотрудника или роли." />
              ) : (
                <div className="eco-payroll-motivation-list">
                  {motivationOverview.goals.slice(0, 12).map((goal) => {
                    const user = motivationOverview.users.find((item) => normalizeLogin(item.login) === normalizeLogin(goal.employeeLogin ?? ""));
                    return (
                      <div key={goal.id}>
                        <span>{user?.name ?? goal.role ?? "Общая цель"} · {formatDate(goal.startsAt)} - {formatDate(goal.endsAt)}</span>
                        <strong>{motivationMetricLabel(goal.metric)}: {formatMotivationValue(goal.metric, goal.targetValue)}</strong>
                        <p>{goal.periodType === "MONTH" ? "Месячная" : goal.periodType === "WEEK" ? "Недельная" : "Сменная"} · {goal.status}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="eco-payroll-employee-panel">
              <div className="eco-payroll-panel-head">
                <div>
                  <strong>Признание</strong>
                  <span>Последние сообщения владельца сотрудникам.</span>
                </div>
              </div>
              {motivationLoading ? (
                <SkeletonRows rows={4} />
              ) : !motivationOverview?.recognition.length ? (
                <EmptyState title="Похвалы пока нет" text="Признание можно отправить сотруднику без денежной корректировки." />
              ) : (
                <div className="eco-payroll-motivation-list">
                  {motivationOverview.recognition.slice(0, 12).map((item) => {
                    const user = motivationOverview.users.find((candidate) => normalizeLogin(candidate.login) === normalizeLogin(item.employeeLogin));
                    return (
                      <div key={item.id}>
                        <span>{formatDateTime(item.createdAt)} · {user?.name ?? item.employeeLogin}</span>
                        <strong>{item.title}</strong>
                        <p>{item.message}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </section>
      )}

      {activeTab === "history" && (
        <section className="eco-payroll-workspace">
          <div className="eco-payroll-toolbar">
            <div>
              <div className="eco-page-kicker">Периоды</div>
              <p>Закрытые периоды и журнал изменений ставок, смен, правил и корректировок.</p>
            </div>
            <div className="eco-payroll-controls">
              <EcoButton
                type="button"
                onClick={() => void Promise.all([loadHistory(), loadPeriods()])}
                disabled={historyLoading || periodsLoading}
              >
                {historyLoading || periodsLoading ? <Loader2 size={15} className="eco-spin" /> : <RefreshCw size={15} />}
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
                <strong>Периоды</strong>
                <span>{payrollPeriods.length}</span>
              </div>
              {periodsLoading ? (
                <SkeletonRows rows={4} />
              ) : payrollPeriods.length === 0 ? (
                <EmptyState title="Закрытых периодов пока нет" text="После закрытия период станет read-only и появится здесь со snapshot расчёта." />
              ) : (
                <div className="eco-payroll-history-list">
                  {payrollPeriods.map((item) => (
                    <div key={item.id}>
                      <span>{formatDate(item.dateFrom)} - {formatDate(item.dateTo)} · @{item.closedByLogin}</span>
                      <strong>{formatMoney(item.totalAccruedCents)}</strong>
                      <p>
                        Закрыт {formatDateTime(item.closedAt)} · сотрудников {item.employeesCount} · к выплате {formatMoney(item.totalRemainingCents)}
                      </p>
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
                <span>Смены</span>
                <strong>{selectedRow.shiftsCount}</strong>
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

            {canManagePayroll && (
              <div className="eco-payroll-drawer-section">
                <strong>Операции с сотрудником</strong>
                <div className="eco-payroll-operation-grid">
                  <EcoButton type="button" variant="primary" onClick={() => openPaymentForm(selectedRow, "SALARY")} disabled={paymentSaving || adjustmentSaving}>
                    <Banknote size={15} />
                    Выплатить
                  </EcoButton>
                  <EcoButton type="button" onClick={() => openPaymentForm(selectedRow, "ADVANCE")} disabled={paymentSaving || adjustmentSaving}>
                    Выдать аванс
                  </EcoButton>
                  <EcoButton type="button" onClick={() => openAdjustmentForm("BONUS")} disabled={paymentSaving || adjustmentSaving}>
                    Добавить бонус
                  </EcoButton>
                  <EcoButton type="button" onClick={() => openAdjustmentForm("PENALTY")} disabled={paymentSaving || adjustmentSaving}>
                    Добавить штраф
                  </EcoButton>
                  <EcoButton type="button" onClick={() => openAdjustmentForm("DEDUCTION")} disabled={paymentSaving || adjustmentSaving}>
                    Добавить удержание
                  </EcoButton>
                  <EcoButton type="button" onClick={() => openAdjustmentForm("EXTRA_PAY")} disabled={paymentSaving || adjustmentSaving}>
                    Добавить доплату
                  </EcoButton>
                  <EcoButton type="button" onClick={() => openAdjustmentForm("COMPENSATION")} disabled={paymentSaving || adjustmentSaving}>
                    Компенсация
                  </EcoButton>
                </div>
              </div>
            )}

            <div className="eco-payroll-drawer-section">
              <strong>Сдельные начисления по отгрузкам</strong>
              {selectedShipmentBreakdown.length === 0 ? (
                <p>За выбранный период сдельных начислений нет.</p>
              ) : (
                <div className="eco-payroll-shipment-breakdown">
                  {selectedShipmentBreakdown.slice(0, 12).map(({ vehicle, earningsCents, items }) => (
                    <div key={vehicle.demandId} className="eco-payroll-shipment-card">
                      <div className="eco-payroll-shipment-card__head">
                        <div>
                          <span>{formatDate(vehicle.date)} · {vehicle.agentName || "Клиент не указан"}</span>
                          <strong>{vehicle.demandName}</strong>
                        </div>
                        <Link href={`/shipment/${encodeURIComponent(vehicle.demandId)}`}>
                          Открыть
                        </Link>
                      </div>
                      <div className="eco-payroll-shipment-card__summary">
                        <span>Отгрузка {formatMoney(vehicle.sumCents)}</span>
                        <span>Начислено {formatMoney(earningsCents)}</span>
                      </div>
                      <div className="eco-payroll-breakdown-list">
                        {items.map((item, index) => (
                          <div key={`${vehicle.demandId}-${item.label}-${index}`}>
                            <span>{item.category === "work" ? "Услуга мастера" : "Товар администратора"}</span>
                            <strong>{formatMoney(item.amountCents)}</strong>
                            <p>{item.label} × {item.quantity}</p>
                          </div>
                        ))}
                      </div>
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
                      <span>
                        {formatDate(item.date)} · {item.sourceType === "payroll_payment" ? "из зарплаты" : item.agentName || "Расходный ордер"}
                      </span>
                      <strong>{formatMoney(item.sumCents)}</strong>
                      <p>
                        {item.cashOrderId ? <Link href="/cash">{item.name}</Link> : item.name}
                        {" · "}
                        {item.paymentPurpose || item.description || paymentMethodLabel(item.paymentMethod)}
                      </p>
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

            {(paymentOpen || adjustmentOpen || savedAdjustment) && canManagePayroll && (
              <div ref={operationFormRef} className="eco-payroll-operation-panel">
                <div className="eco-payroll-operation-panel__head">
                  <strong>{savedAdjustment ? "Корректировка сохранена" : paymentOpen ? paymentOperationTitle(paymentOperationType) : adjustmentOperationTitle(adjustmentType)}</strong>
                  <button
                    type="button"
                    className="eco-icon-btn"
                    onClick={closePayrollOperation}
                    title="Закрыть форму"
                  >
                    <X size={15} />
                  </button>
                </div>
                {paymentOpen && (
                  <form className="eco-payroll-adjustment" onSubmit={submitPayment}>
                <FieldLabel label="Сотрудник">
                  <EcoSelect
                    value={operationEmployeeLogin || selectedRow.login}
                    onChange={(event) => {
                      const nextLogin = event.target.value;
                      setOperationEmployeeLogin(nextLogin);
                      const nextRow = payrollRows.find((row) => normalizeLogin(row.login) === normalizeLogin(nextLogin));
                      if (paymentOperationType === "SALARY" && nextRow) {
                        setPaymentAmount(formatFixedInput(Math.max(0, nextRow.payroll.remainingCents)));
                      }
                    }}
                  >
                    {payrollOperationUsers.map((user) => (
                      <option key={user.login} value={user.login}>
                        {user.name} · {roleShortLabel(normalizeRole(user.role ?? "master"))}
                      </option>
                    ))}
                  </EcoSelect>
                </FieldLabel>
                <FieldLabel label="Дата">
                  <EcoInput type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
                </FieldLabel>
                <FieldLabel label="Операция">
                  <EcoSelect value={paymentOperationType} onChange={(event) => setPaymentOperationType(event.target.value as typeof paymentOperationType)}>
                    <option value="SALARY">Выплата зарплаты</option>
                    <option value="ADVANCE">Аванс</option>
                    <option value="COMPENSATION">Компенсация</option>
                  </EcoSelect>
                </FieldLabel>
                <FieldLabel label="Сумма">
                  <MoneyInput
                    value={paymentAmount}
                    onValueChange={(_, draft) => setPaymentAmount(draft)}
                    className="eco-input"
                    placeholder="0"
                  />
                </FieldLabel>
                <FieldLabel label="Способ">
                  <EcoSelect value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}>
                    <option value="CASH">Наличные · создать РКО</option>
                    <option value="BANK_TRANSFER">Перевод</option>
                    <option value="OTHER">Другое</option>
                  </EcoSelect>
                </FieldLabel>
                <FieldLabel label="Комментарий">
                  <EcoInput value={paymentComment} onChange={(event) => setPaymentComment(event.target.value)} placeholder="Основание выплаты" />
                </FieldLabel>
                <EcoButton type="submit" variant="primary" disabled={paymentSaving}>
                  {paymentSaving ? <Loader2 size={15} className="eco-spin" /> : <Save size={15} />}
                  Создать выплату
                </EcoButton>
                  </form>
                )}

                {adjustmentOpen && (
                  <form className="eco-payroll-adjustment" onSubmit={submitAdjustment}>
                <FieldLabel label="Сотрудник">
                  <EcoSelect value={operationEmployeeLogin || selectedRow.login} onChange={(event) => setOperationEmployeeLogin(event.target.value)}>
                    {payrollOperationUsers.map((user) => (
                      <option key={user.login} value={user.login}>
                        {user.name} · {roleShortLabel(normalizeRole(user.role ?? "master"))}
                      </option>
                    ))}
                  </EcoSelect>
                </FieldLabel>
                <FieldLabel label="Дата">
                  <EcoInput type="date" value={adjustmentDate} onChange={(event) => setAdjustmentDate(event.target.value)} />
                </FieldLabel>
                <FieldLabel label="Тип">
                  <EcoSelect value={adjustmentType} onChange={(event) => setAdjustmentType(event.target.value as typeof adjustmentType)}>
                    <option value="BONUS">Бонус</option>
                    <option value="PENALTY">Штраф</option>
                    <option value="DEDUCTION">Удержание</option>
                    <option value="EXTRA_PAY">Доплата</option>
                    <option value="COMPENSATION">Компенсация</option>
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
                <FieldLabel label="Причина">
                  <EcoSelect value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)}>
                    <option value="">Не указана</option>
                    <option value="cash_error">Ошибка в кассе</option>
                    <option value="shipment_error">Ошибка в отгрузке</option>
                    <option value="damage">Порча товара</option>
                    <option value="late">Опоздание</option>
                    <option value="advance">Аванс / долг</option>
                    <option value="manual">Другое</option>
                  </EcoSelect>
                </FieldLabel>
                <FieldLabel label="Комментарий">
                  <EcoInput value={adjustmentComment} onChange={(event) => setAdjustmentComment(event.target.value)} />
                </FieldLabel>
                {adjustmentError && (
                  <div className="eco-payroll-operation-error" role="alert">
                    {adjustmentError}
                  </div>
                )}
                <EcoButton type="submit" variant="primary" disabled={adjustmentSaving}>
                  {adjustmentSaving ? <Loader2 size={15} className="eco-spin" /> : <Save size={15} />}
                  {adjustmentSaving ? "Сохраняем корректировку…" : "Сохранить корректировку"}
                </EcoButton>
                  </form>
                )}

                {savedAdjustment && (
                  <section className="eco-payroll-operation-result" role="status" aria-live="polite">
                    <div className="eco-payroll-operation-result__icon" aria-hidden="true"><Check size={18} /></div>
                    <div>
                      <strong>{savedAdjustment.operationTitle} добавлено</strong>
                      <p>
                        {savedAdjustment.employeeName} · {formatMoney(savedAdjustment.amountCents)} · {formatDate(savedAdjustment.date)}
                      </p>
                      {savedAdjustment.refreshFailed && (
                        <small>Корректировка сохранена, но расчёт не обновился. Нажмите «Рассчитать», чтобы обновить суммы.</small>
                      )}
                    </div>
                    <div className="eco-payroll-operation-result__actions">
                      <EcoButton type="button" variant="secondary" size="sm" onClick={() => openAdjustmentForm(adjustmentType)}>
                        Добавить ещё
                      </EcoButton>
                      <EcoButton type="button" variant="ghost" size="sm" onClick={closePayrollOperation}>
                        Готово
                      </EcoButton>
                    </div>
                  </section>
                )}
              </div>
            )}

            <div className="eco-payroll-drawer__footer">
              <EcoButton type="button" onClick={() => setToast("Расчёт уже сохранён в текущем расчёте")}>
                <Save size={15} />
                Сохранить расчёт
              </EcoButton>
              {canManagePayroll && (
                <EcoButton type="button" onClick={() => openPaymentForm(selectedRow, "SALARY")} disabled={paymentSaving || adjustmentSaving}>
                  <Check size={15} />
                  Выплатить
                </EcoButton>
              )}
              {canManagePayroll && (
                <EcoButton type="button" onClick={() => openAdjustmentForm("BONUS")} disabled={paymentSaving || adjustmentSaving}>
                  Добавить корректировку
                </EcoButton>
              )}
              <EcoButton type="button" onClick={() => window.print()} title="Открыть системную печать расчёта">
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
                <span>Смены за период</span>
                <strong>{rateDrawerRow.shiftsCount}</strong>
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

      {unallocatedDrawerReason && (
        <div className="eco-payroll-drawer-backdrop" onClick={() => setUnallocatedDrawerReason(null)}>
          <aside
            className="eco-payroll-drawer eco-payroll-unallocated-drawer"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Позиции, требующие настройки зарплаты"
          >
            <div className="eco-payroll-drawer__head">
              <div>
                <span className="eco-page-kicker">Проверка начислений</span>
                <h2>{unallocatedDrawerReason === "missing_rule" ? "Позиции без правила" : "Позиции без рабочей команды"}</h2>
                <p>
                  {unallocatedDrawerItems.length} поз. за период {formatDate(dateFrom)} — {formatDate(dateTo)}
                </p>
              </div>
              <button type="button" className="eco-icon-btn" onClick={() => setUnallocatedDrawerReason(null)} title="Закрыть">
                <X size={16} />
              </button>
            </div>

            <div className="eco-payroll-drawer-total">
              <span>Требуют настройки</span>
              <strong>{unallocatedDrawerItems.length} поз.</strong>
              <p>
                {unallocatedDrawerReason === "missing_rule"
                  ? "Для этих товаров или услуг нет правила начисления."
                  : "Для этих позиций нужно назначить рабочую команду на дату отгрузки."}
              </p>
            </div>

            <section className="eco-payroll-drawer-section">
              <strong>Все позиции</strong>
              <div className="eco-payroll-unallocated-list">
                {unallocatedDrawerItems.map((item, index) => {
                  const role = item.category === "work" ? "master" : "admin";
                  const needsSingleEmployee = item.reason === "multiple_masters" || item.reason === "multiple_admins";
                  return (
                    <article key={`${item.demandId}-${item.label}-${item.reason}-${index}`}>
                      <div className="eco-payroll-unallocated-list__head">
                        <div>
                          <span>{item.category === "product" ? "Товар · администратор" : "Услуга · мастер"}</span>
                          <strong>{item.label}</strong>
                        </div>
                        <b>× {item.quantity}</b>
                      </div>
                      <p>
                        <Link href={`/shipment/${encodeURIComponent(item.demandId)}`}>{item.demandName}</Link>
                        {" · "}{formatDate(item.date)}{item.agentName ? ` · ${item.agentName}` : ""}
                      </p>
                      {unallocatedDrawerReason !== "missing_rule" && (
                        <EcoButton
                          type="button"
                          size="sm"
                          onClick={() => {
                            setUnallocatedDrawerReason(null);
                            openShiftProblem(item.date, role, needsSingleEmployee, item);
                          }}
                        >
                          Открыть график
                        </EcoButton>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>

            {unallocatedDrawerReason === "missing_rule" && (
              <div className="eco-payroll-drawer__footer">
                {unallocatedDrawerRoles.map((role) => (
                  <EcoButton
                    key={role}
                    type="button"
                    variant="primary"
                    onClick={() => {
                      setUnallocatedDrawerReason(null);
                      changeTab("rules");
                      setRuleRoleFilter(role);
                      setToast(`Настройте правила для ${role === "master" ? "мастера" : "администратора"}.`);
                    }}
                  >
                    Настроить правила для {role === "master" ? "мастера" : "администратора"}
                  </EcoButton>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
