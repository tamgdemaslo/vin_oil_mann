import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canAccessCustomerAnalytics } from "@/lib/customer-analytics-access";
import {
  getCustomerAnalyticsSyncStatus,
  getPersistedCustomerAnalyticsSyncStatus,
} from "@/lib/moysklad-customer-analytics-sync";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  if (!canAccessCustomerAnalytics(session.user.role)) {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }

  try {
    return NextResponse.json({ sync: await getPersistedCustomerAnalyticsSyncStatus() });
  } catch (e) {
    const fallback = getCustomerAnalyticsSyncStatus();
    return NextResponse.json({
      sync: {
        ...fallback,
        phase: fallback.isRunning ? fallback.phase : "error",
        error: e instanceof Error ? e.message : "Не удалось получить статус синхронизации",
        message: fallback.isRunning
          ? fallback.message ?? "Синхронизация выполняется, но статус из БД временно недоступен"
          : "Статус синхронизации временно недоступен: нет соединения с БД",
      },
    });
  }
}
