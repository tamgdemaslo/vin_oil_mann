import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { listPayrollPeriods } from "@/lib/payroll-periods";

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    const { searchParams } = new URL(request.url);
    const limitRaw = Number(searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 50;
    const employeeLogin = access.context.user.role === "owner" ? searchParams.get("employee") ?? undefined : access.context.user.login;

    try {
      const periods = await listPayrollPeriods({ employeeLogin, limit });
      return NextResponse.json({ periods });
    } catch (error) {
      console.error("Payroll periods list failed", error);
      return NextResponse.json({ error: "Не удалось загрузить закрытые периоды" }, { status: 500 });
    }
  });
}
