import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";

type ProductRow = {
  id: string;
  name: string;
  code?: string;
  article?: string;
  meta: { href: string; type: string; mediaType: string };
  buyPrice?: { value?: number; currency?: { name?: string } };
  salePrices?: { value?: number; currency?: { name?: string } }[];
};

function moneyFromCents(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value / 100 : 0;
}

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

  const qs = new URLSearchParams();
  qs.set("search", search);
  qs.set("limit", String(limit));
  qs.set("filter", "archived=false");

  const result = await moyskladFetch<{ rows?: ProductRow[] }>(
    `/entity/product?${qs.toString()}`,
    { cache: "no-store" }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  const products = (result.data.rows ?? []).map((row) => {
    const buyPrice = moneyFromCents(row.buyPrice?.value);
    const salePrice = moneyFromCents(row.salePrices?.[0]?.value);
    return {
      id: row.id,
      name: row.name,
      code: row.article ?? row.code ?? "",
      price: buyPrice,
      salePrice,
      currency: row.buyPrice?.currency?.name ?? row.salePrices?.[0]?.currency?.name ?? "руб.",
      meta: row.meta,
    };
  });

  return NextResponse.json({ products });
}
