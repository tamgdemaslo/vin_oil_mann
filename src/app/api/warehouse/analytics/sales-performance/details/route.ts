import { NextRequest, NextResponse } from "next/server";
import { readableBranchIds, requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import { getSalesPerformanceDetails, salesPerformanceParamsFromSearchParams } from "@/lib/sales-performance-analytics";

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true });
  if (!access.ok) return access.response;
  if (!(await canViewWarehouseAnalytics(access.context.user))) {
    return NextResponse.json({ error: "Недостаточно прав для аналитики склада" }, { status: 403 });
  }
  const rowKey = request.nextUrl.searchParams.get("rowKey")?.trim() ?? "";
  if (!rowKey) return NextResponse.json({ error: "Не выбрана строка для детализации" }, { status: 400 });
  try {
    const data = await runWithBranchApiContext(access.context, () =>
      getSalesPerformanceDetails(access.context, readableBranchIds(access.context), {
        ...salesPerformanceParamsFromSearchParams(request.nextUrl.searchParams),
        rowKey,
      })
    );
    return NextResponse.json(data);
  } catch (error) {
    console.error("sales performance details failed", error);
    return NextResponse.json({ error: "Не удалось загрузить исходные отгрузки" }, { status: 500 });
  }
}
