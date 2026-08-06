import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchLocalProducts } from "@/lib/local-inventory-read";

export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const search = request.nextUrl.searchParams.get("search") ?? "";
  const oem = request.nextUrl.searchParams.get("oem") ?? "";
  const mannName = request.nextUrl.searchParams.get("mannName") ?? "";
  const params = request.nextUrl.searchParams.get("params") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10));
  const result = await searchLocalProducts({ search, oem, mannName, params, limit: limit + offset });
  const rows = result.products.slice(offset, offset + limit).map((row) => ({
    id: row.id, name: row.name, meta: row.meta, price: row.price, currency: row.currency,
    stock: row.stockQuantity ?? 0, reserve: row.reserveQuantity ?? 0, quantity: row.availableQuantity ?? row.stockQuantity ?? 0,
  }));
  return NextResponse.json({ rows, total: result.products.length });
}
