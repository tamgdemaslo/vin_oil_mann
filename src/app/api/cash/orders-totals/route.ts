import { NextRequest, NextResponse } from "next/server";
import { getCurrentShift } from "@/lib/cashbox";
import { getOrdersTotalsForDate } from "@/lib/aqsi";
import { toLocalDateString } from "@/lib/time";
import { requireBranchApi, runWithBranchApiContext } from "@/lib/branch-api";

export async function GET(request: NextRequest) {
  const access = await requireBranchApi({ allowAll: false, requireActive: true });
  if (!access.ok) return access.response;
  return runWithBranchApiContext(access.context, async () => {
  try {
    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");

    const currentShift = await getCurrentShift();
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

    const totals = await getOrdersTotalsForDate({ serviceDate, timezone, registerId: currentShift?.aqsiRegisterId });

    return NextResponse.json({
      date: serviceDate,
      timezone,
      cashTotal: totals.cashTotal,
      cardTotal: totals.cardTotal,
      ...(totals.cashTotal === 0 && totals.cardTotal === 0
        ? { hint: "Суммы 0. Проверьте путь чеков в настройках AQSI и наличие чеков за эту дату." }
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
  });
}
