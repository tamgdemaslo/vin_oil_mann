import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { moyskladFetch } from "@/lib/moysklad";

type Row = { id: string; name: string; meta: { href: string; type: string; mediaType: string } };

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  const result = await moyskladFetch<{ rows: Row[] }>("/entity/organization?limit=100");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  const list = (result.data.rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    meta: r.meta,
  }));
  return NextResponse.json({ organizations: list });
}
