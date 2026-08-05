import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { calculateEmployeePayrollSummary, type PersonalPayrollPeriod } from "@/lib/dashboard-my-payroll";

export const dynamic = "force-dynamic";

const PERIODS = new Set<PersonalPayrollPeriod>(["today", "week", "month", "custom"]);

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  const branch = access.context;
  if (!branch.branchId || !branch.branch) {
    return NextResponse.json({ error: "Выберите конкретный филиал" }, { status: 409 });
  }

  const { searchParams } = new URL(request.url);
  const requestedPeriod = searchParams.get("period") ?? "today";
  if (!PERIODS.has(requestedPeriod as PersonalPayrollPeriod)) {
    return NextResponse.json({ error: "Неизвестный период расчёта" }, { status: 400 });
  }

  try {
    return await runWithBranchApiContext(branch, async () => {
      const payload = await calculateEmployeePayrollSummary({
        employeeLogin: branch.user.login,
        timeZone: branch.branch?.timezone ?? "Europe/Kaliningrad",
        query: {
          period: requestedPeriod as PersonalPayrollPeriod,
          dateFrom: searchParams.get("dateFrom"),
          dateTo: searchParams.get("dateTo"),
        },
      });
      return NextResponse.json(payload);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const isInputError = message.startsWith("Для произвольного") || message.startsWith("Дата начала") || message.startsWith("Произвольный период");
    if (isInputError) return NextResponse.json({ error: message }, { status: 400 });
    console.error("Employee dashboard payroll request failed", error);
    return NextResponse.json({ error: "Не удалось загрузить расчёт. Обновите данные." }, { status: 500 });
  }
}
