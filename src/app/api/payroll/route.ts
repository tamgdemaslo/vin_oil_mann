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

function isDatabaseSchemaOutdated(error: unknown) {
  if (!(error instanceof Error)) return false;
  const candidate = error as Error & { code?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = error.message.toLowerCase();
  return (
    code === "P2021" ||
    code === "P2022" ||
    (code === "P2010" && (message.includes("does not exist") || message.includes("undefined_column"))) ||
    message.includes("undefined_column")
  );
}

/** Сообщения из расчёта зарплаты — можно показать пользователю без утечки стека. */
function clientSafePayrollErrorMessage(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const m = error.message;
  if (m.startsWith("Не удалось загрузить ")) return m;
  return null;
}

function payrollErrorReference() {
  return `PAY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function payrollFailureResponse(error: unknown, logMessage: string) {
  const reference = payrollErrorReference();
  console.error(`${logMessage} [${reference}]`, error);

  if (isDatabaseSchemaOutdated(error)) {
    return NextResponse.json(
      {
        error:
          `Расчёт временно недоступен: данные зарплаты на сервере требуют обновления. Код обращения: ${reference}.`,
      },
      { status: 503 }
    );
  }

  const detail = clientSafePayrollErrorMessage(error);
  return NextResponse.json(
    {
      error: detail ?? `Не удалось выполнить расчёт зарплаты. Код обращения: ${reference}.`,
    },
    { status: detail ? 502 : 500 }
  );
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
          const reference = payrollErrorReference();
          console.error(`Payroll database retry failed [${reference}]`, retryError);
          return NextResponse.json(
            {
              error:
                `Расчёт временно недоступен: нет соединения с базой. Попробуйте ещё раз через несколько секунд. Код обращения: ${reference}.`,
            },
            { status: 503 }
          );
        }
        return payrollFailureResponse(retryError, "Payroll retry failed");
      }
    }

    return payrollFailureResponse(error, "Payroll request failed");
  }
}
