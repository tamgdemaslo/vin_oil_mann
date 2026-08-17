import { NextRequest, NextResponse } from "next/server";
import { canonicalizeLogin } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getCachedPayrollSummary } from "@/lib/payroll";
import { createPayrollPayment, listPayrollPayments } from "@/lib/payroll-settlements";

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
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom") ?? undefined;
    const dateTo = searchParams.get("dateTo") ?? undefined;
    const requestedUser = searchParams.get("user") ?? searchParams.get("employeeLogin");
    const employeeLogin = canManagePayroll(access.context.user.role) ? requestedUser : access.context.user.login;

    try {
      const rows = await listPayrollPayments({
        dateFrom,
        dateTo,
        employeeLogin,
        includeInactive: searchParams.get("includeInactive") === "1",
      });
      return NextResponse.json(rows);
    } catch (error) {
      console.error("Payroll payments list failed", error);
      return NextResponse.json({ error: "Не удалось загрузить выплаты" }, { status: 500 });
    }
  });
}

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    if (!canManagePayroll(access.context.user.role)) {
      return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Некорректные данные выплаты" }, { status: 400 });
    }
    const employeeLogin = typeof body.employeeLogin === "string" ? body.employeeLogin : typeof body.userLogin === "string" ? body.userLogin : "";
    const periodFrom = typeof body.periodFrom === "string" ? body.periodFrom : typeof body.dateFrom === "string" ? body.dateFrom : "";
    const periodTo = typeof body.periodTo === "string" ? body.periodTo : typeof body.dateTo === "string" ? body.dateTo : "";
    const operationDate = typeof body.operationDate === "string" ? body.operationDate : typeof body.date === "string" ? body.date : "";
    const operationType = typeof body.operationType === "string" ? body.operationType : "SALARY";
    const paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod : "CASH";
    const comment = typeof body.comment === "string" ? body.comment.trim() : null;
    const amountCents = centsFromBody(body);

    if (!employeeLogin || !validDateKey(periodFrom) || !validDateKey(periodTo) || !validDateKey(operationDate) || periodFrom > periodTo) {
      return NextResponse.json({ error: "Укажите сотрудника, дату выплаты и корректный период" }, { status: 400 });
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: "Сумма выплаты должна быть больше нуля" }, { status: 400 });
    }

    try {
      if (operationType.toUpperCase() === "SALARY") {
        const summary = await getCachedPayrollSummary({
          dateFrom: periodFrom,
          dateTo: periodTo,
          targetLogin: employeeLogin,
        });
        const normalizedEmployee = canonicalizeLogin(employeeLogin).trim().toLowerCase();
        const row = Object.entries(summary.byLogin).find(([login]) => login.trim().toLowerCase() === normalizedEmployee)?.[1];
        if (!row) {
          return NextResponse.json({ error: "Расчёт сотрудника за период не найден" }, { status: 400 });
        }
        if (amountCents > Math.max(0, row.remainingCents)) {
          return NextResponse.json({ error: "Сумма выплаты больше суммы к выплате" }, { status: 400 });
        }
      }

      const created = await createPayrollPayment({
        employeeLogin,
        periodFrom,
        periodTo,
        operationDate,
        operationType,
        amountCents,
        paymentMethod,
        comment,
        createdByLogin: access.context.user.login,
        createdByName: access.context.user.name,
        createdByRole: access.context.user.role,
      });
      return NextResponse.json(created, { status: 201 });
    } catch (error) {
      console.error("Payroll payment create failed", error);
      const message = error instanceof Error ? error.message : "Не удалось создать выплату";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  });
}
