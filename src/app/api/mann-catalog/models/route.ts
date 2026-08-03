import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listMannModels } from "@/lib/mann-catalog";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const make = request.nextUrl.searchParams.get("make")?.trim() ?? "";
  if (!make) return NextResponse.json({ error: "Укажите марку" }, { status: 400 });

  return NextResponse.json({ models: await listMannModels(make) });
}
