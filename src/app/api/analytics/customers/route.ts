import { NextRequest, NextResponse } from "next/server";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";
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
    const branchAccess = await requireBranchApi({ allowAll: false, requireActive: true });
    if (!branchAccess.ok) return branchAccess.response;
    if (!canAccessCustomerAnalytics(branchAccess.context.user.role)) {
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    }

    const sp = request.nextUrl.searchParams;
    const dateFrom = sp.get("dateFrom")?.trim() || null;
    const dateTo = sp.get("dateTo")?.trim() || null;
    const services = parseServices(sp.get("services"));
    const inactiveDays = Number(sp.get("inactiveDays") ?? "");

    const result = await runWithBranchApiContext(branchAccess.context, async () => {
      const settings = await getCustomerAnalyticsSettings();
      const resolvedSettings = {
        ...settings,
        inactiveDaysThreshold:
          Number.isFinite(inactiveDays) && inactiveDays > 0 ? Math.floor(inactiveDays) : settings.inactiveDaysThreshold,
      };
      const payload = await loadCustomerAnalyticsPayload({
        dateFrom,
        dateTo,
        serviceIds: services,
        settings: resolvedSettings,
      });
      return { payload, settings: resolvedSettings };
    });

    return NextResponse.json({
      ...result.payload,
      settings: result.settings,
    });
  } catch (e) {
    console.error("[analytics/customers GET]", e);
    const debug = process.env.NODE_ENV !== "production" || request.nextUrl.searchParams.get("debug") === "1";
    return NextResponse.json(safeAnalyticsError(e, debug), { status: 500 });
  }
}
