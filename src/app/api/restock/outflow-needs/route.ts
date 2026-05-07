import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clearRestockCatalogCache, loadOutflowNeedsItems } from "@/lib/moysklad-restock";

const NOTE =
  "Расход за выбранный период; критерий «заказать» — по текущим остаткам (не снимок на конец дня).";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const refresh = sp.get("refresh") === "1" || sp.get("refresh") === "true";
  const pageLimit = Math.min(1000, Math.max(1, parseInt(sp.get("page_limit") ?? "500", 10) || 500));
  const maxPages = Math.min(200, Math.max(1, parseInt(sp.get("max_pages") ?? "10", 10) || 10));
  const dateFrom = (sp.get("date_from") ?? "").trim() || null;
  const dateTo = (sp.get("date_to") ?? "").trim() || null;

  if ((dateFrom && !dateTo) || (!dateFrom && dateTo)) {
    return NextResponse.json(
      { error: "Укажите оба параметра date_from и date_to, либо не указывайте ни одного (тогда — сегодня)." },
      { status: 400 }
    );
  }

  if (dateFrom && dateTo) {
    const df = new Date(`${dateFrom}T00:00:00Z`);
    const dt = new Date(`${dateTo}T00:00:00Z`);
    if (Number.isNaN(df.getTime()) || Number.isNaN(dt.getTime())) {
      return NextResponse.json({ error: "Некорректный формат date_from/date_to (нужно YYYY-MM-DD)" }, { status: 400 });
    }
    if (df > dt) {
      return NextResponse.json({ error: "date_from не может быть позже date_to" }, { status: 400 });
    }
    const maxDays = Math.max(1, parseInt(process.env.RESTOCK_SPEND_MAX_DAYS ?? "370", 10) || 370);
    const days = (dt.getTime() - df.getTime()) / (24 * 60 * 60 * 1000) + 1;
    if (days > maxDays) {
      return NextResponse.json({ error: `Слишком длинный период: максимум ${maxDays} дней` }, { status: 400 });
    }
  }

  try {
    if (refresh) clearRestockCatalogCache();
    const data = await loadOutflowNeedsItems({
      refresh,
      pageLimit,
      maxPages,
      dateFrom,
      dateTo,
    });

    const tz = process.env.APP_TIMEZONE?.trim() || "Europe/Moscow";

    return NextResponse.json({
      ok: true,
      rule: "below_min_with_period_outflow",
      timezone: tz,
      dateLabel: data.dateLabel,
      dateFrom: data.dateFrom,
      dateTo: data.dateTo,
      momentFrom: data.momentFrom,
      momentTo: data.momentTo,
      note: NOTE,
      items: data.items,
      fetchedRows: data.fetchedRows,
      catalogSize: data.catalogSize,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, rule: "below_min_with_period_outflow" }, { status: 502 });
  }
}
