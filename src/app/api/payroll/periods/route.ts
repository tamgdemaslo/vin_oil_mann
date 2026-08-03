import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listPayrollPeriods } from "@/lib/payroll-periods";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 50;
  const employeeLogin = session.user.role === "owner" ? searchParams.get("employee") ?? undefined : session.user.login;

  const periods = await listPayrollPeriods({ employeeLogin, limit });
  return NextResponse.json({ periods });
}
