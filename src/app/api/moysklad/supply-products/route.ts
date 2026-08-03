import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchLocalProducts } from "@/lib/local-inventory-read";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  const search = (request.nextUrl.searchParams.get("search") ?? "").trim();
  const limit = Math.min(50, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "20", 10) || 20));

  if (search.length < 2) {
    return NextResponse.json({ products: [] });
  }

  const local = await searchLocalProducts({ search, limit });
  return NextResponse.json({
    products: local.products.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.article ?? row.code ?? "",
      price: row.cost ?? (row.buyPriceCents != null ? row.buyPriceCents / 100 : 0),
      salePrice: row.price,
      currency: row.currency,
      meta: row.meta,
    })),
  });
}
