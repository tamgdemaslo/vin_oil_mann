import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
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

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходимо войти" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const user = searchParams.get("user") ?? undefined;

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "Укажите dateFrom и dateTo (YYYY-MM-DD)" }, { status: 400 });
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
}
