import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";

type Row = { id: string; name: string; meta: { href: string; type: string; mediaType: string } };

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(1000, parseInt(request.nextUrl.searchParams.get("limit") ?? "200", 10) || 200);
  const path = search.trim()
    ? `/entity/expenseitem?search=${encodeURIComponent(search.trim())}&limit=${limit}`
    : `/entity/expenseitem?limit=${limit}`;
  const result = await moyskladFetch<{ rows: Row[] }>(path);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  const list = (result.data.rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    meta: r.meta,
  }));
  return NextResponse.json({ expenseItems: list });
}
