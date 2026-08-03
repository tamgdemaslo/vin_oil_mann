import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { canonicalizeLogin, getUsersFromEnv, type User } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireBranchContext } from "@/lib/branch-context";
import { requireSingleBranchSqlContext } from "@/lib/branch-sql-context";

export const DEFAULT_PAYROLL_SETTLEMENT_ORG_ID = "default";

export type PayrollAdjustmentType =
  | "BONUS"
  | "PENALTY"
  | "DEDUCTION"
  | "EXTRA_PAY"
  | "COMPENSATION"
  | "ADVANCE_OFFSET"
  | "REVERSAL";

export type PayrollPaymentMethod = "CASH" | "BANK_TRANSFER" | "OTHER";
export type PayrollPaymentOperationType = "SALARY" | "ADVANCE" | "COMPENSATION";

export type PayrollAdjustmentRecord = {
  id: string;
  organizationId: string;
  employeeId: string;
  payrollPeriodId: string | null;
  periodFrom: string;
  periodTo: string;
  operationDate: string;
  type: PayrollAdjustmentType;
  amountCents: number;
  reasonCode: string | null;
  comment: string | null;
  sourceType: string | null;
  sourceId: string | null;
  status: string;
  createdById: string;
  reversedById: string | null;
  reversalOfId: string | null;
  createdAt: string;
  updatedAt: string;
  reversedAt: string | null;
};

export type PayrollPaymentRecord = {
  id: string;
  organizationId: string;
  employeeId: string;
  payrollPeriodId: string | null;
  periodFrom: string;
  periodTo: string;
  operationDate: string;
  operationType: PayrollPaymentOperationType;
  amountCents: number;
  paymentMethod: PayrollPaymentMethod;
  cashOrderId: string | null;
  cashOrderNumber: string | null;
  cashOrderStatus: string | null;
  bankOperationId: string | null;
  status: string;
  comment: string | null;
  createdById: string;
  reversedById: string | null;
  reversalOfId: string | null;
  createdAt: string;
  updatedAt: string;
  reversedAt: string | null;
};

type RawAdjustmentRow = Omit<PayrollAdjustmentRecord, "type" | "createdAt" | "updatedAt" | "reversedAt"> & {
  type: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  reversedAt: Date | string | null;
};

type RawPaymentRow = Omit<
  PayrollPaymentRecord,
  "operationType" | "paymentMethod" | "createdAt" | "updatedAt" | "reversedAt"
> & {
  operationType: string;
  paymentMethod: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  reversedAt: Date | string | null;
};

function missingSettlementTables(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("undefined_table") ||
    message.includes("undefined_column") ||
    message.includes("p2021")
  );
}

function toIso(value: Date | string | null) {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizePayrollLogin(login: string) {
  return canonicalizeLogin(login).trim().toLowerCase();
}

function assertDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} должна быть в формате YYYY-MM-DD`);
  }
}

function normalizeAdjustmentType(value: string): PayrollAdjustmentType {
  const normalized = value.trim().toUpperCase();
  if (normalized === "BONUS" || normalized === "БОНУС" || normalized === "BONUS_MANUAL") return "BONUS";
  if (normalized === "PENALTY" || normalized === "ШТРАФ") return "PENALTY";
  if (
    normalized === "DEDUCTION" ||
    normalized === "УДЕРЖАНИЕ" ||
    normalized === "PENALTY_MANUAL" ||
    normalized === "PENALTY_LATE" ||
    normalized === "PENALTY_UNCLOSED"
  ) {
    return "DEDUCTION";
  }
  if (normalized === "EXTRA_PAY" || normalized === "DOPLATA" || normalized === "ДОПЛАТА") return "EXTRA_PAY";
  if (normalized === "COMPENSATION" || normalized === "КОМПЕНСАЦИЯ") return "COMPENSATION";
  if (normalized === "ADVANCE_OFFSET" || normalized === "ADVANCE") return "ADVANCE_OFFSET";
  if (normalized === "REVERSAL") return "REVERSAL";
  return "BONUS";
}

function normalizePaymentMethod(value: string): PayrollPaymentMethod {
  const normalized = value.trim().toUpperCase();
  if (normalized === "CASH" || normalized === "НАЛИЧНЫЕ") return "CASH";
  if (normalized === "BANK_TRANSFER" || normalized === "TRANSFER" || normalized === "ПЕРЕВОД") return "BANK_TRANSFER";
  return "OTHER";
}

function normalizePaymentOperationType(value: string): PayrollPaymentOperationType {
  const normalized = value.trim().toUpperCase();
  if (normalized === "ADVANCE" || normalized === "АВАНС") return "ADVANCE";
  if (normalized === "COMPENSATION" || normalized === "КОМПЕНСАЦИЯ") return "COMPENSATION";
  return "SALARY";
}

function normalizeAdjustmentAmount(type: PayrollAdjustmentType, amountCents: number) {
  const absolute = Math.abs(Math.round(amountCents));
  if (!Number.isFinite(absolute) || absolute <= 0) {
    throw new Error("Сумма операции должна быть больше нуля");
  }
  if (type === "PENALTY" || type === "DEDUCTION" || type === "ADVANCE_OFFSET") return -absolute;
  return absolute;
}

function mapAdjustment(row: RawAdjustmentRow): PayrollAdjustmentRecord {
  return {
    ...row,
    type: normalizeAdjustmentType(row.type),
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
    reversedAt: toIso(row.reversedAt),
  };
}

function mapPayment(row: RawPaymentRow): PayrollPaymentRecord {
  return {
    ...row,
    operationType: normalizePaymentOperationType(row.operationType),
    paymentMethod: normalizePaymentMethod(row.paymentMethod),
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
    reversedAt: toIso(row.reversedAt),
  };
}

async function getEmployeeName(login: string) {
  const normalized = normalizePayrollLogin(login);
  const users = await getUsersFromEnv();
  return users.find((user) => normalizePayrollLogin(user.login) === normalized)?.name ?? login;
}

function operationTitle(operationType: PayrollPaymentOperationType) {
  if (operationType === "ADVANCE") return "Аванс сотруднику";
  if (operationType === "COMPENSATION") return "Компенсация сотруднику";
  return "Зарплата";
}

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function generatePayrollCashExpenseNumber(tx: Prisma.TransactionClient, branchId: string, operationDate: string, attempt = 0) {
  const prefix = `РКО-${operationDate.replaceAll("-", "")}`;
  const count = await tx.cashExpenseOrder.count({ where: { branchId, number: { startsWith: prefix } } });
  return `${prefix}-${String(count + attempt + 1).padStart(4, "0")}`;
}

async function findAdjustmentById(id: string) {
  const { branchId } = requireSingleBranchSqlContext();
  const rows = await prisma.$queryRaw<RawAdjustmentRow[]>`
    SELECT
      id,
      organization_id AS "organizationId",
      employee_id AS "employeeId",
      payroll_period_id AS "payrollPeriodId",
      period_from AS "periodFrom",
      period_to AS "periodTo",
      operation_date AS "operationDate",
      type,
      amount_cents AS "amountCents",
      reason_code AS "reasonCode",
      comment,
      source_type AS "sourceType",
      source_id AS "sourceId",
      status,
      created_by_id AS "createdById",
      reversed_by_id AS "reversedById",
      reversal_of_id AS "reversalOfId",
      created_at AS "createdAt",
      updated_at AS "updatedAt",
      reversed_at AS "reversedAt"
    FROM payroll_adjustments
    WHERE id = ${id}
      AND branch_id = ${branchId}
    LIMIT 1
  `;
  return rows[0] ? mapAdjustment(rows[0]) : null;
}

async function findPaymentById(id: string) {
  const { branchId } = requireSingleBranchSqlContext();
  const rows = await prisma.$queryRaw<RawPaymentRow[]>`
    SELECT
      p.id,
      p.organization_id AS "organizationId",
      p.employee_id AS "employeeId",
      p.payroll_period_id AS "payrollPeriodId",
      p.period_from AS "periodFrom",
      p.period_to AS "periodTo",
      p.operation_date AS "operationDate",
      p.operation_type AS "operationType",
      p.amount_cents AS "amountCents",
      p.payment_method AS "paymentMethod",
      p.cash_order_id AS "cashOrderId",
      c.number AS "cashOrderNumber",
      c.status AS "cashOrderStatus",
      p.bank_operation_id AS "bankOperationId",
      p.status,
      p.comment,
      p.created_by_id AS "createdById",
      p.reversed_by_id AS "reversedById",
      p.reversal_of_id AS "reversalOfId",
      p.created_at AS "createdAt",
      p.updated_at AS "updatedAt",
      p.reversed_at AS "reversedAt"
    FROM payroll_payments p
    LEFT JOIN cash_expense_orders c ON c.id = p.cash_order_id
    WHERE p.id = ${id}
      AND p.branch_id = ${branchId}
    LIMIT 1
  `;
  return rows[0] ? mapPayment(rows[0]) : null;
}

export async function listPayrollAdjustments(params: {
  organizationId?: string;
  dateFrom?: string;
  dateTo?: string;
  employeeLogin?: string | null;
  includeInactive?: boolean;
  limit?: number;
} = {}): Promise<PayrollAdjustmentRecord[]> {
  const { branchId } = requireSingleBranchSqlContext();
  const organizationId = params.organizationId ?? DEFAULT_PAYROLL_SETTLEMENT_ORG_ID;
  const employeeLogin = params.employeeLogin ? normalizePayrollLogin(params.employeeLogin) : null;
  const dateFrom = params.dateFrom ?? null;
  const dateTo = params.dateTo ?? null;
  const limit = Math.min(500, Math.max(1, params.limit ?? 200));

  try {
    const rows = await prisma.$queryRaw<RawAdjustmentRow[]>`
      SELECT
        id,
        organization_id AS "organizationId",
        employee_id AS "employeeId",
        payroll_period_id AS "payrollPeriodId",
        period_from AS "periodFrom",
        period_to AS "periodTo",
        operation_date AS "operationDate",
        type,
        amount_cents AS "amountCents",
        reason_code AS "reasonCode",
        comment,
        source_type AS "sourceType",
        source_id AS "sourceId",
        status,
        created_by_id AS "createdById",
        reversed_by_id AS "reversedById",
        reversal_of_id AS "reversalOfId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        reversed_at AS "reversedAt"
      FROM payroll_adjustments
      WHERE organization_id = ${organizationId}
        AND branch_id = ${branchId}
        AND (${dateFrom}::text IS NULL OR period_to >= ${dateFrom})
        AND (${dateTo}::text IS NULL OR period_from <= ${dateTo})
        AND (${employeeLogin}::text IS NULL OR employee_id = ${employeeLogin})
        AND (${params.includeInactive ?? false} = true OR status = 'ACTIVE')
      ORDER BY operation_date DESC, created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mapAdjustment);
  } catch (error) {
    if (missingSettlementTables(error)) return [];
    throw error;
  }
}

export async function listPayrollPayments(params: {
  organizationId?: string;
  dateFrom?: string;
  dateTo?: string;
  employeeLogin?: string | null;
  includeInactive?: boolean;
  limit?: number;
} = {}): Promise<PayrollPaymentRecord[]> {
  const { branchId } = requireSingleBranchSqlContext();
  const organizationId = params.organizationId ?? DEFAULT_PAYROLL_SETTLEMENT_ORG_ID;
  const employeeLogin = params.employeeLogin ? normalizePayrollLogin(params.employeeLogin) : null;
  const dateFrom = params.dateFrom ?? null;
  const dateTo = params.dateTo ?? null;
  const limit = Math.min(500, Math.max(1, params.limit ?? 200));

  try {
    const rows = await prisma.$queryRaw<RawPaymentRow[]>`
      SELECT
        p.id,
        p.organization_id AS "organizationId",
        p.employee_id AS "employeeId",
        p.payroll_period_id AS "payrollPeriodId",
        p.period_from AS "periodFrom",
        p.period_to AS "periodTo",
        p.operation_date AS "operationDate",
        p.operation_type AS "operationType",
        p.amount_cents AS "amountCents",
        p.payment_method AS "paymentMethod",
        p.cash_order_id AS "cashOrderId",
        c.number AS "cashOrderNumber",
        c.status AS "cashOrderStatus",
        p.bank_operation_id AS "bankOperationId",
        p.status,
        p.comment,
        p.created_by_id AS "createdById",
        p.reversed_by_id AS "reversedById",
        p.reversal_of_id AS "reversalOfId",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt",
        p.reversed_at AS "reversedAt"
      FROM payroll_payments p
      LEFT JOIN cash_expense_orders c ON c.id = p.cash_order_id
      WHERE p.organization_id = ${organizationId}
        AND p.branch_id = ${branchId}
        AND (${dateFrom}::text IS NULL OR p.period_to >= ${dateFrom})
        AND (${dateTo}::text IS NULL OR p.period_from <= ${dateTo})
        AND (${employeeLogin}::text IS NULL OR p.employee_id = ${employeeLogin})
        AND (${params.includeInactive ?? false} = true OR p.status = 'ACTIVE')
      ORDER BY p.operation_date DESC, p.created_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mapPayment);
  } catch (error) {
    if (missingSettlementTables(error)) return [];
    throw error;
  }
}

export async function createPayrollAdjustment(params: {
  employeeLogin: string;
  periodFrom: string;
  periodTo: string;
  operationDate: string;
  type: string;
  amountCents: number;
  reasonCode?: string | null;
  comment?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  payrollPeriodId?: string | null;
  organizationId?: string;
  createdByLogin: string;
  createdByName?: string | null;
  createdByRole?: User["role"] | null;
}) {
  const { branchId } = requireSingleBranchSqlContext();
  assertDate(params.periodFrom, "Дата начала периода");
  assertDate(params.periodTo, "Дата конца периода");
  assertDate(params.operationDate, "Дата операции");

  const id = randomUUID();
  const type = normalizeAdjustmentType(params.type);
  const employeeId = normalizePayrollLogin(params.employeeLogin);
  const amountCents = normalizeAdjustmentAmount(type, params.amountCents);
  const createdById = normalizePayrollLogin(params.createdByLogin);
  const organizationId = params.organizationId ?? DEFAULT_PAYROLL_SETTLEMENT_ORG_ID;
  const reasonCode = params.reasonCode?.trim() || null;
  const comment = params.comment?.trim() || null;

  await prisma.$executeRaw`
    INSERT INTO payroll_adjustments (
      id,
      branch_id,
      organization_id,
      employee_id,
      payroll_period_id,
      period_from,
      period_to,
      operation_date,
      type,
      amount_cents,
      reason_code,
      comment,
      source_type,
      source_id,
      status,
      created_by_id
    )
    VALUES (
      ${id},
      ${branchId},
      ${organizationId},
      ${employeeId},
      ${params.payrollPeriodId ?? null},
      ${params.periodFrom},
      ${params.periodTo},
      ${params.operationDate},
      ${type},
      ${amountCents},
      ${reasonCode},
      ${comment},
      ${params.sourceType ?? "PAYROLL_MANUAL"},
      ${params.sourceId ?? null},
      'ACTIVE',
      ${createdById}
    )
  `;

  const { logChange } = await import("@/lib/change-log");
  await logChange({
    entityType: "payroll_adjustment",
    entityId: id,
    action: "create",
    newValue: { employeeId, periodFrom: params.periodFrom, periodTo: params.periodTo, type, amountCents, reasonCode, comment },
    performedByLogin: createdById,
  });

  return findAdjustmentById(id);
}

export async function reversePayrollAdjustment(params: {
  id: string;
  reversedByLogin: string;
  comment?: string | null;
}) {
  const { branchId } = requireSingleBranchSqlContext();
  const existing = await findAdjustmentById(params.id);
  if (!existing) throw new Error("Корректировка не найдена");
  if (existing.status !== "ACTIVE" || existing.reversedAt) throw new Error("Корректировка уже отменена или закрыта");

  const reversedById = normalizePayrollLogin(params.reversedByLogin);
  const reversalId = randomUUID();
  const comment = params.comment?.trim() || `Отмена корректировки ${existing.id}`;

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE payroll_adjustments
      SET reversed_by_id = ${reversedById},
          reversed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${existing.id}
        AND branch_id = ${branchId}
    `;
    await tx.$executeRaw`
      INSERT INTO payroll_adjustments (
        id,
        branch_id,
        organization_id,
        employee_id,
        payroll_period_id,
        period_from,
        period_to,
        operation_date,
        type,
        amount_cents,
        reason_code,
        comment,
        source_type,
        source_id,
        status,
        created_by_id,
        reversal_of_id
      )
      VALUES (
        ${reversalId},
        ${branchId},
        ${existing.organizationId},
        ${existing.employeeId},
        ${existing.payrollPeriodId},
        ${existing.periodFrom},
        ${existing.periodTo},
        ${existing.operationDate},
        'REVERSAL',
        ${-existing.amountCents},
        'REVERSAL',
        ${comment},
        'PAYROLL_ADJUSTMENT_REVERSAL',
        ${existing.id},
        'ACTIVE',
        ${reversedById},
        ${existing.id}
      )
    `;
  });

  const { logChange } = await import("@/lib/change-log");
  await logChange({
    entityType: "payroll_adjustment",
    entityId: existing.id,
    action: "update",
    oldValue: { status: existing.status, amountCents: existing.amountCents },
    newValue: { reversedAt: new Date().toISOString(), reversalId },
    performedByLogin: reversedById,
  });

  return findAdjustmentById(reversalId);
}

export async function createPayrollPayment(params: {
  employeeLogin: string;
  periodFrom: string;
  periodTo: string;
  operationDate: string;
  operationType?: string;
  amountCents: number;
  paymentMethod: string;
  comment?: string | null;
  payrollPeriodId?: string | null;
  organizationId?: string;
  createdByLogin: string;
  createdByName?: string | null;
  createdByRole?: User["role"] | null;
}) {
  const branch = await requireBranchContext({ allowAll: false, requireActive: true });
  if (!branch.branchId) throw new Error("Активный филиал не выбран");
  const branchId = branch.branchId;
  assertDate(params.periodFrom, "Дата начала периода");
  assertDate(params.periodTo, "Дата конца периода");
  assertDate(params.operationDate, "Дата выплаты");

  const amountCents = Math.abs(Math.round(params.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Сумма выплаты должна быть больше нуля");
  }

  const id = randomUUID();
  const employeeId = normalizePayrollLogin(params.employeeLogin);
  const createdById = normalizePayrollLogin(params.createdByLogin);
  const organizationId = params.organizationId ?? DEFAULT_PAYROLL_SETTLEMENT_ORG_ID;
  const paymentMethod = normalizePaymentMethod(params.paymentMethod);
  const operationType = normalizePaymentOperationType(params.operationType ?? "SALARY");
  const comment = params.comment?.trim() || null;
  const employeeName = await getEmployeeName(employeeId);
  let cashOrderId: string | null = null;

  await prisma.$transaction(async (tx) => {
    if (paymentMethod === "CASH") {
      const shift = await tx.cashShift.findFirst({
        where: { branchId, status: "open" },
        orderBy: { openedAt: "desc" },
        select: { id: true },
      });
      if (!shift) {
        throw new Error("Открытая кассовая смена не найдена. Откройте кассу или выберите другой способ выплаты.");
      }

      const title = operationTitle(operationType);
      const expenseItem = await tx.cashExpenseItem.upsert({
        where: { branchId_name: { branchId, name: title } },
        create: { branchId, name: title, source: "payroll" },
        update: { isActive: true },
      });
      const paymentPurpose = `${title}: ${employeeName}, период ${params.periodFrom} - ${params.periodTo}`;
      const now = new Date();

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const number = await generatePayrollCashExpenseNumber(tx, branchId, params.operationDate, attempt);
        try {
          const order = await tx.cashExpenseOrder.create({
            data: {
              branchId,
              shiftId: shift.id,
              organizationId: organizationId === DEFAULT_PAYROLL_SETTLEMENT_ORG_ID ? null : organizationId,
              number,
              status: "posted",
              amountCents,
              currency: "RUB",
              expenseDate: params.operationDate,
              expenseItemId: expenseItem.id,
              expenseItemName: expenseItem.name,
              counterpartyName: employeeName,
              article: title,
              paymentPurpose,
              paymentType: "cash",
              comment: comment ?? "Создано из раздела Зарплата",
              createdBy: createdById,
              createdByName: params.createdByName?.trim() || createdById,
              createdByRole: params.createdByRole ?? "owner",
              postedAt: now,
              postedBy: createdById,
              postedByName: params.createdByName?.trim() || createdById,
              source: "payroll",
            },
          });
          cashOrderId = order.id;
          break;
        } catch (error) {
          if (!isUniqueConstraintError(error) || attempt === 4) throw error;
        }
      }

      if (!cashOrderId) throw new Error("Не удалось создать расходный ордер выплаты");
    }

    await tx.$executeRaw`
      INSERT INTO payroll_payments (
        id,
        branch_id,
        organization_id,
        employee_id,
        payroll_period_id,
        period_from,
        period_to,
        operation_date,
        operation_type,
        amount_cents,
        payment_method,
        cash_order_id,
        status,
        comment,
        created_by_id
      )
      VALUES (
        ${id},
        ${branchId},
        ${organizationId},
        ${employeeId},
        ${params.payrollPeriodId ?? null},
        ${params.periodFrom},
        ${params.periodTo},
        ${params.operationDate},
        ${operationType},
        ${amountCents},
        ${paymentMethod},
        ${cashOrderId},
        'ACTIVE',
        ${comment},
        ${createdById}
      )
    `;

    if (cashOrderId) {
      await tx.$executeRaw`
        UPDATE cash_expense_orders
        SET source_type = 'PAYROLL_PAYMENT',
            source_id = ${id},
            employee_id = ${employeeId},
            payroll_period_id = ${params.payrollPeriodId ?? null},
            payroll_period_from = ${params.periodFrom},
            payroll_period_to = ${params.periodTo}
        WHERE id = ${cashOrderId}
          AND branch_id = ${branchId}
      `;
    }
  });

  const { logChange } = await import("@/lib/change-log");
  await logChange({
    entityType: "payroll_payment",
    entityId: id,
    action: "create",
    newValue: { employeeId, periodFrom: params.periodFrom, periodTo: params.periodTo, operationType, amountCents, paymentMethod, cashOrderId },
    performedByLogin: createdById,
  });

  return findPaymentById(id);
}

export async function reversePayrollPayment(params: {
  id: string;
  reversedByLogin: string;
  comment?: string | null;
}) {
  const { branchId } = requireSingleBranchSqlContext();
  const existing = await findPaymentById(params.id);
  if (!existing) throw new Error("Выплата не найдена");
  if (existing.status !== "ACTIVE") throw new Error("Выплата уже отменена или закрыта");

  const reversedById = normalizePayrollLogin(params.reversedByLogin);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      UPDATE payroll_payments
      SET status = 'REVERSED',
          reversed_by_id = ${reversedById},
          reversed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          comment = COALESCE(${params.comment?.trim() || null}, comment)
      WHERE id = ${existing.id}
        AND branch_id = ${branchId}
    `;

    if (existing.cashOrderId) {
      await tx.cashExpenseOrder.updateMany({
        where: { id: existing.cashOrderId, branchId },
        data: {
          status: "cancelled",
          cancelledAt: new Date(),
          cancelledBy: reversedById,
          cancelledByName: reversedById,
          cancelReason: params.comment?.trim() || "Выплата отменена из раздела Зарплата",
        },
      });
    }
  });

  const { logChange } = await import("@/lib/change-log");
  await logChange({
    entityType: "payroll_payment",
    entityId: existing.id,
    action: "update",
    oldValue: { status: existing.status, amountCents: existing.amountCents, cashOrderId: existing.cashOrderId },
    newValue: { status: "REVERSED" },
    performedByLogin: reversedById,
  });

  return findPaymentById(existing.id);
}

export function payrollPaymentLabel(payment: Pick<PayrollPaymentRecord, "operationType" | "paymentMethod">) {
  const title = operationTitle(payment.operationType);
  if (payment.paymentMethod === "CASH") return `${title}, наличные`;
  if (payment.paymentMethod === "BANK_TRANSFER") return `${title}, перевод`;
  return `${title}, другое`;
}

export type PayrollSettlementUser = User;
