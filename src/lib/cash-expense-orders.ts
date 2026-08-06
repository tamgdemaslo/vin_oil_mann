import { Prisma } from "@prisma/client";
import { toServiceDateInput } from "@/lib/date-time";
import { prisma } from "@/lib/db";
import { requireBranchContext } from "@/lib/branch-context";
import type { User } from "@/lib/auth";

export type CashExpenseOrderStatus = "draft" | "posted" | "cancelled";
export type CashExpenseOrderSource = "local" | "legacy_import" | "sync" | "payroll";
export type CashExpensePaymentType = "cash" | "card";

export type CashExpenseOrderOperation = {
  id: string;
  orderId: string;
  number: string;
  type: "expense";
  shiftId: string;
  createdAt: string;
  createdBy: { login: string; name: string; role: User["role"] };
  amount: number;
  amountCents: number;
  article: string;
  expenseDate: string;
  counterpartyId?: string;
  counterpartyName?: string;
  counterpartyMetaHref?: string;
  expenseItemId?: string;
  expenseItemName?: string;
  expenseItemMetaHref?: string;
  paymentType: CashExpensePaymentType;
  status: CashExpenseOrderStatus;
  source: CashExpenseOrderSource;
  comment?: string;
  attachmentUrl?: string;
};

export type CashExpenseOrderListParams = {
  limit?: number;
  offset?: number;
  search?: string;
  status?: CashExpenseOrderStatus | "all";
  source?: CashExpenseOrderSource | "all";
  paymentType?: CashExpensePaymentType | "all";
};

export type CashExpenseOrderMutationParams = {
  shiftId: string;
  amount: number;
  expenseDate: string;
  article?: string;
  expenseItemId?: string;
  expenseItemName: string;
  expenseItemMetaHref?: string;
  counterpartyId?: string;
  counterpartyName: string;
  counterpartyMetaHref?: string;
  paymentType: CashExpensePaymentType;
  status?: CashExpenseOrderStatus;
  comment?: string;
  attachmentUrl?: string;
  organizationId?: string;
  warehouseId?: string;
  localHref?: string;
};

const DEFAULT_EXPENSE_ITEM_NAMES = [
  "Расходные материалы",
  "Аренда",
  "Зарплата",
  "Инструменты",
  "Доставка",
  "Прочее",
];

const orderInclude = {
  organization: { select: { name: true } },
  warehouse: { select: { name: true } },
  expenseItem: { select: { id: true, name: true } },
  counterparty: { select: { id: true, name: true } },
} satisfies Prisma.CashExpenseOrderInclude;

type CashExpenseOrderRow = Prisma.CashExpenseOrderGetPayload<{ include: typeof orderInclude }>;

function normalizeNullable(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizePaymentType(value?: string): CashExpensePaymentType {
  return value === "card" ? "card" : "cash";
}

function normalizeStatus(value?: string, fallback: CashExpenseOrderStatus = "posted"): CashExpenseOrderStatus {
  if (value === "draft" || value === "posted" || value === "cancelled") return value;
  return fallback;
}

function normalizeSource(value?: string): CashExpenseOrderSource {
  if (value === "payroll") return "payroll";
  if (value === "legacy_import" || value === "sync") return value;
  return "local";
}

function centsFromAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Сумма расходного ордера должна быть больше нуля");
  }
  return Math.round(amount * 100);
}

function amountFromCents(cents: number): number {
  return Math.round((cents / 100) * 100) / 100;
}

function normalizeExpenseDate(value?: string): string {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Дата расходного ордера должна быть в формате ГГГГ-ММ-ДД");
  }
  return trimmed;
}

function localReferenceId(href: string | undefined, entity: string): string | undefined {
  const prefix = `local://${entity}/`;
  if (!href?.startsWith(prefix)) return undefined;
  return decodeURIComponent(href.slice(prefix.length));
}

function legacyHref(value?: string | null): string | null {
  const href = normalizeNullable(value);
  if (!href || href.startsWith("local://")) return null;
  return href;
}

function localExpenseItemMeta(id: string) {
  return { href: `local://cash-expense-item/${id}`, type: "expenseitem", mediaType: "application/json" };
}

function orderMeta(id: string) {
  return { href: `local://cash-expense-order/${id}`, type: "cashout", mediaType: "application/json" };
}

function expenseDateToMoment(expenseDate: string): string {
  return `${expenseDate}T00:00:00.000Z`;
}

function userRole(value?: string | null): User["role"] {
  if (value === "owner" || value === "admin" || value === "master") return value;
  return "admin";
}

async function activeBranchId() {
  return (await requireBranchContext()).branchId!;
}

async function resolveExpenseItem(branchId: string, params: {
  expenseItemId?: string;
  expenseItemName?: string;
  expenseItemMetaHref?: string;
}) {
  const id =
    normalizeNullable(params.expenseItemId) ??
    localReferenceId(params.expenseItemMetaHref, "cash-expense-item");
  const name = normalizeNullable(params.expenseItemName);

  if (id) {
    const found = await prisma.cashExpenseItem.findFirst({
      where: { branchId, id },
    });
    if (found) return found;
  }

  if (!name) {
    throw new Error("Выберите статью расхода");
  }

  return prisma.cashExpenseItem.upsert({
    where: { branchId_name: { branchId, name } },
    create: {
      branchId,
      name,
      source: legacyHref(params.expenseItemMetaHref) ? "legacy_import" : "local",
    },
    update: {
      isActive: true,
    },
  });
}

async function resolveCounterparty(branchId: string, params: { counterpartyId?: string; counterpartyMetaHref?: string }) {
  const id =
    normalizeNullable(params.counterpartyId) ??
    localReferenceId(params.counterpartyMetaHref, "counterparty");
  if (!id) return null;
  return prisma.localCounterparty.findFirst({
    where: { branchId, id },
    select: { id: true, name: true },
  });
}

async function generateCashExpenseNumber(branchId: string, attempt = 0): Promise<string> {
  const ymd = toServiceDateInput(new Date()).replaceAll("-", "");
  const prefix = `РКО-${ymd}`;
  const count = await prisma.cashExpenseOrder.count({
    where: { branchId, number: { startsWith: prefix } },
  });
  return `${prefix}-${String(count + attempt + 1).padStart(4, "0")}`;
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function ensureDefaultCashExpenseItems(branchId?: string) {
  branchId ??= await activeBranchId();
  const count = await prisma.cashExpenseItem.count({ where: { branchId } });
  if (count > 0) return;

  await prisma.$transaction(
    DEFAULT_EXPENSE_ITEM_NAMES.map((name) =>
      prisma.cashExpenseItem.upsert({
        where: { branchId_name: { branchId, name } },
        create: { branchId, name, source: "local" },
        update: { isActive: true },
      })
    )
  );
}

export async function listCashExpenseItems(params: { search?: string; limit?: number } = {}) {
  const branchId = await activeBranchId();
  await ensureDefaultCashExpenseItems(branchId);

  const search = params.search?.trim();
  const limit = Math.min(1000, Math.max(1, params.limit ?? 200));

  return prisma.cashExpenseItem.findMany({
    where: {
      branchId,
      isActive: true,
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ name: "asc" }],
    take: limit,
  });
}

export async function createCashExpenseOrder(
  params: CashExpenseOrderMutationParams,
  user: User
): Promise<CashExpenseOrderRow> {
  const branchId = await activeBranchId();
  const status = normalizeStatus(params.status);
  if (status === "cancelled") {
    throw new Error("Нельзя создать уже отменённый расходный ордер");
  }

  const amountCents = centsFromAmount(params.amount);
  const expenseDate = normalizeExpenseDate(params.expenseDate);
  const expenseItem = await resolveExpenseItem(branchId, params);
  const counterparty = await resolveCounterparty(branchId, params);
  const counterpartyName = normalizeNullable(params.counterpartyName) ?? counterparty?.name;
  if (!counterpartyName) {
    throw new Error("Выберите контрагента");
  }
  const article = normalizeNullable(params.article) ?? expenseItem.name;
  const paymentType = normalizePaymentType(params.paymentType);
  const now = new Date();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const number = await generateCashExpenseNumber(branchId, attempt);
    try {
      return await prisma.cashExpenseOrder.create({
        data: {
          branchId,
          shiftId: params.shiftId,
          organizationId: normalizeNullable(params.organizationId),
          warehouseId: normalizeNullable(params.warehouseId),
          number,
          status,
          amountCents,
          currency: "RUB",
          expenseDate,
          expenseItemId: expenseItem.id,
          expenseItemName: expenseItem.name,
          counterpartyId: counterparty?.id ?? null,
          counterpartyName,
          article,
          paymentPurpose: article,
          paymentType,
          attachmentUrl: normalizeNullable(params.attachmentUrl),
          comment: normalizeNullable(params.comment),
          createdBy: user.login,
          createdByName: user.name,
          createdByRole: user.role,
          postedAt: status === "posted" ? now : null,
          postedBy: status === "posted" ? user.login : null,
          postedByName: status === "posted" ? user.name : null,
          source: "local",
        },
        include: orderInclude,
      });
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt === 4) throw error;
    }
  }

  throw new Error("Не удалось подобрать номер расходного ордера");
}

export async function getCashExpenseOrder(id: string): Promise<CashExpenseOrderRow | null> {
  const branchId = await activeBranchId();
  return prisma.cashExpenseOrder.findFirst({ where: { id, branchId }, include: orderInclude });
}

export async function updateCashExpenseOrderDraft(
  id: string,
  params: Partial<CashExpenseOrderMutationParams>,
  user: User
): Promise<CashExpenseOrderRow> {
  const current = await getCashExpenseOrder(id);
  if (!current) throw new Error("Расходный ордер не найден");
  if (current.status !== "draft") {
    throw new Error("Редактировать можно только черновик расходного ордера");
  }

  const expenseItem =
    params.expenseItemId || params.expenseItemName || params.expenseItemMetaHref
      ? await resolveExpenseItem(current.branchId, {
          expenseItemId: params.expenseItemId ?? current.expenseItemId ?? undefined,
          expenseItemName: params.expenseItemName ?? current.expenseItemName,
          expenseItemMetaHref: params.expenseItemMetaHref,
        })
      : null;
  const counterparty =
    params.counterpartyId || params.counterpartyMetaHref
      ? await resolveCounterparty(current.branchId, {
          counterpartyId: params.counterpartyId ?? current.counterpartyId ?? undefined,
          counterpartyMetaHref: params.counterpartyMetaHref,
        })
      : null;
  const counterpartyName =
    normalizeNullable(params.counterpartyName) ?? counterparty?.name ?? current.counterpartyName;
  const expenseItemName = expenseItem?.name ?? current.expenseItemName;
  const article =
    params.article === undefined
      ? current.article
      : normalizeNullable(params.article) ?? expenseItemName;

  return prisma.cashExpenseOrder.update({
    where: { id },
    data: {
      amountCents: params.amount == null ? undefined : centsFromAmount(params.amount),
      expenseDate: params.expenseDate == null ? undefined : normalizeExpenseDate(params.expenseDate),
      expenseItemId: expenseItem?.id,
      expenseItemName: expenseItem ? expenseItem.name : undefined,
      counterpartyId: counterparty?.id ?? (params.counterpartyId === "" ? null : undefined),
      counterpartyName,
      article,
      paymentPurpose: article,
      paymentType: params.paymentType == null ? undefined : normalizePaymentType(params.paymentType),
      attachmentUrl: params.attachmentUrl === undefined ? undefined : normalizeNullable(params.attachmentUrl),
      comment: params.comment === undefined ? undefined : normalizeNullable(params.comment),
      createdBy: current.createdBy || user.login,
    },
    include: orderInclude,
  });
}

export async function postCashExpenseOrder(id: string, user: User): Promise<CashExpenseOrderRow> {
  const current = await getCashExpenseOrder(id);
  if (!current) throw new Error("Расходный ордер не найден");
  if (current.status === "cancelled") {
    throw new Error("Отменённый расходный ордер нельзя провести");
  }
  if (current.status === "posted") return current;

  return prisma.cashExpenseOrder.update({
    where: { id },
    data: {
      status: "posted",
      postedAt: new Date(),
      postedBy: user.login,
      postedByName: user.name,
    },
    include: orderInclude,
  });
}

export async function cancelCashExpenseOrder(
  id: string,
  user: User,
  reason?: string
): Promise<CashExpenseOrderRow> {
  const current = await getCashExpenseOrder(id);
  if (!current) throw new Error("Расходный ордер не найден");
  if (current.status === "cancelled") return current;

  return prisma.cashExpenseOrder.update({
    where: { id },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy: user.login,
      cancelledByName: user.name,
      cancelReason: normalizeNullable(reason),
    },
    include: orderInclude,
  });
}

export async function listCashExpenseOrders(params: CashExpenseOrderListParams = {}) {
  const branchId = await activeBranchId();
  const limit = Math.min(100, Math.max(1, params.limit ?? 50));
  const offset = Math.max(0, params.offset ?? 0);
  const search = params.search?.trim();
  const status = params.status && params.status !== "all" ? normalizeStatus(params.status) : null;
  const source = params.source && params.source !== "all" ? normalizeSource(params.source) : null;
  const paymentType =
    params.paymentType && params.paymentType !== "all" ? normalizePaymentType(params.paymentType) : null;

  const where: Prisma.CashExpenseOrderWhereInput = {
    branchId,
    ...(status ? { status } : {}),
    ...(source ? { source } : {}),
    ...(paymentType ? { paymentType } : {}),
    ...(search
      ? {
          OR: [
            { number: { contains: search, mode: "insensitive" } },
            { counterpartyName: { contains: search, mode: "insensitive" } },
            { expenseItemName: { contains: search, mode: "insensitive" } },
            { article: { contains: search, mode: "insensitive" } },
            { paymentPurpose: { contains: search, mode: "insensitive" } },
            { comment: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.cashExpenseOrder.count({ where }),
    prisma.cashExpenseOrder.findMany({
      where,
      include: orderInclude,
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      take: limit,
      skip: offset,
    }),
  ]);

  return { total, rows };
}

export async function listCashExpenseOrderOperationsForShift(
  shiftId: string
): Promise<CashExpenseOrderOperation[]> {
  const rows = await prisma.cashExpenseOrder.findMany({
    where: { branchId: await activeBranchId(), shiftId },
    include: orderInclude,
    orderBy: [{ createdAt: "asc" }],
  });
  return rows.map(cashExpenseOrderToOperation);
}

export function cashExpenseOrderToOperation(row: CashExpenseOrderRow): CashExpenseOrderOperation {
  const status = normalizeStatus(row.status, "draft");
  const source = normalizeSource(row.source);
  const expenseItemHref = localExpenseItemMeta(row.expenseItemId ?? row.id).href;
  const counterpartyHref =
    row.counterpartyId ? `local://counterparty/${row.counterpartyId}` : undefined;

  return {
    id: `expense_${row.id}`,
    orderId: row.id,
    number: row.number,
    type: "expense",
    shiftId: row.shiftId,
    createdAt: row.createdAt.toISOString(),
    createdBy: {
      login: row.createdBy,
      name: row.createdByName || row.createdBy,
      role: userRole(row.createdByRole),
    },
    amount: amountFromCents(row.amountCents),
    amountCents: row.amountCents,
    article: row.article || row.paymentPurpose || row.expenseItemName,
    expenseDate: row.expenseDate,
    counterpartyId: row.counterpartyId ?? undefined,
    counterpartyName: row.counterpartyName || row.counterparty?.name || undefined,
    counterpartyMetaHref: counterpartyHref,
    expenseItemId: row.expenseItemId ?? undefined,
    expenseItemName: row.expenseItemName || row.expenseItem?.name || undefined,
    expenseItemMetaHref: expenseItemHref,
    paymentType: normalizePaymentType(row.paymentType),
    status,
    source,
    comment: row.comment ?? undefined,
    attachmentUrl: row.attachmentUrl ?? undefined,
  };
}

export function cashExpenseOrderToCashout(row: CashExpenseOrderRow) {
  const status = normalizeStatus(row.status, "draft");
  return {
    id: row.id,
    name: row.number,
    moment: expenseDateToMoment(row.expenseDate),
    sum: row.amountCents,
    amountCents: row.amountCents,
    applicable: status === "posted",
    status,
    source: normalizeSource(row.source),
    paymentType: normalizePaymentType(row.paymentType),
    shiftId: row.shiftId,
    expenseItemId: row.expenseItemId ?? "",
    counterpartyId: row.counterpartyId ?? "",
    paymentPurpose: row.paymentPurpose ?? row.article ?? "",
    description: row.comment ?? "",
    agentName: row.counterpartyName || row.counterparty?.name || "",
    expenseItemName: row.expenseItemName || row.expenseItem?.name || "",
    organizationName: row.organization?.name ?? "",
    meta: orderMeta(row.id),
  };
}
