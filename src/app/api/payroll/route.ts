import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
import { getCachedPayrollSummary } from "@/lib/payroll";

function isDatabaseUnavailable(error: unknown) {
  if (!(error instanceof Error)) return false;
  const m = error.message;
  return (
    m.includes("Can't reach database server") ||
    m.includes("P1001") ||
    m.includes("P1017") ||
    m.includes("Timed out fetching a new connection") ||
    m.includes("Server has closed the connection")
  );
}

/** Сообщения из расчёта зарплаты — можно показать пользователю без утечки стека. */
function clientSafePayrollErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const m = error.message;
  if (m.startsWith("Не удалось загрузить ")) return m;
  return null;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;

  // Payroll reads settlements, rates and shipment data. Keep every one of
  // those reads inside the same server-verified active-branch scope instead
  // of relying on an incidental async context from the session helper.
  return runWithBranchApiContext(access.context, async () => {
    const session = { user: access.context.user };
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get("dateFrom") ?? "";
    const dateTo = searchParams.get("dateTo") ?? "";
    const user = searchParams.get("user") ?? undefined;

    if (!dateFrom || !dateTo) {
      return NextResponse.json({ error: "Укажите dateFrom и dateTo (YYYY-MM-DD)" }, { status: 400 });
    }
    if (!isDateKey(dateFrom) || !isDateKey(dateTo)) {
      return NextResponse.json({ error: "Дата расчёта должна быть в формате YYYY-MM-DD" }, { status: 400 });
    }
    if (dateFrom > dateTo) {
      return NextResponse.json({ error: "Дата начала расчёта не может быть позже даты окончания" }, { status: 400 });
    }
    if (session.user.role !== "owner" && user && user !== session.user.login) {
      return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
    }

    const targetLogin = session.user.role === "owner" ? user : session.user.login;

    try {
      const summary = await getCachedPayrollSummary({
        dateFrom,
        dateTo,
        targetLogin,
      });
      return NextResponse.json(summary);
    } catch (error) {
      if (isDatabaseUnavailable(error)) {
        await sleep(1200);
        try {
          const summary = await getCachedPayrollSummary({
            dateFrom,
            dateTo,
            targetLogin,
          });
          return NextResponse.json(summary);
        } catch (retryError) {
          if (isDatabaseUnavailable(retryError)) {
            return NextResponse.json(
              { error: "Расчет временно недоступен: нет соединения с базой. Попробуйте еще раз через несколько секунд." },
              { status: 503 }
            );
          }
          console.error("Payroll retry failed", retryError);
          const detail = clientSafePayrollErrorMessage(retryError);
          return NextResponse.json(
            { error: detail ?? "Не удалось выполнить расчет зарплаты." },
            { status: detail ? 502 : 500 }
          );
        }
      }

      console.error("Payroll request failed", error);
      const detail = clientSafePayrollErrorMessage(error);
      return NextResponse.json(
        { error: detail ?? "Не удалось выполнить расчет зарплаты." },
        { status: detail ? 502 : 500 }
      );
    }
  });
}
