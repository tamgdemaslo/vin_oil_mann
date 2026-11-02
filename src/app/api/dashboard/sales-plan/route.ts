import { listPayrollAdjustments } from "@/lib/payroll-settlements";
import { salesPlanBonusSource } from "@/lib/sales-plan-bonus";
import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getSalesPerformanceAnalytics, getSalesPlanPositionKeys } from "@/lib/sales-performance-analytics";
import { getCachedPayrollSummary } from "@/lib/payroll";
import { employeePlanEarnings, employeePlanPositionIds } from "@/lib/employee-sales-plan";

export async function GET() {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const context = access.context;
  if (context.branchRole !== "master" && !(context.branchRole == null && context.user.role === "master")) return NextResponse.json({ error: "План доступен мастеру-приёмщику" }, { status: 403 });
  const branchId = context.branchId!;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: context.branch?.timezone ?? "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")!.value;
  const monthPart = parts.find((part) => part.type === "month")!.value;
  const month = `${year}-${monthPart}`;
  const today = `${month}-${parts.find((part) => part.type === "day")!.value}`;
  const dateFrom = `${month}-01`;
  const dateTo = `${month}-${new Date(Date.UTC(Number(year), Number(monthPart), 0)).getUTCDate()}`;
  try {
    return await runWithBranchApiContext(context, async () => {
      const params = { period: "custom", dateFrom, dateTo };
      const [analytics, payroll] = await Promise.all([
        getSalesPerformanceAnalytics(context, [branchId], params),
        getCachedPayrollSummary({ dateFrom, dateTo, targetLogin: context.user.login }),
      ]);
      const mapping = await getSalesPlanPositionKeys(context, [branchId], { ...params, dateTo: today }, employeePlanPositionIds(payroll, context.user.login));
      const awardedBonuses = await listPayrollAdjustments({ dateFrom, dateTo, employeeLogin: context.user.login, includeInactive: true, unlimited: true });
      const earnings = employeePlanEarnings(payroll, context.user.login, mapping.positions);
      const rows = analytics.plan.rows.filter((row) => row.targetCount > 0 || (row.targetRevenueCents ?? 0) > 0 || (row.targetGrossProfitCents ?? 0) > 0).map((row) => {
        const measure = row.targetCount > 0 ? "quantity" : (row.targetRevenueCents ?? 0) > 0 ? "revenue" : "profit";
        const target = measure === "quantity" ? row.targetCount : measure === "revenue" ? row.targetRevenueCents! : row.targetGrossProfitCents!;
        const own = mapping.actuals.get(`${branchId}:${row.rowKey}`) ?? { count: 0, revenueCents: 0, grossProfitCents: 0 };
        const actual = !mapping.complete ? null : measure === "quantity" ? own.count : measure === "revenue" ? own.revenueCents : own.grossProfitCents;
        const award = awardedBonuses.find((item) => item.sourceType === "SALES_PLAN_BONUS" && item.sourceId === salesPlanBonusSource(month, row.rowKey));
        return { id: row.rowKey, title: row.title, kind: row.kind, unit: row.unit, measure, target, actual,
          earnedCents: mapping.complete ? earnings.get(row.rowKey) ?? 0 : null,
          bonusCents: award?.amountCents ?? row.completionBonusCents ?? null, bonusStatus: award ? award.status === "ACTIVE" ? "ACCRUED" : "REVERSED" : row.completionBonusCents == null ? "NOT_CONFIGURED" : "CONFIGURED" };
      });
      return NextResponse.json({ month, branchName: context.branch?.displayName || context.branch?.name || "Текущий филиал", rows, updatedAt: new Date().toISOString() });
    });
  } catch {
    return NextResponse.json({ error: "Не удалось загрузить план продаж" }, { status: 500 });
  }
}
