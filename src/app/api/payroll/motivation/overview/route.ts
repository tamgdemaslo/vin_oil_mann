import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listAllPayrollGoals } from "@/lib/payroll-motivation";

import { requireBranchApi } from "@/lib/branch-api";
import { listPieceworkEmployees, listPieceworkTargets } from "@/lib/piecework-rules";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const branchId = access.context.branchId!;
  const [users, goals, targets] = await Promise.all([
    listPieceworkEmployees(branchId),
    listAllPayrollGoals(),
    listPieceworkTargets(branchId),
  ]);

  return NextResponse.json({
    users: users.map(({ login, name, roleLabel }) => ({ login, name, role: roleLabel })),
    targets,
    goals,
    recognition: [],
    metrics: {
      employeesWithGoals: new Set(goals.map((goal) => goal.employeeLogin).filter(Boolean)).size,
      activeGoals: goals.filter((goal) => goal.status === "active").length,
      recognitionCount: 0,
    },
  });
}
