import { NextRequest, NextResponse } from "next/server";
import { canonicalizeLogin, getSession } from "@/lib/auth";
import { logChange } from "@/lib/change-log";
import {
  createPayrollGoal,
  listAllPayrollGoals,
  type PayrollGoalMetric,
  type PayrollGoalRecord,
} from "@/lib/payroll-motivation";

import { requireBranchApi } from "@/lib/branch-api";
import { listPieceworkEmployees, listPieceworkTargets } from "@/lib/piecework-rules";

const PERIOD_TYPES = new Set(["SHIFT", "WEEK", "MONTH"]);
const METRICS = new Set<PayrollGoalMetric>(["SERVICE", "PRODUCT_CATEGORY"]);

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const goals = await listAllPayrollGoals();
  return NextResponse.json({ goals });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const branchId = access.context.branchId!;
  const body = await request.json();
  const employeeLogin = typeof body.employeeLogin === "string" ? canonicalizeLogin(body.employeeLogin.trim()).toLowerCase() : "";
  const employees = await listPieceworkEmployees(branchId);
  if (!employees.some((employee) => employee.login === employeeLogin)) return NextResponse.json({ error: "Выберите действующего сотрудника филиала" }, { status: 400 });
  const periodType = typeof body.periodType === "string" ? body.periodType : "MONTH";
  const metric = typeof body.metric === "string" ? body.metric : "";
  const targetValue = Number(body.targetValue);
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : "";
  const endsAt = typeof body.endsAt === "string" ? body.endsAt : "";

  if (!PERIOD_TYPES.has(periodType)) return NextResponse.json({ error: "Некорректный periodType" }, { status: 400 });
  if (!METRICS.has(metric as PayrollGoalMetric)) return NextResponse.json({ error: "Некорректная метрика" }, { status: 400 });
  if (!Number.isInteger(targetValue) || targetValue <= 0 || targetValue > 2147483647) {
    return NextResponse.json({ error: "Укажите положительную цель" }, { status: 400 });
  }
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!isDate(startsAt) || !isDate(endsAt) || startsAt > endsAt) {
    return NextResponse.json({ error: "Укажите корректный период цели" }, { status: 400 });
  }

  const targets = await listPieceworkTargets(branchId);
  const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
  const target = (metric === "SERVICE" ? targets.services : targets.productGroups).find((item) => item.id === targetId);
  if (!target) return NextResponse.json({ error: "Выберите услугу или категорию товаров из каталога текущего филиала" }, { status: 400 });
  const id = await createPayrollGoal({
    targetId: target.id,
    targetName: target.name,
    employeeLogin,
    role: null,
    teamKey: null,
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
