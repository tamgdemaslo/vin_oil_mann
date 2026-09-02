import { NextRequest, NextResponse } from "next/server";
import { readableBranchIds, requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import { getSalesPerformanceAnalytics, salesPerformanceParamsFromSearchParams } from "@/lib/sales-performance-analytics";

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true });
  if (!access.ok) return access.response;
  if (!(await canViewWarehouseAnalytics(access.context.user))) {
    return NextResponse.json({ error: "Недостаточно прав для аналитики склада" }, { status: 403 });
  }
  const branchIds = readableBranchIds(access.context);
  try {
    const data = await runWithBranchApiContext(access.context, () =>
      getSalesPerformanceAnalytics(
        access.context,
        branchIds,
        salesPerformanceParamsFromSearchParams(request.nextUrl.searchParams),
      )
    );
    return NextResponse.json(data);
  } catch (error) {
    console.error("sales performance analytics failed", error);
    return NextResponse.json({ error: "Не удалось рассчитать продажи и услуги" }, { status: 500 });
  }
}
