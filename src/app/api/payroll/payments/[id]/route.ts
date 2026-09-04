import { NextRequest, NextResponse } from "next/server";
import { canonicalizeLogin } from "@/lib/auth";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getCachedPayrollSummary } from "@/lib/payroll";
import { getPayrollPaymentById, updatePayrollPayment } from "@/lib/payroll-settlements";

function canManagePayroll(role: string) {
  return role === "owner" || role === "admin";
}

function validDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function centsFromBody(body: { amountCents?: unknown; amount?: unknown }) {
  const cents = Number(body.amountCents);
  if (Number.isFinite(cents)) return Math.round(cents);
  const amount = Number(body.amount);
  return Number.isFinite(amount) ? Math.round(amount * 100) : NaN;
}

function periodsOverlap(leftFrom: string, leftTo: string, rightFrom: string, rightTo: string) {
  return leftFrom <= rightTo && leftTo >= rightFrom;
}

/**
 * Update a payroll allocation separately from the actual payment date. For a
 * cash payment, operationDate is the linked RKO date; periodFrom/periodTo only
 * determine the payroll period being settled.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    if (!canManagePayroll(access.context.user.role)) {
      return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Некорректные данные выплаты" }, { status: 400 });
    }

    const periodFrom = typeof body.periodFrom === "string" ? body.periodFrom : "";
    const periodTo = typeof body.periodTo === "string" ? body.periodTo : "";
    const operationDate = typeof body.operationDate === "string" ? body.operationDate : "";
    const operationType = typeof body.operationType === "string" ? body.operationType : "SALARY";
    const comment = typeof body.comment === "string" ? body.comment.trim() : null;
    const amountCents = centsFromBody(body);

    if (!validDateKey(periodFrom) || !validDateKey(periodTo) || !validDateKey(operationDate) || periodFrom > periodTo) {
      return NextResponse.json({ error: "Укажите фактическую дату выплаты и корректный период зарплаты" }, { status: 400 });
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json({ error: "Сумма выплаты должна быть больше нуля" }, { status: 400 });
    }

    try {
      const existing = await getPayrollPaymentById(id);
      if (!existing) return NextResponse.json({ error: "Выплата не найдена" }, { status: 404 });

      if (operationType.toUpperCase() === "SALARY") {
        const summary = await getCachedPayrollSummary({
          dateFrom: periodFrom,
          dateTo: periodTo,
          targetLogin: existing.employeeId,
        });
        const normalizedEmployee = canonicalizeLogin(existing.employeeId).trim().toLowerCase();
        const row = Object.entries(summary.byLogin).find(([login]) => login.trim().toLowerCase() === normalizedEmployee)?.[1];
        if (!row) {
          return NextResponse.json({ error: "Расчёт сотрудника за период не найден" }, { status: 400 });
        }

        // The current payment is already included when its existing allocation
        // overlaps the edited period. Add it back once before validating the
        // replacement amount, otherwise a harmless correction would look like
        // an overpayment.
        const currentAmountInPeriod = existing.status === "ACTIVE" && periodsOverlap(
          existing.periodFrom,
          existing.periodTo,
          periodFrom,
          periodTo
        ) ? existing.amountCents : 0;
        if (amountCents > Math.max(0, row.remainingCents + currentAmountInPeriod)) {
          return NextResponse.json({ error: "Сумма выплаты больше суммы к выплате за выбранный период" }, { status: 400 });
        }
      }

      const payment = await updatePayrollPayment({
        id,
        periodFrom,
        periodTo,
        operationDate,
        operationType,
        amountCents,
        comment,
        updatedByLogin: access.context.user.login,
        updatedByName: access.context.user.name,
      });
      return NextResponse.json(payment);
    } catch (error) {
      console.error("Payroll payment update failed", error);
      const message = error instanceof Error ? error.message : "Не удалось изменить выплату";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  });
}
