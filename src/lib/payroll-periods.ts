import { randomUUID } from "crypto";
import { canonicalizeLogin, getUsersFromEnv } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getCachedPayrollSummary, type PayrollSummary } from "@/lib/payroll";
import { listPayrollAdjustments } from "@/lib/payroll-settlements";
import { requireSingleBranchSqlContext } from "@/lib/branch-sql-context";

export const DEFAULT_PAYROLL_ORG_ID = "default";

export type PayrollPeriodRecord = {
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

export type PayrollPeriodEmployeeRecord = {
  id: string;
  periodId: string;
  employeeLogin: string;
  employeeName: string;
  employeeRole: string;
  shiftTotalCents: number;
  pieceworkCents: number;
  adjustmentsCents: number;
  paidOutCents: number;
  remainingCents: number;
  totalCents: number;
  shiftsCount: number;
  status: string;
  createdAt: string;
};

type PayrollAccrualLineInput = {
  id: string;
  periodId: string;
  employeeLogin: string;
  lineType: string;
  sourceType: string;
  sourceId: string | null;
  date: string | null;
  title: string;
  quantity: number | null;
  amountCents: number;
  status: string;
  snapshot: unknown;
};

function missingTableFallback(error: unknown) {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("does not exist") || message.includes("p2021") || message.includes("undefined_table");
}

function toIso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? value : new Date().toISOString();
}

function normalizeLogin(value: string) {
  return canonicalizeLogin(value).trim().toLowerCase();
}

function mapPeriod(row: {
  id: string;
  organizationId: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  closedByLogin: string;
  closedAt: Date | string;
  totalAccruedCents: number;
  totalPaidCents: number;
  totalRemainingCents: number;
  employeesCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}): PayrollPeriodRecord {
  return {
    ...row,
    closedAt: toIso(row.closedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function mapEmployee(row: {
  id: string;
  periodId: string;
  employeeLogin: string;
  employeeName: string;
  employeeRole: string;
  shiftTotalCents: number;
  pieceworkCents: number;
  adjustmentsCents: number;
  paidOutCents: number;
  remainingCents: number;
  totalCents: number;
  shiftsCount: number;
  status: string;
  createdAt: Date | string;
}): PayrollPeriodEmployeeRecord {
  return {
    ...row,
    createdAt: toIso(row.createdAt),
  };
}

export function payrollPeriodKey(dateFrom: string, dateTo: string) {
  return `${dateFrom}:${dateTo}`;
}

async function findPayrollPeriodByRange(params: {
  dateFrom: string;
  dateTo: string;
  organizationId?: string;
}) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      organizationId: string;
      dateFrom: string;
      dateTo: string;
      status: string;
      closedByLogin: string;
      closedAt: Date;
      totalAccruedCents: number;
      totalPaidCents: number;
      totalRemainingCents: number;
      employeesCount: number;
      createdAt: Date;
      updatedAt: Date;
    }>
  >`
    SELECT
      id,
      organization_id AS "organizationId",
      date_from AS "dateFrom",
      date_to AS "dateTo",
      status,
      closed_by_login AS "closedByLogin",
      closed_at AS "closedAt",
      total_accrued_cents AS "totalAccruedCents",
      total_paid_cents AS "totalPaidCents",
      total_remaining_cents AS "totalRemainingCents",
      employees_count AS "employeesCount",
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM payroll_periods
    WHERE organization_id = ${params.organizationId ?? DEFAULT_PAYROLL_ORG_ID}
      AND date_from = ${params.dateFrom}
      AND date_to = ${params.dateTo}
    LIMIT 1
  `;
  return rows[0] ? mapPeriod(rows[0]) : null;
}

export async function getPayrollPeriodByRange(params: {
  dateFrom: string;
  dateTo: string;
  organizationId?: string;
}) {
  try {
    return await findPayrollPeriodByRange(params);
  } catch (error) {
    if (missingTableFallback(error)) return null;
    throw error;
  }
}

export async function listPayrollPeriods(params: {
  employeeLogin?: string;
  limit?: number;
  organizationId?: string;
} = {}) {
  try {
    const employeeLogin = params.employeeLogin ? normalizeLogin(params.employeeLogin) : null;
    const limit = Math.max(1, Math.min(100, params.limit ?? 50));
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        organizationId: string;
        dateFrom: string;
        dateTo: string;
        status: string;
        closedByLogin: string;
        closedAt: Date;
        totalAccruedCents: number;
        totalPaidCents: number;
        totalRemainingCents: number;
        employeesCount: number;
        createdAt: Date;
        updatedAt: Date;
      }>
    >`
      SELECT DISTINCT
        p.id,
        p.organization_id AS "organizationId",
        p.date_from AS "dateFrom",
        p.date_to AS "dateTo",
        p.status,
        p.closed_by_login AS "closedByLogin",
        p.closed_at AS "closedAt",
        p.total_accrued_cents AS "totalAccruedCents",
        p.total_paid_cents AS "totalPaidCents",
        p.total_remaining_cents AS "totalRemainingCents",
        p.employees_count AS "employeesCount",
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt"
      FROM payroll_periods p
      LEFT JOIN payroll_period_employees e ON e.period_id = p.id
      WHERE p.organization_id = ${params.organizationId ?? DEFAULT_PAYROLL_ORG_ID}
        AND (${employeeLogin} IS NULL OR lower(e.employee_login) = ${employeeLogin})
      ORDER BY p.closed_at DESC
      LIMIT ${limit}
    `;
    return rows.map(mapPeriod);
  } catch (error) {
    if (missingTableFallback(error)) return [];
    throw error;
  }
}

export async function getPayrollPeriodEmployeeByRange(params: {
  dateFrom: string;
  dateTo: string;
  employeeLogin: string;
  organizationId?: string;
}) {
  try {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        periodId: string;
        employeeLogin: string;
        employeeName: string;
        employeeRole: string;
        shiftTotalCents: number;
        pieceworkCents: number;
        adjustmentsCents: number;
        paidOutCents: number;
        remainingCents: number;
        totalCents: number;
        shiftsCount: number;
        status: string;
        createdAt: Date;
      }>
    >`
      SELECT
        e.id,
        e.period_id AS "periodId",
        e.employee_login AS "employeeLogin",
        e.employee_name AS "employeeName",
        e.employee_role AS "employeeRole",
        e.shift_total_cents AS "shiftTotalCents",
        e.piecework_cents AS "pieceworkCents",
        e.adjustments_cents AS "adjustmentsCents",
        e.paid_out_cents AS "paidOutCents",
        e.remaining_cents AS "remainingCents",
        e.total_cents AS "totalCents",
        e.shifts_count AS "shiftsCount",
        e.status,
        e.created_at AS "createdAt"
      FROM payroll_period_employees e
      JOIN payroll_periods p ON p.id = e.period_id
      WHERE p.organization_id = ${params.organizationId ?? DEFAULT_PAYROLL_ORG_ID}
        AND p.date_from = ${params.dateFrom}
        AND p.date_to = ${params.dateTo}
        AND lower(e.employee_login) = ${normalizeLogin(params.employeeLogin)}
      LIMIT 1
    `;
    return rows[0] ? mapEmployee(rows[0]) : null;
  } catch (error) {
    if (missingTableFallback(error)) return null;
    throw error;
  }
}

function buildAccrualLines(params: {
  periodId: string;
  summary: PayrollSummary;
  adjustments: {
    id: string;
    userLogin: string;
    date: string;
    amountCents: number;
    type: string;
    comment: string | null;
  }[];
  canonicalLoginByLower: Map<string, string>;
}): PayrollAccrualLineInput[] {
  const { canonicalLoginByLower, periodId, summary } = params;
  const lines: PayrollAccrualLineInput[] = [];

  for (const [login, row] of Object.entries(summary.byLogin)) {
    if (row.shiftTotalCents > 0) {
      lines.push({
        id: randomUUID(),
        periodId,
        employeeLogin: login,
        lineType: "fixed_shift",
        sourceType: "scheduled_working_day",
        sourceId: null,
        date: null,
        title: "Фиксированная часть за рабочие дни",
        quantity: row.shiftsCount,
        amountCents: row.shiftTotalCents,
        status: "CONFIRMED",
        snapshot: { shiftsCount: row.shiftsCount },
      });
    }
  }

  for (const vehicle of summary.vehicleHistory) {
    for (const [login, items] of Object.entries(vehicle.pieceworkBreakdownByLogin)) {
      for (const item of items) {
        lines.push({
          id: randomUUID(),
          periodId,
          employeeLogin: login,
          lineType: item.category === "work" ? "piecework_service" : "piecework_product",
          sourceType: "local_demand",
          sourceId: vehicle.demandId,
          date: vehicle.date,
          title: `${vehicle.demandName}: ${item.label}`,
          quantity: item.quantity,
          amountCents: item.amountCents,
          status: "CONFIRMED",
          snapshot: {
            vehicle: {
              id: vehicle.demandId,
              name: vehicle.demandName,
              date: vehicle.date,
              agentName: vehicle.agentName,
              sumCents: vehicle.sumCents,
            },
            item,
          },
        });
      }
    }
  }

  for (const adjustment of params.adjustments) {
    const employeeLogin = canonicalLoginByLower.get(normalizeLogin(adjustment.userLogin)) ?? adjustment.userLogin;
    lines.push({
      id: randomUUID(),
      periodId,
      employeeLogin,
      lineType: adjustment.amountCents >= 0 ? "adjustment_bonus" : "adjustment_deduction",
      sourceType: "bonus_penalty",
      sourceId: adjustment.id,
      date: adjustment.date,
      title: adjustment.comment || adjustment.type,
      quantity: 1,
      amountCents: adjustment.amountCents,
      status: "CONFIRMED",
      snapshot: adjustment,
    });
  }

  for (const cashout of summary.cashoutHistory) {
    lines.push({
      id: randomUUID(),
      periodId,
      employeeLogin: cashout.login,
      lineType: "payout",
      sourceType: "cash_expense_order",
      sourceId: cashout.cashoutId,
      date: cashout.date,
      title: cashout.paymentPurpose || cashout.description || cashout.name,
      quantity: 1,
      amountCents: -Math.abs(cashout.sumCents),
      status: "PAID",
      snapshot: cashout,
    });
  }

  return lines;
}

export async function closePayrollPeriod(params: {
  dateFrom: string;
  dateTo: string;
  closedByLogin: string;
  organizationId?: string;
}) {
  const { branchId } = requireSingleBranchSqlContext();
  const existing = await getPayrollPeriodByRange(params);
  if (existing) return { period: existing, created: false };

  const summary = await getCachedPayrollSummary({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });
  const unresolvedCount = summary.vehicleHistory.reduce(
    (sum, vehicle) => sum + (vehicle.unallocatedPiecework?.length ?? 0),
    0
  );
  if (unresolvedCount > 0) {
    throw new Error(`Нельзя закрыть период: ${unresolvedCount} позиций требуют распределения или правила.`);
  }

  const periodId = randomUUID();
  const users = await getUsersFromEnv();
  const userByLogin = new Map(users.map((user) => [normalizeLogin(user.login), user]));
  const canonicalLoginByLower = new Map(users.map((user) => [normalizeLogin(user.login), user.login]));
  const legacyAdjustments = await prisma.bonusPenalty.findMany({
    where: {
      date: { gte: params.dateFrom, lte: params.dateTo },
      type: { not: "penalty_late" },
    },
    orderBy: { date: "asc" },
  });
  const payrollAdjustments = await listPayrollAdjustments({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
  });
  const adjustments = [
    ...legacyAdjustments,
    ...payrollAdjustments.map((adjustment) => ({
      id: adjustment.id,
      userLogin: adjustment.employeeId,
      date: adjustment.operationDate,
      amountCents: adjustment.amountCents,
      type: adjustment.type,
      comment: adjustment.comment,
    })),
  ];
  const employees = Object.entries(summary.byLogin).map(([login, row]) => {
    const user = userByLogin.get(normalizeLogin(login));
    return {
      id: randomUUID(),
      periodId,
      employeeLogin: user?.login ?? login,
      employeeName: user?.name ?? login,
      employeeRole: user?.role ?? "master",
      shiftTotalCents: row.shiftTotalCents,
      pieceworkCents: row.pieceworkCents,
      adjustmentsCents: row.bonusPenaltyCents,
      paidOutCents: row.paidOutCents,
      remainingCents: row.remainingCents,
      totalCents: row.totalCents,
      shiftsCount: row.shiftsCount,
      status: row.remainingCents <= 0 && row.paidOutCents > 0 ? "paid" : "closed",
      snapshot: row,
    };
  });
  const totals = employees.reduce(
    (acc, employee) => ({
      totalAccruedCents: acc.totalAccruedCents + employee.totalCents,
      totalPaidCents: acc.totalPaidCents + employee.paidOutCents,
      totalRemainingCents: acc.totalRemainingCents + employee.remainingCents,
    }),
    { totalAccruedCents: 0, totalPaidCents: 0, totalRemainingCents: 0 }
  );
  const lines = buildAccrualLines({
    periodId,
    summary,
    adjustments,
    canonicalLoginByLower,
  });
  const organizationId = params.organizationId ?? DEFAULT_PAYROLL_ORG_ID;
  const snapshot = {
    dateFrom: summary.dateFrom,
    dateTo: summary.dateTo,
    totals,
    byLogin: summary.byLogin,
    vehicleHistory: summary.vehicleHistory,
    cashoutHistory: summary.cashoutHistory,
  };

  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO payroll_periods (
        id,
        branch_id,
        organization_id,
        date_from,
        date_to,
        status,
        closed_by_login,
        total_accrued_cents,
        total_paid_cents,
        total_remaining_cents,
        employees_count,
        snapshot_json
      )
      VALUES (
        ${periodId},
        ${branchId},
        ${organizationId},
        ${params.dateFrom},
        ${params.dateTo},
        'closed',
        ${canonicalizeLogin(params.closedByLogin)},
        ${totals.totalAccruedCents},
        ${totals.totalPaidCents},
        ${totals.totalRemainingCents},
        ${employees.length},
        CAST(${JSON.stringify(snapshot)} AS jsonb)
      )
    `;

    for (const employee of employees) {
      await tx.$executeRaw`
        INSERT INTO payroll_period_employees (
          id,
          branch_id,
          period_id,
          employee_login,
          employee_name,
          employee_role,
          shift_total_cents,
          piecework_cents,
          adjustments_cents,
          paid_out_cents,
          remaining_cents,
          total_cents,
          shifts_count,
          status,
          snapshot_json
        )
        VALUES (
          ${employee.id},
          ${branchId},
          ${employee.periodId},
          ${employee.employeeLogin},
          ${employee.employeeName},
          ${employee.employeeRole},
          ${employee.shiftTotalCents},
          ${employee.pieceworkCents},
          ${employee.adjustmentsCents},
          ${employee.paidOutCents},
          ${employee.remainingCents},
          ${employee.totalCents},
          ${employee.shiftsCount},
          ${employee.status},
          CAST(${JSON.stringify(employee.snapshot)} AS jsonb)
        )
      `;
    }

    for (const line of lines) {
      await tx.$executeRaw`
        INSERT INTO payroll_accrual_lines (
          id,
          branch_id,
          period_id,
          employee_login,
          line_type,
          source_type,
          source_id,
          date,
          title,
          quantity,
          amount_cents,
          status,
          snapshot_json
        )
        VALUES (
          ${line.id},
          ${branchId},
          ${line.periodId},
          ${line.employeeLogin},
          ${line.lineType},
          ${line.sourceType},
          ${line.sourceId},
          ${line.date},
          ${line.title},
          ${line.quantity},
          ${line.amountCents},
          ${line.status},
          CAST(${JSON.stringify(line.snapshot)} AS jsonb)
        )
      `;
    }
  });

  const period = await findPayrollPeriodByRange(params);
  if (!period) throw new Error("Период закрыт, но snapshot не найден.");
  return { period, created: true };
}
