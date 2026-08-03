import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listMannFilters } from "@/lib/mann-catalog";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const variantId = request.nextUrl.searchParams.get("variantId")?.trim() ?? "";
  const yearRaw = request.nextUrl.searchParams.get("year")?.trim() ?? "";
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : null;
  if (!variantId) return NextResponse.json({ error: "Укажите variantId" }, { status: 400 });

  return NextResponse.json({
    filters: await listMannFilters({
      variantId,
      make: request.nextUrl.searchParams.get("make"),
      model: request.nextUrl.searchParams.get("model"),
      year: Number.isFinite(year) ? year : null,
    }),
  });
}
