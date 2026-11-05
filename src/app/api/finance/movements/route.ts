import { NextRequest, NextResponse } from "next/server";
import { readableBranchIds, requireBranchApi } from "@/lib/branch-api";
import { readFinanceMoneyMovements } from "@/lib/finance-money-movements";
import { runWithRequestTenant } from "@/lib/request-tenant-store";

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: true, requireActive: false });
  if (!access.ok) return access.response;
  const { context } = access;
  if (!["owner", "admin"].includes(context.user.role)) {
    return NextResponse.json({ error: "Недостаточно прав для просмотра движения денег." }, { status: 403 });
  }
  const dateFrom = request.nextUrl.searchParams.get("dateFrom") ?? "";
  const dateTo = request.nextUrl.searchParams.get("dateTo") ?? "";
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(dateFrom) || !validDate(dateTo) || dateFrom > dateTo) {
    return NextResponse.json({ error: "Укажите корректный период." }, { status: 400 });
  }
  const seen = new Set<string>();
  try {
    const reports = [];
    for (const branchId of readableBranchIds(context)) {
      const branch = context.branches.find(item => item.id === branchId);
      const report = await runWithRequestTenant({
        mode: "branch", branchId, organizationId: branch?.legacyOrganizationId ?? context.organizationId,
        allowedBranchIds: [branchId], businessGroupId: context.businessGroupId, userId: context.userId,
      }, () => readFinanceMoneyMovements(dateFrom, dateTo, context.user, seen));
      reports.push({ branchId, branchName: branch?.shortName ?? branch?.name ?? "", ...report });
    }
    return NextResponse.json(reports, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[finance-movements]", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Не удалось собрать движение денег за период." }, { status: 502 });
  }
}
