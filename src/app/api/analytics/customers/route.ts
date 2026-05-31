import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessCustomerAnalytics } from "@/lib/customer-analytics-access";
import { loadCustomerAnalyticsPayload } from "@/lib/customer-analytics";
import { getCustomerAnalyticsSettings } from "@/lib/customer-analytics-settings";
import { isMoySkladSyncEnabled, moyskladDisabledMessage } from "@/lib/moysklad-flags";

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

function safeAnalyticsError(error: unknown, debug: boolean): { error: string; hint: string; debug?: string } {
  const message = error instanceof Error ? error.message : "Внутренняя ошибка аналитики";
  if (isDatabaseUnavailableError(message)) {
    return {
      error: "Не удалось загрузить аналитику клиентов",
      hint: "Проверьте локальную базу и повторите попытку.",
      ...(debug ? { debug: message } : {}),
    };
  }
  return {
    error: "Не удалось загрузить аналитику клиентов",
    hint: "Локальные данные доступны только после применения схемы БД и импорта/создания отгрузок.",
    ...(debug ? { debug: message } : {}),
  };
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
    const inactiveDays = Number(sp.get("inactiveDays") ?? "");

    const settings = await getCustomerAnalyticsSettings();
    const payload = await loadCustomerAnalyticsPayload({
      dateFrom,
      dateTo,
      serviceIds: services,
      settings: {
        ...settings,
        inactiveDaysThreshold:
          Number.isFinite(inactiveDays) && inactiveDays > 0 ? Math.floor(inactiveDays) : settings.inactiveDaysThreshold,
      },
    });

    return NextResponse.json({
      ...payload,
      settings: {
        ...settings,
        inactiveDaysThreshold:
          Number.isFinite(inactiveDays) && inactiveDays > 0 ? Math.floor(inactiveDays) : settings.inactiveDaysThreshold,
      },
    });
  } catch (e) {
    console.error("[analytics/customers GET]", e);
    const debug = process.env.NODE_ENV !== "production" || request.nextUrl.searchParams.get("debug") === "1";
    return NextResponse.json(safeAnalyticsError(e, debug), { status: 500 });
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
  if (!isMoySkladSyncEnabled()) {
    return NextResponse.json({
      ok: false,
      started: false,
      sync: null,
      error: moyskladDisabledMessage("sync"),
    });
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
