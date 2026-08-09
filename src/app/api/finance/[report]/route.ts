import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { financeSlice, getFinanceCenter, type FinanceCalculationMode } from "@/lib/finance-center";
import { invalidateLocalInventoryFinanceCache } from "@/lib/local-inventory-finance";

type RouteContext = {
  params: Promise<{ report: string }>;
};

function paramsFromRequest(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("calculationMode");
  return {
    dateFrom: request.nextUrl.searchParams.get("dateFrom") ?? undefined,
    dateTo: request.nextUrl.searchParams.get("dateTo") ?? undefined,
    organizationId: request.nextUrl.searchParams.get("organizationId") ?? undefined,
    warehouseId: request.nextUrl.searchParams.get("warehouseId") ?? request.nextUrl.searchParams.get("storeId") ?? undefined,
    calculationMode: (mode === "payment" ? "payment" : "accrual") as FinanceCalculationMode,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ allowAll: false, requireActive: false });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    const { report } = await context.params;
    const data = await getFinanceCenter(paramsFromRequest(request));
    const slice = financeSlice(report, data);
    if (!slice) return NextResponse.json({ error: "Неизвестный финансовый отчёт" }, { status: 404 });
    return NextResponse.json(slice);
  });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    const { report } = await context.params;
    if (report === "recalculate") {
      invalidateLocalInventoryFinanceCache();
      const data = await getFinanceCenter(paramsFromRequest(request));
      return NextResponse.json({ ok: true, recalculatedAt: data.period.calculatedAt, overview: data });
    }

    if (report === "export") {
      const data = await getFinanceCenter(paramsFromRequest(request));
      return NextResponse.json({
        ok: true,
        reports: data.exportReports,
        period: data.period,
      });
    }

    if (["expense-categories", "tax-settings", "acquiring-settings", "fixed-expenses"].includes(report)) {
      return NextResponse.json({
        ok: true,
        mode: "draft-settings",
        message: "Настройка принята как черновик. Постоянное хранение справочников добавляется отдельной миграцией.",
      });
    }

    return NextResponse.json({ error: "POST для этого финансового раздела не поддерживается" }, { status: 405 });
  });
}
