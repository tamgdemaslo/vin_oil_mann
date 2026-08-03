import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { reversePayrollAdjustment } from "@/lib/payroll-settlements";

function canManagePayroll(role: string) {
  return role === "owner" || role === "admin";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (!canManagePayroll(session.user.role)) {
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  try {
    const reversal = await reversePayrollAdjustment({
      id,
      reversedByLogin: session.user.login,
      comment: typeof body.comment === "string" ? body.comment : null,
    });
    return NextResponse.json(reversal);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отменить корректировку";
    const status = message.includes("не найд") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
