import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi } from "@/lib/branch-api";
import { canViewWarehouseAnalytics } from "@/lib/warehouse-analytics-access";
import { updateSalesPlan, type SalesPlanWriteInput } from "@/lib/sales-plans";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireBranchApi({ allowAll: true });
  if (!access.ok) return access.response;
  if (!(await canViewWarehouseAnalytics(access.context.user))) {
    return NextResponse.json({ error: "Недостаточно прав для аналитики склада" }, { status: 403 });
  }
  try {
    const { id } = await params;
    const patch = await request.json() as Partial<SalesPlanWriteInput>;
    const plan = await updateSalesPlan(access.context, id, patch);
    return NextResponse.json({ ok: true, plan });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось изменить план" }, { status: 400 });
  }
}
