import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listActivePayrollGoals } from "@/lib/payroll-motivation";
import { toLocalDateString } from "@/lib/time";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });

  const goals = await listActivePayrollGoals({
    employeeLogin: session.user.login,
    role: session.user.role,
    dateKey: toLocalDateString(new Date()),
  });

  return NextResponse.json({ goals });
}
