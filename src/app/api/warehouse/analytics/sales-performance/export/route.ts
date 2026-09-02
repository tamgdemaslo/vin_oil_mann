import { NextRequest, NextResponse } from "next/server";
import { readableBranchIds, requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { canExportWarehouseAnalytics, canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import {
  buildSalesPerformanceCsv,
  getSalesPerformanceAnalytics,
  salesPerformanceParamsFromSearchParams,
} from "@/lib/sales-performance-analytics";

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true });
  if (!access.ok) return access.response;
  if (!(await canViewWarehouseAnalytics(access.context.user)) || !(await canExportWarehouseAnalytics(access.context.user))) {
    return NextResponse.json({ error: "Недостаточно прав для экспорта аналитики" }, { status: 403 });
  }
  const requestedTable = request.nextUrl.searchParams.get("table");
  const table = requestedTable === "services" || requestedTable === "unclassified" ? requestedTable : "products";
  try {
    const data = await runWithBranchApiContext(access.context, () =>
      getSalesPerformanceAnalytics(
        access.context,
        readableBranchIds(access.context),
        salesPerformanceParamsFromSearchParams(request.nextUrl.searchParams),
      )
    );
    const csv = buildSalesPerformanceCsv(data, table);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sales-${table}-${data.period.dateFrom}-${data.period.dateTo}.csv"`,
      },
    });
  } catch (error) {
    console.error("sales performance export failed", error);
    return NextResponse.json({ error: "Не удалось сформировать CSV" }, { status: 500 });
  }
}
