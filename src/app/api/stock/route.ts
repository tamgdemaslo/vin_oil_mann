import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadLocalStockByAssortment } from "@/lib/local-inventory-read";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const storeName = request.nextUrl.searchParams.get("storeName") ?? "";
  const storeId = request.nextUrl.searchParams.get("storeId") ?? "";
  const assortmentHrefs = (request.nextUrl.searchParams.get("assortmentHrefs") ?? "")
    .split(",")
    .map((href) => href.trim())
    .filter(Boolean);

  if ((!storeName.trim() && !storeId.trim()) || assortmentHrefs.length === 0) {
    return NextResponse.json({ stockByAssortment: {} });
  }

  return NextResponse.json(await loadLocalStockByAssortment({ storeName, storeId, assortmentHrefs }));
}
