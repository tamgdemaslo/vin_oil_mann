import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { type CreateDemandBody } from "@/lib/demand-create-payload";
import { createLocalDemand } from "@/lib/local-demand-write";
import { loadLocalDemandList } from "@/lib/local-inventory-read";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);

  return NextResponse.json(await loadLocalDemandList({ search, limit, offset }));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: CreateDemandBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  if (!body.organization?.meta?.href || !body.agent?.meta?.href || !body.store?.meta?.href) {
    return NextResponse.json({ error: "Укажите организацию, контрагента и склад" }, { status: 400 });
  }

  const created = await createLocalDemand(body, { ecoUserName: session.user.name || session.user.login });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 400 });

  return NextResponse.json(created);
}
