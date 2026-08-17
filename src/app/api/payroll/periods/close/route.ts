import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { logChange } from "@/lib/change-log";
import { closePayrollPeriod } from "@/lib/payroll-periods";

function validDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export async function POST(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  return runWithBranchApiContext(access.context, async () => {
    if (access.context.user.role !== "owner") return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });

    const body = await request.json().catch(() => null);
    const dateFrom = body && typeof body.dateFrom === "string" ? body.dateFrom : "";
    const dateTo = body && typeof body.dateTo === "string" ? body.dateTo : "";

    if (!validDateKey(dateFrom) || !validDateKey(dateTo) || dateFrom > dateTo) {
      return NextResponse.json({ error: "Укажите корректный период закрытия" }, { status: 400 });
    }

    try {
      const result = await closePayrollPeriod({
        dateFrom,
        dateTo,
        closedByLogin: access.context.user.login,
      });

      if (result.created) {
        await logChange({
          entityType: "payroll_period",
          entityId: result.period.id,
          action: "create",
          newValue: result.period,
          performedByLogin: access.context.user.login,
        });
      }

      return NextResponse.json(result, { status: result.created ? 201 : 200 });
    } catch (error) {
      console.error("Payroll period close failed", error);
      const message = error instanceof Error ? error.message : "Не удалось закрыть период";
      const status = message.startsWith("Нельзя закрыть период") ? 409 : 500;
      return NextResponse.json({ error: message }, { status });
    }
  });
}
