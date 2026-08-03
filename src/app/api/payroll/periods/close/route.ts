import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logChange } from "@/lib/change-log";
import { closePayrollPeriod } from "@/lib/payroll-periods";

function validDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

  const body = await request.json();
  const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom : "";
  const dateTo = typeof body.dateTo === "string" ? body.dateTo : "";

  if (!validDateKey(dateFrom) || !validDateKey(dateTo) || dateFrom > dateTo) {
    return NextResponse.json({ error: "Укажите корректный период закрытия" }, { status: 400 });
  }

  try {
    const result = await closePayrollPeriod({
      dateFrom,
      dateTo,
      closedByLogin: session.user.login,
    });

    if (result.created) {
      await logChange({
        entityType: "payroll_period",
        entityId: result.period.id,
        action: "create",
        newValue: result.period,
        performedByLogin: session.user.login,
      });
    }

    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось закрыть период";
    const status = message.startsWith("Нельзя закрыть период") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
