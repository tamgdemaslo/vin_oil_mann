import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { reversePayrollPayment } from "@/lib/payroll-settlements";

function canManagePayroll(role: string) {
  return role === "owner" || role === "admin";
}

export async function POST(
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
    const body = await request.json().catch(() => ({}));

    try {
      const payment = await reversePayrollPayment({
        id,
        reversedByLogin: access.context.user.login,
        comment: typeof body.comment === "string" ? body.comment : null,
      });
      return NextResponse.json(payment);
    } catch (error) {
      console.error("Payroll payment reversal failed", error);
      const message = error instanceof Error ? error.message : "Не удалось отменить выплату";
      const status = message.includes("не найд") ? 404 : 400;
      return NextResponse.json({ error: message }, { status });
    }
  });
}
