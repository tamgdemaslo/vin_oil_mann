import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logChange } from "@/lib/change-log";
import {
  createPayrollGoal,
  listAllPayrollGoals,
  type PayrollGoalMetric,
  type PayrollGoalRecord,
} from "@/lib/payroll-motivation";

const PERIOD_TYPES = new Set(["SHIFT", "WEEK", "MONTH"]);
const METRICS = new Set<PayrollGoalMetric>([
  "ACCRUAL_AMOUNT",
  "VEHICLES",
  "SERVICES",
  "PRODUCTS",
  "SHIPMENTS",
  "QUALITY",
  "DIAGNOSTICS",
  "APPROVED_RECOMMENDATIONS",
]);

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const goals = await listAllPayrollGoals();
  return NextResponse.json({ goals });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const body = await request.json();
  const periodType = typeof body.periodType === "string" ? body.periodType : "MONTH";
  const metric = typeof body.metric === "string" ? body.metric : "ACCRUAL_AMOUNT";
  const targetValue = Number(body.targetValue);
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body.endsAt === "string" ? body.endsAt : "";

  if (!PERIOD_TYPES.has(periodType)) return NextResponse.json({ error: "Некорректный periodType" }, { status: 400 });
  if (!METRICS.has(metric as PayrollGoalMetric)) return NextResponse.json({ error: "Некорректная метрика" }, { status: 400 });
  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    return NextResponse.json({ error: "Укажите положительную цель" }, { status: 400 });
  }
  if (!startsAt || !endsAt || startsAt > endsAt) {
    return NextResponse.json({ error: "Укажите корректный период цели" }, { status: 400 });
  }

  const id = await createPayrollGoal({
    employeeLogin: typeof body.employeeLogin === "string" && body.employeeLogin ? body.employeeLogin : null,
    role: typeof body.role === "string" && body.role ? body.role : null,
    teamKey: typeof body.teamKey === "string" && body.teamKey ? body.teamKey : null,
    periodType: periodType as PayrollGoalRecord["periodType"],
    metric: metric as PayrollGoalMetric,
    targetValue: Math.round(targetValue),
    baselineValue: Number.isFinite(Number(body.baselineValue)) ? Math.round(Number(body.baselineValue)) : null,
    stretchValue: Number.isFinite(Number(body.stretchValue)) ? Math.round(Number(body.stretchValue)) : null,
    startsAt,
    endsAt,
    createdByLogin: session.user.login,
  });

  await logChange({
    entityType: "payroll_goal",
    entityId: id,
    action: "create",
    newValue: { ...body, id },
    performedByLogin: session.user.login,
  });

  return NextResponse.json({ id }, { status: 201 });
}
