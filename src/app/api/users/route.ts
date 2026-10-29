import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { listPayrollEmployees } from "@/lib/payroll-employees";

/** GET: список сотрудников (логин + имя). Только для владельца. */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") {
    return NextResponse.json({ error: "Доступ только для владельца" }, { status: 403 });
  }

  const access = await requireBranchApi();
  if (!access.ok) return access.response;
  const employees = await listPayrollEmployees(access.context.branchId!);
  const users = employees.map(({ settings, ...employee }) => ({ ...employee, employmentEnd: settings.employmentEnd ?? null }));
  return NextResponse.json({ users });
}
