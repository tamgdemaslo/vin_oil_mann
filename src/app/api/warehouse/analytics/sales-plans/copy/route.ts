import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";
import { canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import { copySalesPlans } from "@/lib/sales-plans";

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true });
  if (!access.ok) return access.response;
  if (!(await canViewWarehouseAnalytics(access.context.user))) {
    return NextResponse.json({ error: "Недостаточно прав для аналитики склада" }, { status: 403 });
  }
  try {
    const body = await request.json() as {
      sourceBranchId?: unknown;
      sourceMonth?: unknown;
      targetBranchId?: unknown;
      targetMonth?: unknown;
    };
    const sourceBranchId = String(body.sourceBranchId ?? access.context.branchId ?? "").trim();
    const targetBranchId = String(body.targetBranchId ?? access.context.branchId ?? "").trim();
    if (!sourceBranchId || !targetBranchId) throw new Error("Выберите исходный и целевой филиалы");
    const plans = await copySalesPlans(access.context, {
      sourceBranchId,
      sourceMonth: body.sourceMonth,
      targetBranchId,
      targetMonth: body.targetMonth,
    });
    return NextResponse.json({ ok: true, plans });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось скопировать планы" }, { status: 400 });
  }
}
