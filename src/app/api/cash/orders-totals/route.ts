import { NextRequest, NextResponse } from "next/server";
import { getCurrentShift, requireSessionUser } from "@/lib/cashbox";
import { getOrdersTotalsForDate } from "@/lib/aqsi";
import { toLocalDateString } from "@/lib/time";

export async function GET(request: NextRequest) {
  try {
    await requireSessionUser();
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");

    const currentShift = getCurrentShift();
    const serviceDate =
      dateParam?.trim() ||
      currentShift?.serviceDate ||
      toLocalDateString(new Date());
    const timezone =
      currentShift?.timezone ||
      process.env.SERVICE_TIMEZONE?.trim() ||
      process.env.APP_TIMEZONE?.trim() ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "Europe/Moscow";

    const totals = await getOrdersTotalsForDate({ serviceDate, timezone });

    return NextResponse.json({
      date: serviceDate,
      timezone,
      cashTotal: totals.cashTotal,
      cardTotal: totals.cardTotal,
      ...(totals.cashTotal === 0 && totals.cardTotal === 0
        ? { hint: "Суммы 0. Проверьте AQSI_ORDERS_PATH в .env.local и что в AQSI есть чеки за эту дату." }
        : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Ошибка сервера";
    const normalized = msg.toLowerCase();
    const status = normalized.includes("требуется авторизация")
      ? 401
      : normalized.includes("не настроен")
        ? 400
        : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
