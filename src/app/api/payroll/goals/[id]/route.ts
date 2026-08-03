import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logChange } from "@/lib/change-log";
import { updatePayrollGoal } from "@/lib/payroll-motivation";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const status = typeof body.status === "string" ? body.status : undefined;
  const targetValue = Number.isFinite(Number(body.targetValue)) ? Math.round(Number(body.targetValue)) : undefined;
  const startsAt = typeof body.startsAt === "string" && body.startsAt ? body.startsAt : undefined;
  const endsAt = typeof body.endsAt === "string" && body.endsAt ? body.endsAt : undefined;

  if (startsAt && endsAt && startsAt > endsAt) {
    return NextResponse.json({ error: "Дата начала не может быть позже даты окончания" }, { status: 400 });
  }

  await updatePayrollGoal({
    id,
    targetValue,
    baselineValue: Number.isFinite(Number(body.baselineValue)) ? Math.round(Number(body.baselineValue)) : undefined,
    stretchValue: Number.isFinite(Number(body.stretchValue)) ? Math.round(Number(body.stretchValue)) : undefined,
    startsAt,
    endsAt,
    status,
  });

  await logChange({
    entityType: "payroll_goal",
    entityId: id,
    action: "update",
    newValue: body,
    performedByLogin: session.user.login,
  });

  return NextResponse.json({ ok: true });
}
