import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessCustomerAnalytics } from "@/lib/customer-analytics-access";
import { loadCustomerAnalyticsPayload } from "@/lib/customer-analytics";
import { getCustomerAnalyticsSettings } from "@/lib/customer-analytics-settings";

export const maxDuration = 300;
export const runtime = "nodejs";

function parseServices(param: string | null): string[] {
  if (!param?.trim()) return [];
  return param
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isDatabaseUnavailableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("can't reach database server") ||
    lower.includes("failed to connect") ||
    lower.includes("connection") ||
    lower.includes("closed")
  );
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
    }
    if (!canAccessCustomerAnalytics(session.user.role)) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const sp = request.nextUrl.searchParams;
    const dateFrom = sp.get("dateFrom")?.trim() || null;
    const dateTo = sp.get("dateTo")?.trim() || null;
    const services = parseServices(sp.get("services"));

    const settings = await getCustomerAnalyticsSettings();
    const payload = await loadCustomerAnalyticsPayload({
      dateFrom,
      dateTo,
      serviceIds: services,
      settings,
    });

    return NextResponse.json({ ...payload, settings });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Внутренняя ошибка аналитики";
    console.error("[analytics/customers GET]", e);
    return NextResponse.json(
      {
        error: message,
        hint: isDatabaseUnavailableError(message)
          ? "Сейчас нет соединения с базой данных Railway. Обычно помогает подождать 10-30 секунд и повторить запрос."
          : "Проверьте DATABASE_URL и выполните `npx prisma db push` и `npx prisma generate`. После обновления схемы нажмите «Обновить из МойСклад».",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  if (!canAccessCustomerAnalytics(session.user.role)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  let forceFull = false;
  let latestLimit: number | null = null;
  try {
    const body = (await request.json()) as { forceFull?: boolean; latestLimit?: number };
    forceFull = body?.forceFull === true;
    latestLimit =
      typeof body?.latestLimit === "number" && Number.isFinite(body.latestLimit) && body.latestLimit > 0
        ? Math.floor(body.latestLimit)
        : null;
  } catch {
    forceFull = false;
    latestLimit = null;
  }

  const { startCustomerAnalyticsSync } = await import("@/lib/moysklad-customer-analytics-sync");
  const started = startCustomerAnalyticsSync({
    forceFull,
    latestLimit: latestLimit ?? undefined,
    replaceSnapshot: latestLimit != null,
  });
  return NextResponse.json({
    ok: true,
    started: started.started,
    forceFull,
    latestLimit,
    sync: started.status,
  });
}
