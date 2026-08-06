import fs from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { getSession, type User } from "./auth";
import { SERVICE_TIME_ZONE, toServiceDateInput } from "./date-time";
import { prisma } from "./db";
import { requireBranchContext } from "./branch-context";
import {
  cancelCashExpenseOrder,
  cashExpenseOrderToOperation,
  createCashExpenseOrder,
  getCashExpenseOrder,
  listCashExpenseOrderOperationsForShift,
  postCashExpenseOrder,
  updateCashExpenseOrderDraft,
  type CashExpenseOrderSource,
  type CashExpenseOrderStatus,
} from "./cash-expense-orders";
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
  orderId?: string;
  number?: string;
  article: string; // основание / назначение платежа
  expenseDate?: string;
  amountCents?: number;
  status?: CashExpenseOrderStatus;
  source?: CashExpenseOrderSource;
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

export type CashOperation = CashWithdrawal | CashExpense;

type CashboxState = {
  shifts: CashShift[];
  operations: CashOperation[];
};

type ListOperationsOptions = {
  strictLocalExpenses?: boolean;
};

type CashShiftRow = Prisma.CashShiftGetPayload<Prisma.CashShiftDefaultArgs>;
type CashWithdrawalRow = Prisma.CashWithdrawalGetPayload<Prisma.CashWithdrawalDefaultArgs>;

const DEFAULT_TIMEZONE =
  process.env.SERVICE_TIMEZONE && process.env.SERVICE_TIMEZONE.trim()
    ? process.env.SERVICE_TIMEZONE.trim()
    : process.env.APP_TIMEZONE && process.env.APP_TIMEZONE.trim()
      ? process.env.APP_TIMEZONE.trim()
      : SERVICE_TIME_ZONE;

function getDbFilePath() {
  return process.env.CASHBOX_DB_PATH && process.env.CASHBOX_DB_PATH.trim()
    ? process.env.CASHBOX_DB_PATH.trim()
    : path.join(process.cwd(), ".data", "cashbox.json");
}

function readLegacyState(): CashboxState {
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
  } catch (error) {
    console.error("[cashbox] failed to read cashbox state", error);
    return { shifts: [], operations: [] };
  }
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
    return toServiceDateInput(new Date());
  }
}

function userRole(value?: string | null): User["role"] {
  if (value === "owner" || value === "admin" || value === "master") return value;
  return "admin";
}

function centsFromRub(amount?: number | null): number {
  if (!Number.isFinite(amount ?? 0)) return 0;
  return Math.round((amount ?? 0) * 100);
}

function rubFromCents(cents?: number | null): number {
  return Math.round(((cents ?? 0) / 100) * 100) / 100;
}

function dateFromIso(value?: string): Date {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function snapshotFromFields(params: {
  login: string;
  name?: string | null;
  role?: string | null;
}): CashUserSnapshot {
  return {
    login: params.login,
    name: params.name || params.login,
    role: userRole(params.role),
  };
}

function shiftRowToCashShift(row: CashShiftRow): CashShift {
  return {
    id: row.id,
    serviceDate: row.serviceDate,
    timezone: row.timezone,
    status: row.status === "closed" ? "closed" : "open",
    openedAt: row.openedAt.toISOString(),
    openedBy: snapshotFromFields({
      login: row.openedBy,
      name: row.openedByName,
      role: row.openedByRole,
    }),
    openingCash: rubFromCents(row.openingCashCents),
    closedAt: row.closedAt?.toISOString(),
    closedBy: row.closedBy
      ? snapshotFromFields({
          login: row.closedBy,
          name: row.closedByName,
          role: row.closedByRole,
        })
      : undefined,
    cashOrdersTotal:
      row.cashOrdersTotalCents == null ? undefined : rubFromCents(row.cashOrdersTotalCents),
    cardOrdersTotal:
      row.cardOrdersTotalCents == null ? undefined : rubFromCents(row.cardOrdersTotalCents),
    withdrawalsTotal:
      row.withdrawalsTotalCents == null ? undefined : rubFromCents(row.withdrawalsTotalCents),
    cashExpensesTotal:
      row.cashExpensesTotalCents == null ? undefined : rubFromCents(row.cashExpensesTotalCents),
    expectedCash: row.expectedCashCents == null ? undefined : rubFromCents(row.expectedCashCents),
    actualCash: row.actualCashCents == null ? undefined : rubFromCents(row.actualCashCents),
    discrepancy: row.discrepancyCents == null ? undefined : rubFromCents(row.discrepancyCents),
    discrepancyComment: row.discrepancyComment ?? undefined,
  };
}

function withdrawalRowToOperation(row: CashWithdrawalRow): CashWithdrawal {
  return {
    id: row.id,
    type: "withdrawal",
    shiftId: row.shiftId,
    createdAt: row.createdAt.toISOString(),
    createdBy: snapshotFromFields({
      login: row.createdBy,
      name: row.createdByName,
      role: row.createdByRole,
    }),
    amount: rubFromCents(row.amountCents),
    reason: row.reason,
    comment: row.comment ?? undefined,
  };
}

let legacyImportPromise: Promise<void> | null = null;

async function importLegacyCashboxState() {
  const state = readLegacyState();
  if (state.shifts.length === 0 && state.operations.length === 0) return;

  const existingOpen = await prisma.cashShift.findFirst({
    where: { status: "open" },
    orderBy: [{ openedAt: "desc" }],
  });
  const latestLegacyOpen = [...state.shifts]
    .filter((shift) => shift.status === "open")
    .sort((a, b) => b.openedAt.localeCompare(a.openedAt))[0];
  const legacyOpenIdToKeep = existingOpen ? null : latestLegacyOpen?.id;

  for (const shift of state.shifts) {
    const existing = await prisma.cashShift.findFirst({
      where: { OR: [{ id: shift.id }, { serviceDate: shift.serviceDate }] },
      select: { id: true },
    });
    if (existing) continue;

    const status = shift.status === "open" && shift.id === legacyOpenIdToKeep ? "open" : "closed";
    await prisma.cashShift.create({
      data: {
        id: shift.id,
        serviceDate: shift.serviceDate,
        timezone: shift.timezone || DEFAULT_TIMEZONE,
        status,
        openedAt: dateFromIso(shift.openedAt),
        openedBy: shift.openedBy.login,
        openedByName: shift.openedBy.name,
        openedByRole: shift.openedBy.role,
        openingCashCents: centsFromRub(shift.openingCash),
        closedAt: shift.closedAt ? dateFromIso(shift.closedAt) : null,
        closedBy: shift.closedBy?.login,
        closedByName: shift.closedBy?.name,
        closedByRole: shift.closedBy?.role,
        cashOrdersTotalCents:
          shift.cashOrdersTotal == null ? null : centsFromRub(shift.cashOrdersTotal),
        cardOrdersTotalCents:
          shift.cardOrdersTotal == null ? null : centsFromRub(shift.cardOrdersTotal),
        withdrawalsTotalCents:
          shift.withdrawalsTotal == null ? null : centsFromRub(shift.withdrawalsTotal),
        cashExpensesTotalCents:
          shift.cashExpensesTotal == null ? null : centsFromRub(shift.cashExpensesTotal),
        expectedCashCents: shift.expectedCash == null ? null : centsFromRub(shift.expectedCash),
        actualCashCents: shift.actualCash == null ? null : centsFromRub(shift.actualCash),
        discrepancyCents: shift.discrepancy == null ? null : centsFromRub(shift.discrepancy),
        discrepancyComment: shift.discrepancyComment ?? null,
        source: "legacy_json",
      },
    });
  }

  for (const op of state.operations) {
    if (op.type !== "withdrawal") continue;
    const shift = await prisma.cashShift.findUnique({
      where: { id: op.shiftId },
      select: { id: true },
    });
    if (!shift) continue;
    await prisma.cashWithdrawal.upsert({
      where: { id: op.id },
      create: {
        id: op.id,
        shiftId: op.shiftId,
        amountCents: centsFromRub(op.amount),
        reason: op.reason,
        comment: op.comment ?? null,
        createdBy: op.createdBy.login,
        createdByName: op.createdBy.name,
        createdByRole: op.createdBy.role,
        createdAt: dateFromIso(op.createdAt),
        source: "legacy_json",
      },
      update: {},
    });
  }
}

async function ensureLegacyCashboxImported() {
  if (process.env.CASHBOX_DISABLE_LEGACY_IMPORT === "1") return;
  if (!legacyImportPromise) {
    legacyImportPromise = importLegacyCashboxState().catch((error) => {
      legacyImportPromise = null;
      console.error("[cashbox] failed to import legacy cashbox state", error);
      throw error;
    });
  }
  await legacyImportPromise;
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

async function activeCashBranchId(): Promise<string> {
  const context = await requireBranchContext({ allowAll: false, requireActive: true });
  if (!context.branchId) throw new Error("Активный филиал не выбран");
  return context.branchId;
}

async function findCurrentShiftRow(): Promise<CashShiftRow | null> {
  await ensureLegacyCashboxImported();
  const branchId = await activeCashBranchId();
  return prisma.cashShift.findFirst({
    where: { branchId, status: "open" },
    orderBy: [{ openedAt: "desc" }],
  });
}

async function findShiftRowById(id: string): Promise<CashShiftRow | null> {
  await ensureLegacyCashboxImported();
  const branchId = await activeCashBranchId();
  return prisma.cashShift.findFirst({ where: { id, branchId } });
}

export async function getCurrentShift(): Promise<CashShift | null> {
  const shift = await findCurrentShiftRow();
  return shift ? shiftRowToCashShift(shift) : null;
}

export async function listShifts(limit = 50): Promise<CashShift[]> {
  await ensureLegacyCashboxImported();
  const branchId = await activeCashBranchId();
  const shifts = await prisma.cashShift.findMany({
    where: { branchId },
    orderBy: [{ openedAt: "desc" }],
    take: Math.min(200, Math.max(1, limit)),
  });
  return shifts.map(shiftRowToCashShift);
}

export async function listOperationsForShift(
  shiftId: string,
  options: ListOperationsOptions = {}
): Promise<CashOperation[]> {
  await ensureLegacyCashboxImported();
  const branchId = await activeCashBranchId();
  const shift = await prisma.cashShift.findFirst({ where: { id: shiftId, branchId }, select: { id: true } });
  if (!shift) throw new Error("Кассовая смена не найдена в активном филиале");
  const legacyState = readLegacyState();
  const fileOperations = legacyState.operations
    .filter((op) => op.shiftId === shiftId)
    .filter((op) => op.type === "expense")
    .map((op) =>
      op.type === "expense" && !op.status
        ? { ...op, status: "posted" as CashExpenseOrderStatus, source: "moysklad_import" as CashExpenseOrderSource }
        : op
    );
  const withdrawals = await prisma.cashWithdrawal.findMany({
    where: { branchId, shiftId },
    orderBy: [{ createdAt: "asc" }],
  });
  let localExpenses: CashOperation[] = [];
  try {
    localExpenses = await listCashExpenseOrderOperationsForShift(shiftId);
  } catch (error) {
    if (options.strictLocalExpenses) throw error;
    console.error("[cashbox] failed to load local cash expense orders", error);
  }
  return [...fileOperations, ...withdrawals.map(withdrawalRowToOperation), ...localExpenses].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt)
  );
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

  await ensureLegacyCashboxImported();
  const branchId = await activeCashBranchId();
  const serviceDate = getTodayServiceDate();
  const existingOpenShift = await prisma.cashShift.findFirst({
    where: { branchId, status: "open" },
    orderBy: [{ openedAt: "desc" }],
  });
  if (existingOpenShift) {
    throw new Error(
      existingOpenShift.serviceDate === serviceDate
        ? "Кассовая смена на сегодня уже открыта"
        : `Есть незакрытая кассовая смена за ${existingOpenShift.serviceDate}. Закройте её перед открытием новой.`
    );
  }
  const existingForServiceDate = await prisma.cashShift.findUnique({
    where: { branchId_serviceDate: { branchId, serviceDate } },
    select: { id: true },
  });
  if (existingForServiceDate) {
    throw new Error("Кассовая смена на сегодня уже была открыта и закрыта");
  }

  await ensureAdminWorkShiftOpened(user);

  try {
    const shift = await prisma.cashShift.create({
      data: {
        id: generateId("shift"),
        branchId,
        serviceDate,
        timezone: DEFAULT_TIMEZONE,
        status: "open",
        openedAt: new Date(),
        openedBy: user.login,
        openedByName: user.name,
        openedByRole: user.role,
        openingCashCents: centsFromRub(openingCash),
        source: "local",
      },
    });
    return shiftRowToCashShift(shift);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("Кассовая смена уже открыта или уже была открыта сегодня");
    }
    throw error;
  }
}

export async function addWithdrawal(params: {
  shiftId: string;
  amount: number;
  reason: string;
  comment?: string;
}): Promise<CashWithdrawal> {
  const user = await requireSessionUser();
  assertOwner(user);
  const shift = await findShiftRowById(params.shiftId);
  if (!shift || shift.status !== "open") {
    throw new Error("Открытая смена не найдена");
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("Сумма должна быть положительным числом");
  }
  const op = await prisma.cashWithdrawal.create({
    data: {
      id: generateId("op"),
      branchId: shift.branchId,
      shiftId: shift.id,
      amountCents: centsFromRub(params.amount),
      reason: params.reason.trim(),
      comment: params.comment?.trim() || null,
      createdBy: user.login,
      createdByName: user.name,
      createdByRole: user.role,
      source: "local",
    },
  });
  return withdrawalRowToOperation(op);
}

export async function addExpense(params: {
  shiftId: string;
  amount: number;
  article: string;
  expenseDate?: string;
  expenseItemId?: string;
  counterpartyName?: string;
  counterpartyId?: string;
  counterpartyMetaHref?: string;
  expenseItemName?: string;
  expenseItemMetaHref?: string;
  paymentType: CashExpensePaymentType;
  status?: CashExpenseOrderStatus;
  comment?: string;
  attachmentUrl?: string;
  moyskladCashoutHref?: string;
}): Promise<CashExpense> {
  const user = await requireSessionUser();
  assertOwnerOrAdmin(user);
  const shift = await findShiftRowById(params.shiftId);
  if (!shift || shift.status !== "open") {
    throw new Error("Открытая смена не найдена");
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    throw new Error("Сумма должна быть положительным числом");
  }
  if (!params.expenseDate?.trim()) {
    throw new Error("Укажите дату расходного ордера");
  }
  if (!params.expenseItemName?.trim()) {
    throw new Error("Выберите статью расхода");
  }
  if (!params.counterpartyName?.trim()) {
    throw new Error("Выберите контрагента");
  }

  const order = await createCashExpenseOrder(
    {
      shiftId: shift.id,
      amount: params.amount,
      article: params.article,
      expenseDate: params.expenseDate,
      expenseItemId: params.expenseItemId,
      expenseItemName: params.expenseItemName,
      expenseItemMetaHref: params.expenseItemMetaHref,
      counterpartyId: params.counterpartyId,
      counterpartyName: params.counterpartyName,
      counterpartyMetaHref: params.counterpartyMetaHref,
      paymentType: params.paymentType,
      status: params.status ?? "posted",
      comment: params.comment,
      attachmentUrl: params.attachmentUrl,
      moyskladCashoutHref: params.moyskladCashoutHref,
    },
    user
  );
  return cashExpenseOrderToOperation(order);
}

export async function updateExpenseDraft(params: {
  id: string;
  amount?: number;
  article?: string;
  expenseDate?: string;
  expenseItemId?: string;
  expenseItemName?: string;
  expenseItemMetaHref?: string;
  counterpartyId?: string;
  counterpartyName?: string;
  counterpartyMetaHref?: string;
  paymentType?: CashExpensePaymentType;
  comment?: string;
  attachmentUrl?: string;
}): Promise<CashExpense> {
  const user = await requireSessionUser();
  assertOwnerOrAdmin(user);
  const order = await getCashExpenseOrder(params.id);
  if (!order) throw new Error("Расходный ордер не найден");
  const shift = await findShiftRowById(order.shiftId);
  if (!shift || shift.status !== "open") {
    throw new Error("Редактировать расходный ордер можно только в открытой смене");
  }
  const updated = await updateCashExpenseOrderDraft(params.id, params, user);
  return cashExpenseOrderToOperation(updated);
}

export async function postExpense(params: { id: string }): Promise<CashExpense> {
  const user = await requireSessionUser();
  assertOwnerOrAdmin(user);
  const order = await getCashExpenseOrder(params.id);
  if (!order) throw new Error("Расходный ордер не найден");
  const shift = await findShiftRowById(order.shiftId);
  if (!shift || shift.status !== "open") {
    throw new Error("Провести расходный ордер можно только в открытой смене");
  }
  const updated = await postCashExpenseOrder(params.id, user);
  return cashExpenseOrderToOperation(updated);
}

export async function cancelExpense(params: { id: string; reason?: string }): Promise<CashExpense> {
  const user = await requireSessionUser();
  assertOwnerOrAdmin(user);
  const order = await getCashExpenseOrder(params.id);
  if (!order) throw new Error("Расходный ордер не найден");
  const shift = await findShiftRowById(order.shiftId);
  if (!shift || shift.status !== "open") {
    throw new Error("Отменить расходный ордер можно только в открытой смене");
  }
  const updated = await cancelCashExpenseOrder(params.id, user, params.reason);
  return cashExpenseOrderToOperation(updated);
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
  const shift = await findShiftRowById(params.shiftId);
  if (!shift || shift.status !== "open") {
    throw new Error("Открытая смена не найдена");
  }

  await ensureAdminWorkShiftClosed(user);

  const ops = await listOperationsForShift(shift.id, { strictLocalExpenses: true });
  const withdrawalsTotal = ops
    .filter((op): op is CashWithdrawal => op.type === "withdrawal")
    .reduce((sum, op) => sum + (op.amount || 0), 0);
  const cashExpensesTotal = ops
    .filter(
      (op): op is CashExpense =>
        op.type === "expense" &&
        op.paymentType === "cash" &&
        op.status !== "draft" &&
        op.status !== "cancelled"
    )
    .reduce((sum, op) => sum + (op.amount || 0), 0);

  const opening = rubFromCents(shift.openingCashCents);
  const cashOrders = Math.max(0, params.cashOrdersTotal || 0);
  const cardOrders = Math.max(0, params.cardOrdersTotal || 0);

  const expectedCash = opening + cashOrders - withdrawalsTotal - cashExpensesTotal;
  const actualCash = Math.round((params.actualCash || 0) * 100) / 100;
  const discrepancy = Math.round((actualCash - expectedCash) * 100) / 100;

  const updated = await prisma.cashShift.update({
    where: { id: shift.id },
    data: {
      status: "closed",
      closedAt: new Date(),
      closedBy: user.login,
      closedByName: user.name,
      closedByRole: user.role,
      cashOrdersTotalCents: centsFromRub(cashOrders),
      cardOrdersTotalCents: centsFromRub(cardOrders),
      withdrawalsTotalCents: centsFromRub(withdrawalsTotal),
      cashExpensesTotalCents: centsFromRub(cashExpensesTotal),
      expectedCashCents: centsFromRub(expectedCash),
      actualCashCents: centsFromRub(actualCash),
      discrepancyCents: centsFromRub(discrepancy),
      discrepancyComment: discrepancy !== 0 ? params.comment?.trim() || "" : "",
    },
  });
  return shiftRowToCashShift(updated);
}
