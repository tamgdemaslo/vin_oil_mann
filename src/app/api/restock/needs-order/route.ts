import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { clearRestockCatalogCache, loadNeedsOrderItems } from "@/lib/moysklad-restock";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const refresh = sp.get("refresh") === "1" || sp.get("refresh") === "true";
  const pageLimit = Math.min(1000, Math.max(1, parseInt(sp.get("page_limit") ?? "500", 10) || 500));
  const maxPages = Math.min(200, Math.max(1, parseInt(sp.get("max_pages") ?? "10", 10) || 10));

  try {
    if (refresh) clearRestockCatalogCache();
    const { items, fetchedRows, catalogSize } = await loadNeedsOrderItems({
      refresh,
      pageLimit,
      maxPages,
    });
    return NextResponse.json({
      ok: true,
      rule: "below_min",
      items,
      fetchedRows,
      catalogSize,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, rule: "below_min" }, { status: 502 });
  }
}
