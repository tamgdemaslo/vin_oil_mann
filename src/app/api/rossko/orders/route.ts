import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rosskoConfig, rosskoOrders } from "@/lib/rossko";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }

  const raw = (request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 20);
  const ids = raw.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0);
  if (!ids.length) {
    return NextResponse.json({ error: "ids должен содержать номера заказов через запятую" }, { status: 400 });
  }

  try {
    const data = await rosskoOrders(rosskoConfig(), ids);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
