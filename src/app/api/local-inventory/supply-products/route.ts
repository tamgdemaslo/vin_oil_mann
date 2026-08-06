import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchLocalProducts } from "@/lib/local-inventory-read";

export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const search = (request.nextUrl.searchParams.get("search") ?? "").trim();
  if (search.length < 2) return NextResponse.json({ products: [] });
  const rows = await searchLocalProducts({ search, limit: Math.min(50, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10) || 20)) });
  return NextResponse.json({ products: rows.products.map((row) => ({ id: row.id, name: row.name, code: row.article ?? row.code ?? "", price: row.cost ?? (row.buyPriceCents != null ? row.buyPriceCents / 100 : 0), salePrice: row.price, currency: row.currency, meta: row.meta })) });
}
