import { NextRequest, NextResponse } from "next/server";
import { readableBranchIds, requireBranchApi } from "@/lib/branch-api";
import type { BranchContext } from "@/lib/branch-context";
import { canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import {
  canManageSalesPlans,
  listSalesPlans,
  salesPlanHistory,
  saveSalesPlans,
  type SalesPlanWriteInput,
} from "@/lib/sales-plans";

function currentMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.NEXT_PUBLIC_APP_TIMEZONE?.trim() || process.env.APP_TIMEZONE?.trim() || "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

function requestedBranchIds(context: BranchContext, branchId: string | null) {
  const allowed = readableBranchIds(context);
  if (!branchId) return allowed;
  if (!allowed.includes(branchId)) throw new Error("Нет доступа к выбранному филиалу");
  return [branchId];
}

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true });
  if (!access.ok) return access.response;
  if (!(await canViewWarehouseAnalytics(access.context.user))) {
    return NextResponse.json({ error: "Недостаточно прав для аналитики склада" }, { status: 403 });
  }
  try {
    const month = request.nextUrl.searchParams.get("month") || currentMonth();
    const branchIds = requestedBranchIds(access.context, request.nextUrl.searchParams.get("branchId"));
    const [plans, history] = await Promise.all([
      listSalesPlans(access.context, branchIds, month),
      request.nextUrl.searchParams.get("includeHistory") === "1"
        ? salesPlanHistory(access.context, branchIds, month)
        : Promise.resolve([]),
    ]);
    return NextResponse.json({
      month,
      branchIds,
      canManage: canManageSalesPlans(access.context),
      plans,
      history,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось загрузить планы" }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true });
  if (!access.ok) return access.response;
  if (!(await canViewWarehouseAnalytics(access.context.user))) {
    return NextResponse.json({ error: "Недостаточно прав для аналитики склада" }, { status: 403 });
  }
  try {
    const body = await request.json() as { branchId?: unknown; month?: unknown; plans?: SalesPlanWriteInput[] };
    const branchId = String(body.branchId ?? access.context.branchId ?? "").trim();
    if (!branchId) throw new Error("Для сохранения выберите один филиал");
    const plans = await saveSalesPlans(access.context, branchId, body.month, body.plans ?? []);
    return NextResponse.json({ ok: true, plans });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить планы" }, { status: 400 });
  }
}
