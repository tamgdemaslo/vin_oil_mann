import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createPayrollAdjustment, listPayrollAdjustments } from "@/lib/payroll-settlements";

function validDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function canManagePayroll(role: string) {
  return role === "owner" || role === "admin";
}

function centsFromBody(body: { amountCents?: unknown; amount?: unknown }) {
  const cents = Number(body.amountCents);
  if (Number.isFinite(cents)) return Math.round(cents);
  const amount = Number(body.amount);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom") ?? undefined;
  const dateTo = searchParams.get("dateTo") ?? undefined;
  const requestedUser = searchParams.get("user") ?? searchParams.get("employeeLogin");
  const employeeLogin = canManagePayroll(session.user.role) ? requestedUser : session.user.login;

  const rows = await listPayrollAdjustments({
    dateFrom,
    dateTo,
    employeeLogin,
    includeInactive: searchParams.get("includeInactive") === "1",
  });
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (!canManagePayroll(session.user.role)) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  const body = await request.json();
  const employeeLogin = typeof body.employeeLogin === "string" ? body.employeeLogin : typeof body.userLogin === "string" ? body.userLogin : "";
  const periodFrom = typeof body.periodFrom === "string" ? body.periodFrom : typeof body.dateFrom === "string" ? body.dateFrom : "";
  const periodTo = typeof body.periodTo === "string" ? body.periodTo : typeof body.dateTo === "string" ? body.dateTo : "";
  const operationDate = typeof body.operationDate === "string" ? body.operationDate : typeof body.date === "string" ? body.date : "";
  const type = typeof body.type === "string" ? body.type : "BONUS";
  const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode.trim() : null;
  const comment = typeof body.comment === "string" ? body.comment.trim() : null;
  const amountCents = centsFromBody(body);

  if (!employeeLogin || !validDateKey(periodFrom) || !validDateKey(periodTo) || !validDateKey(operationDate) || periodFrom > periodTo) {
    return NextResponse.json({ error: "Укажите сотрудника, дату операции и корректный период" }, { status: 400 });
  }
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "Сумма операции должна быть больше нуля" }, { status: 400 });
  }

  const normalizedType = type.toUpperCase();
  const negative = normalizedType.includes("PENALTY") || normalizedType.includes("DEDUCTION") || normalizedType.includes("УДЕРЖ") || normalizedType.includes("ШТРАФ");
  if (negative && !reasonCode && !comment) {
    return NextResponse.json({ error: "Для штрафа или удержания укажите причину или комментарий" }, { status: 400 });
  }

  try {
    const created = await createPayrollAdjustment({
      employeeLogin,
      periodFrom,
      periodTo,
      operationDate,
      type,
      amountCents,
      reasonCode,
      comment,
      createdByLogin: session.user.login,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось создать корректировку";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
