import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listMannVariants } from "@/lib/mann-catalog";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const make = request.nextUrl.searchParams.get("make")?.trim() ?? "";
  const model = request.nextUrl.searchParams.get("model")?.trim() ?? "";
  const yearRaw = request.nextUrl.searchParams.get("year")?.trim() ?? "";
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : null;
  if (!make || !model) return NextResponse.json({ error: "Укажите марку и модель" }, { status: 400 });

  return NextResponse.json({
    variants: await listMannVariants({ make, model, year: Number.isFinite(year) ? year : null }),
  });
}
