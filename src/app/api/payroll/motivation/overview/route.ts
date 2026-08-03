import { NextResponse } from "next/server";
import { getSession, getUsersFromEnv } from "@/lib/auth";
import { listAllPayrollGoals, listAllRecognition } from "@/lib/payroll-motivation";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const [users, goals, recognition] = await Promise.all([
    getUsersFromEnv(),
    listAllPayrollGoals(),
    listAllRecognition(),
  ]);

  return NextResponse.json({
    users: users.map(({ login, name, role }) => ({ login, name, role })),
    goals,
    recognition,
    metrics: {
      employeesWithGoals: new Set(goals.map((goal) => goal.employeeLogin).filter(Boolean)).size,
      activeGoals: goals.filter((goal) => goal.status === "active").length,
      recognitionCount: recognition.length,
    },
  });
}
