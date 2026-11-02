import { SALES_ANALYTICS_METRICS } from "@/lib/sales-analytics-taxonomy";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { canonicalizeLogin } from "@/lib/auth";
import { getBranchContext } from "@/lib/branch-context";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import { employeePlanPositionIds } from "@/lib/employee-sales-plan";
import { getSalesPlanPositionKeys } from "@/lib/sales-performance-analytics";
import type { BranchSalesPlan } from "@prisma/client";

export function salesPlanBonusSource(month: string, rowKey: string) {
  return JSON.stringify([month, rowKey]);
}

export function isSalesPlanComplete(plan: Pick<BranchSalesPlan, "targetCount" | "targetRevenueCents" | "targetGrossProfitCents">, actual: { count: number | null; revenueCents: number; grossProfitCents: number | null } | undefined) {
  if (!actual) return false;
  if (Number(plan.targetCount) > 0) return actual.count != null && actual.count >= Number(plan.targetCount);
  if ((plan.targetRevenueCents ?? 0) > 0) return actual.revenueCents >= plan.targetRevenueCents!;
  return (plan.targetGrossProfitCents ?? 0) > 0 && actual.grossProfitCents != null && actual.grossProfitCents >= plan.targetGrossProfitCents!;
}

/** Uses the same branch lock as period closing, and a permanent DB uniqueness key. */
export async function awardSalesPlanBonus(input: { branchId: string; employeeLogin: string; month: string; rowKey: string; planId: string; planVersion: number; amountCents: number; operationDate: string; title?: string }) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > 2147483647) throw new Error("Некорректная сумма бонуса");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month) || !input.operationDate.startsWith(`${input.month}-`)) throw new Error("Дата бонуса не соответствует месяцу плана");
  const branchId = getScopedBranchId();
  if (input.branchId !== branchId) throw new Error("Бонус относится к другому филиалу");
  const employee = canonicalizeLogin(input.employeeLogin).trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payroll-bonus:${branchId}`}, 0))`;
    const plans = await tx.$queryRaw<{ version: number; month: string; rowKey: string; completionBonusCents: number | null }[]>`SELECT version, month, row_key AS "rowKey", completion_bonus_cents AS "completionBonusCents" FROM branch_sales_plans WHERE id = ${input.planId} AND branch_id = ${branchId} FOR SHARE`;
    if (plans[0]?.version !== input.planVersion || plans[0].month !== input.month || plans[0].rowKey !== input.rowKey || plans[0].completionBonusCents !== input.amountCents) return false;
    const id = randomUUID();
    const inserted = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO payroll_adjustments
      (id, branch_id, organization_id, employee_id, period_from, period_to, operation_date,
       type, amount_cents, reason_code, comment, source_type, source_id, status, created_by_id)
      SELECT ${id}, ${branchId}, 'default', ${employee}, ${input.operationDate}, ${input.operationDate}, ${input.operationDate},
       'BONUS', ${input.amountCents}, 'SALES_PLAN_COMPLETED', ${`Бонус за выполнение плана «${input.title ?? "позиция плана"}» за ${input.month}`},
       'SALES_PLAN_BONUS', ${salesPlanBonusSource(input.month, input.rowKey)}, 'ACTIVE', 'system:sales-plan-bonus'
      WHERE EXISTS (SELECT 1 FROM branch_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.branch_id = ${branchId} AND m.status = 'active' AND m.role_id = 'master' AND u.status = 'active'
        AND (CASE WHEN lower(u.login) = 'alexandr' THEN 'vadim' ELSE lower(u.login) END) = ${employee})
      AND NOT EXISTS (SELECT 1 FROM payroll_periods WHERE branch_id = ${branchId}
        AND status IN ('closed', 'paid') AND date_from <= ${input.operationDate} AND date_to >= ${input.operationDate})
      ON CONFLICT (branch_id, employee_id, source_id) WHERE source_type = 'SALES_PLAN_BONUS' DO NOTHING
      RETURNING id
    `;
    if (!inserted.length) return false;
    await tx.changeLog.create({ data: { branchId, entityType: "payroll_adjustment", entityId: id, action: "create",
      performedByLogin: "system:sales-plan-bonus", newValue: { employeeId: employee, month: input.month, rowKey: input.rowKey, amountCents: input.amountCents, planId: input.planId, planVersion: input.planVersion } } });
    return true;
  });
}

export async function syncSalesPlanBonuses(params: { dateFrom: string; dateTo: string; targetLogin?: string }) {
  const branchId = getScopedBranchId();
  const plans = await prisma.branchSalesPlan.findMany({ where: { branchId,
    month: { gte: params.dateFrom.slice(0, 7), lte: params.dateTo.slice(0, 7) }, completionBonusCents: { gt: 0 } } });
  if (!plans.length) return;
  const context = await getBranchContext({ allowAll: false, requireActive: true });
  if (!context || context.branchId !== branchId) throw new Error("Нет контекста филиала для начисления бонуса");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: context.branch?.timezone ?? "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const today = `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}-${parts.find((p) => p.type === "day")!.value}`;
  const members = await prisma.branchMembership.findMany({ where: { branchId, roleId: "master", status: "active", user: { status: "active" } }, include: { user: { select: { login: true } } } });
  const employees = [...new Set(members.map((member) => canonicalizeLogin(member.user.login).toLowerCase()))]
    .filter((login) => !params.targetLogin || login === canonicalizeLogin(params.targetLogin).toLowerCase());
  const awardedRows = await prisma.$queryRaw<{ employeeId: string; sourceId: string | null }[]>`
    SELECT employee_id AS "employeeId", source_id AS "sourceId" FROM payroll_adjustments
    WHERE branch_id = ${branchId} AND source_type = 'SALES_PLAN_BONUS'
      AND operation_date >= ${`${params.dateFrom.slice(0, 7)}-01`}
      AND operation_date <= ${`${params.dateTo.slice(0, 7)}-31`}
  `;
  const awarded = new Set(awardedRows.map((row) => JSON.stringify([row.employeeId, row.sourceId])));
  const { computePayroll } = await import("@/lib/payroll");
  for (const month of [...new Set(plans.map((plan) => plan.month))]) {
    if (month > today.slice(0, 7)) continue;
    const dateFrom = `${month}-01`;
    const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    const operationDate = month === today.slice(0, 7) ? today : `${month}-${lastDay}`;
    for (const employeeLogin of employees) {
      const pending = plans.filter((plan) => plan.month === month && !awarded.has(JSON.stringify([employeeLogin, salesPlanBonusSource(month, plan.rowKey)])));
      if (!pending.length) continue;
      const summary = await computePayroll({ dateFrom, dateTo: operationDate, targetLogin: employeeLogin, skipSalesPlanBonuses: true });
      const mapping = await getSalesPlanPositionKeys(context, [branchId], { period: "custom", dateFrom, dateTo: operationDate }, employeePlanPositionIds(summary, employeeLogin));
      if (!mapping.complete) continue;
      for (const plan of pending) {
        if (!isSalesPlanComplete(plan, mapping.actuals.get(`${branchId}:${plan.rowKey}`))) continue;
        await awardSalesPlanBonus({ branchId, employeeLogin, month, rowKey: plan.rowKey, planId: plan.id,
          planVersion: plan.version, amountCents: plan.completionBonusCents!, operationDate,
          title: SALES_ANALYTICS_METRICS.find((metric) => metric.code === plan.metricCode)?.title });
      }
    }
  }
}
