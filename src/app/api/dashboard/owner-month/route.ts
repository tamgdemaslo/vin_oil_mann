import { NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { ownerDashboardDelta, ownerDashboardPeriod } from "@/lib/owner-dashboard-period";
import { getSalesPerformanceAnalytics } from "@/lib/sales-performance-analytics";
import { SERVICE_TIME_ZONE } from "@/lib/date-time";
import { addLocalDays, zonedLocalToUtc } from "@/lib/booking/timezone";

export async function GET() {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const context = access.context;
  if (context.user.role !== "owner" && !context.groupRole) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  return runWithBranchApiContext(context, async () => {
    const period = ownerDashboardPeriod(new Date(), context.branch?.timezone);
    const boundary = (value: string, next = false) => zonedLocalToUtc(next ? addLocalDays(value, 1) : value, "00:00", context.branch?.timezone ?? SERVICE_TIME_ZONE);
    const total = (from: string, to: string) => prisma.localDemand.aggregate({ where: { branchId: context.branchId!, applicable: true, momentAt: { gte: boundary(from), lt: boundary(to, true) } }, _sum: { sumCents: true }, _count: { _all: true } });
    try {
      const [month, current, previous, plan] = await Promise.all([
        total(period.dateFrom, period.today), total(period.dateFrom, period.currentComparisonTo), total(period.previousFrom, period.previousTo),
        getSalesPerformanceAnalytics(context, [context.branchId!], { period: "custom", dateFrom: period.dateFrom, dateTo: period.dateTo }).then(data => ({ rows: data.plan.rows, error: null })).catch(() => ({ rows: [], error: "Не удалось загрузить план продаж" })),
      ]);
      return NextResponse.json({ period, branchName: context.branch?.displayName || context.branch?.name || "Текущий филиал", revenueCents: month._sum.sumCents ?? 0, shipmentsCount: month._count._all,
        revenueDeltaPercent: ownerDashboardDelta(current._sum.sumCents ?? 0, previous._sum.sumCents ?? 0), shipmentsDeltaPercent: ownerDashboardDelta(current._count._all, previous._count._all),
        planError: plan.error, plans: plan.rows.filter(row => row.targetCount > 0 || (row.targetRevenueCents ?? 0) > 0 || (row.targetGrossProfitCents ?? 0) > 0).flatMap(row => [
          ...(row.targetCount > 0 ? [{ id: `${row.rowKey}:quantity`, title: row.title, target: row.targetCount, actual: row.actualCount, unit: row.unit === "LITER" ? "л" : row.unit === "OPERATION" ? "усл." : "шт.", money: false }] : []),
          ...((row.targetRevenueCents ?? 0) > 0 ? [{ id: `${row.rowKey}:revenue`, title: `${row.title} · выручка`, target: row.targetRevenueCents!, actual: row.actualRevenueCents, unit: "₽", money: true }] : []),
          ...((row.targetGrossProfitCents ?? 0) > 0 ? [{ id: `${row.rowKey}:profit`, title: `${row.title} · прибыль`, target: row.targetGrossProfitCents!, actual: row.actualGrossProfitCents, unit: "₽", money: true }] : []),
        ]),
      }, { headers: { "Cache-Control": "private, no-store" } });
    } catch { return NextResponse.json({ error: "Не удалось загрузить итоги месяца" }, { status: 500 }); }
  });
}
