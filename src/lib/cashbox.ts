import fs from "fs";
import path from "path";
import { getSession, type User } from "./auth";
import { moyskladFetch, type MoySkladMeta } from "./moysklad";
import {
  endShift as endWorkShift,
  getCurrentShift as getCurrentWorkShift,
  startShift as startWorkShift,
} from "./shifts";

export type CashShiftStatus = "open" | "closed";

export type CashOperationType = "withdrawal" | "expense";

export type CashUserSnapshot = {
  login: string;
  name: string;
  role: User["role"];
};

export type CashShift = {
  id: string;
  serviceDate: string; // YYYY-MM-DD в часовом поясе сервиса
  timezone: string;
  status: CashShiftStatus;
  openedAt: string; // ISO
  openedBy: CashUserSnapshot;
  openingCash: number; // стартовый остаток наличных
  closedAt?: string;
  closedBy?: CashUserSnapshot;
  // Итоги по заказам за смену (нал/карта) — могут быть обновлены при закрытии
  cashOrdersTotal?: number;
  cardOrdersTotal?: number;
  // Итоги внутренних операций
  withdrawalsTotal?: number;
  cashExpensesTotal?: number;
  // Расчётные / фактические / расхождение
  expectedCash?: number;
  actualCash?: number;
  discrepancy?: number;
  discrepancyComment?: string;
};

export type CashOperationBase = {
  id: string;
  shiftId: string;
  createdAt: string;
  createdBy: CashUserSnapshot;
  amount: number;
  comment?: string;
};

export type CashWithdrawal = CashOperationBase & {
  type: "withdrawal";
  reason: string;
};

export type CashExpensePaymentType = "cash" | "card";

export type CashExpense = CashOperationBase & {
  type: "expense";
  article: string; // основание / назначение платежа
  counterpartyName?: string;
  counterpartyMetaHref?: string;
  expenseItemName?: string;
  expenseItemMetaHref?: string;
  paymentType: CashExpensePaymentType;
  attachmentUrl?: string;
  moyskladCashoutHref?: string;
};

export type CashOperation = CashWithdrawal | CashExpense;

type CashboxState = {
  shifts: CashShift[];
  operations: CashOperation[];
};

const DEFAULT_TIMEZONE =
  process.env.SERVICE_TIMEZONE && process.env.SERVICE_TIMEZONE.trim()
    ? process.env.SERVICE_TIMEZONE.trim()
    : process.env.APP_TIMEZONE && process.env.APP_TIMEZONE.trim()
      ? process.env.APP_TIMEZONE.trim()
      : Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Moscow";

function getDbFilePath() {
  const base =
    process.env.CASHBOX_DB_PATH && process.env.CASHBOX_DB_PATH.trim()
      ? process.env.CASHBOX_DB_PATH.trim()
      : path.join(process.cwd(), ".data", "cashbox.json");
  const dir = path.dirname(base);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return base;
}

function readState(): CashboxState {
  try {
    const file = getDbFilePath();
    if (!fs.existsSync(file)) {
      return { shifts: [], operations: [] };
    }
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return { shifts: [], operations: [] };
    const parsed = JSON.parse(raw) as CashboxState;
    if (!parsed.shifts || !parsed.operations) {
      return { shifts: [], operations: [] };
    }
    return parsed;
  } catch {
    return { shifts: [], operations: [] };
  }
}

function writeState(state: CashboxState) {
  const file = getDbFilePath();
  fs.writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
}

function generateId(prefix: string): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `${prefix}_${ts}_${rnd}`;
}

function getTodayServiceDate(): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function userToSnapshot(user: User): CashUserSnapshot {
  return { login: user.login, name: user.name, role: user.role };
}

export async function requireSessionUser() {
  const session = await getSession();
  if (!session) {
    throw new Error("Требуется авторизация");
  }
  return session.user;
}

export function assertOwnerOrAdmin(user: User) {
  if (user.role !== "owner" && user.role !== "admin") {
    throw new Error("Доступ только для владельца или администратора");
  }
}

export function assertOwner(user: User) {
  if (user.role !== "owner") {
    throw new Error("Операция доступна только владельцу");
  }
}

export function getCurrentShift(): CashShift | null {
  const state = readState();
  const serviceDate = getTodayServiceDate();
  return state.shifts.find((s) => s.status === "open" && s.serviceDate === serviceDate) ?? null;
}

export function listShifts(limit = 50): CashShift[] {
  const state = readState();
  return [...state.shifts]
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))
    .slice(0, limit);
}

export function listOperationsForShift(shiftId: string): CashOperation[] {
  const state = readState();
  return state.operations
    .filter((op) => op.shiftId === shiftId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function ensureAdminWorkShiftOpened(user: User) {
  if (user.role !== "admin") return;

  const currentWorkShift = await getCurrentWorkShift(user.login);
  if (currentWorkShift) return;

  const result = await startWorkShift(user.login);
  if (!result.ok) {
    if (result.error.toLowerCase().includes("на сегодня смена уже открыта")) return;
    throw new Error(`Не удалось открыть рабочую смену администратора: ${result.error}`);
  }
}

async function ensureAdminWorkShiftClosed(user: User) {
  if (user.role !== "admin") return;

  const currentWorkShift = await getCurrentWorkShift(user.login);
  if (!currentWorkShift) return;

  const result = await endWorkShift(user.login);
  if (!result.ok) {
    throw new Error(`Не удалось закрыть рабочую смену администратора: ${result.error}`);
  }
}

export async function openShift(openingCash: number): Promise<CashShift> {
  if (!Number.isFinite(openingCash) || openingCash < 0) {
    throw new Error("Стартовый остаток должен быть неотрицательным числом");
  }
  const user = await requireSessionUser();
  assertOwnerOrAdmin(user);

  const state = readState();
  const serviceDate = getTodayServiceDate();
  const existingForServiceDate = state.shifts.find((s) => s.serviceDate === serviceDate);
  if (existingForServiceDate?.status === "open") {
    throw new Error("Кассовая смена на сегодня уже открыта");
  }
  if (existingForServiceDate) {
    throw new Error("Кассовая смена на сегодня уже была открыта и закрыта");
  }

  await ensureAdminWorkShiftOpened(user);

  const nowIso = new Date().toISOString();
  const shift: CashShift = {
    id: generateId("shift"),
    serviceDate,
    timezone: DEFAULT_TIMEZONE,
    status: "open",
    openedAt: nowIso,
    openedBy: userToSnapshot(user),
    openingCash: Math.round(openingCash * 100) / 100,
  };

  state.shifts.push(shift);
  writeState(state);
  return shift;
}

export async function addWithdrawal(params: {
  shiftId: string;
  amount: number;
  reason: string;
  comment?: string;
}): Promise<CashWithdrawal> {
  const user = await requireSessionUser();
  assertOwner(user);
  const state = readState();
  const shift = state.shifts.find((s) => s.id === params.shiftId);
  if (!shift || shift.status !== "open") {
    throw new Error("Открытая смена не найдена");
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("Сумма должна быть положительным числом");
  }
  const op: CashWithdrawal = {
    id: generateId("op"),
    type: "withdrawal",
    shiftId: shift.id,
    createdAt: new Date().toISOString(),
    createdBy: userToSnapshot(user),
    amount: Math.round(params.amount * 100) / 100,
    reason: params.reason.trim(),
    comment: params.comment?.trim() || undefined,
  };
  state.operations.push(op);
  writeState(state);
  return op;
}

export async function addExpense(params: {
  shiftId: string;
  amount: number;
  article: string;
  expenseDate?: string;
  counterpartyName?: string;
  counterpartyMetaHref?: string;
  expenseItemName?: string;
  expenseItemMetaHref?: string;
  paymentType: CashExpensePaymentType;
  comment?: string;
  attachmentUrl?: string;
  moyskladCashoutHref?: string;
}): Promise<CashExpense> {
  const user = await requireSessionUser();
  assertOwnerOrAdmin(user);
  const state = readState();
  const shift = state.shifts.find((s) => s.id === params.shiftId);
  if (!shift || shift.status !== "open") {
    throw new Error("Открытая смена не найдена");
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("Сумма должна быть положительным числом");
  }
  let moyskladCashoutHref: string | undefined = params.moyskladCashoutHref;

  if (!moyskladCashoutHref) {
    moyskladCashoutHref = await createMoyskladCashout({
      amount: params.amount,
      article: params.article,
      expenseDate: params.expenseDate,
      counterpartyMetaHref: params.counterpartyMetaHref,
      expenseItemMetaHref: params.expenseItemMetaHref,
      comment: params.comment,
    });
  }

  const op: CashExpense = {
    id: generateId("op"),
    type: "expense",
    shiftId: shift.id,
    createdAt: new Date().toISOString(),
    createdBy: userToSnapshot(user),
    amount: Math.round(params.amount * 100) / 100,
    article: params.article.trim(),
    counterpartyName: params.counterpartyName?.trim() || undefined,
    counterpartyMetaHref: params.counterpartyMetaHref?.trim() || undefined,
    expenseItemName: params.expenseItemName?.trim() || undefined,
    expenseItemMetaHref: params.expenseItemMetaHref?.trim() || undefined,
    paymentType: params.paymentType,
    comment: params.comment?.trim() || undefined,
    attachmentUrl: params.attachmentUrl?.trim() || undefined,
    moyskladCashoutHref,
  };
  state.operations.push(op);
  writeState(state);
  return op;
}

export async function closeShift(params: {
  shiftId: string;
  actualCash: number;
  cashOrdersTotal: number;
  cardOrdersTotal: number;
  comment?: string;
}): Promise<CashShift> {
  const user = await requireSessionUser();
  assertOwnerOrAdmin(user);
  if (!Number.isFinite(params.actualCash) || params.actualCash < 0) {
    throw new Error("Фактические наличные должны быть неотрицательным числом");
  }
  const state = readState();
  const shift = state.shifts.find((s) => s.id === params.shiftId);
  if (!shift || shift.status !== "open") {
    throw new Error("Открытая смена не найдена");
  }

  await ensureAdminWorkShiftClosed(user);

  const ops = state.operations.filter((op) => op.shiftId === shift.id);
  const withdrawalsTotal = ops
    .filter((op): op is CashWithdrawal => op.type === "withdrawal")
    .reduce((sum, op) => sum + (op.amount || 0), 0);
  const cashExpensesTotal = ops
    .filter((op): op is CashExpense => op.type === "expense" && op.paymentType === "cash")
    .reduce((sum, op) => sum + (op.amount || 0), 0);

  const opening = shift.openingCash || 0;
  const cashOrders = Math.max(0, params.cashOrdersTotal || 0);
  const cardOrders = Math.max(0, params.cardOrdersTotal || 0);

  const expectedCash = opening + cashOrders - withdrawalsTotal - cashExpensesTotal;
  const actualCash = Math.round((params.actualCash || 0) * 100) / 100;
  const discrepancy = Math.round((actualCash - expectedCash) * 100) / 100;

  const updated: CashShift = {
    ...shift,
    status: "closed",
    closedAt: new Date().toISOString(),
    closedBy: userToSnapshot(user),
    cashOrdersTotal: Math.round(cashOrders * 100) / 100,
    cardOrdersTotal: Math.round(cardOrders * 100) / 100,
    withdrawalsTotal: Math.round(withdrawalsTotal * 100) / 100,
    cashExpensesTotal: Math.round(cashExpensesTotal * 100) / 100,
    expectedCash: Math.round(expectedCash * 100) / 100,
    actualCash,
    discrepancy,
    discrepancyComment: discrepancy !== 0 ? params.comment?.trim() || "" : "",
  };

  state.shifts = state.shifts.map((s) => (s.id === shift.id ? updated : s));
  writeState(state);
  return updated;
}

async function createMoyskladCashout(params: {
  amount: number;
  article: string;
  expenseDate?: string;
  counterpartyMetaHref?: string;
  expenseItemMetaHref?: string;
  comment?: string;
}): Promise<string> {
  const orgHref = process.env.MOYSKLAD_CASHOUT_ORGANIZATION_HREF?.trim();
  const agentHref =
    params.counterpartyMetaHref?.trim() || process.env.MOYSKLAD_CASHOUT_AGENT_HREF?.trim();
  const expenseItemHref =
    params.expenseItemMetaHref?.trim() || process.env.MOYSKLAD_CASHOUT_EXPENSE_ITEM_HREF?.trim();
  if (!orgHref || !agentHref || !expenseItemHref) {
    throw new Error(
      "Не удалось создать расходный ордер в МойСклад: не настроены organization, counterparty или expense item"
    );
  }

  const metaFromHref = (href: string, type: MoySkladMeta["type"]): MoySkladMeta => ({
    href,
    type,
    mediaType: "application/json",
  });

  const sum = Math.round(Math.max(0, params.amount || 0) * 100);
  const moment = normalizeMoyskladDate(params.expenseDate);

  const body = {
    organization: { meta: metaFromHref(orgHref, "organization") },
    agent: { meta: metaFromHref(agentHref, "counterparty") },
    expenseItem: { meta: metaFromHref(expenseItemHref, "expenseitem") },
    applicable: true,
    ...(moment ? { moment } : {}),
    sum,
    description: params.comment?.trim() || params.article.trim(),
    paymentPurpose: params.article.trim(),
  };

  const result = await moyskladFetch<{ meta?: MoySkladMeta }>("/entity/cashout", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!result.ok) {
    throw new Error(`Не удалось создать расходный ордер в МойСклад: ${result.error}`);
  }
  if (!result.data.meta?.href) {
    throw new Error("МойСклад не вернул ссылку на созданный расходный ордер");
  }
  return result.data.meta.href;
}

function normalizeMoyskladDate(date?: string): string | undefined {
  const trimmed = date?.trim();
  if (!trimmed) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Дата расходного ордера должна быть в формате ГГГГ-ММ-ДД");
  }
  return `${trimmed} 00:00:00`;
}

