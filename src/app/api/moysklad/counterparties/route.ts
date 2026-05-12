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
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50);
  const path = search.trim()
    ? `/entity/counterparty?search=${encodeURIComponent(search.trim())}&limit=${limit}`
    : `/entity/counterparty?limit=${limit}`;
  const result = await moyskladFetch<{ rows: Row[] }>(path);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  const list = (result.data.rows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    meta: r.meta,
  }));
  return NextResponse.json({ counterparties: list });
}

/** Создание контрагента в МойСклад. Обязательно: name. Опционально: companyType (legal | entrepreneur | individual), email, phone, legalTitle */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  }
  let body: { name?: string; companyType?: string; email?: string; phone?: string; legalTitle?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "Укажите наименование контрагента" }, { status: 400 });
  }
  const payload: Record<string, string> = { name };
  if (body.companyType === "entrepreneur" || body.companyType === "individual") {
    payload.companyType = body.companyType;
  } else {
    payload.companyType = "legal"; // Юридическое лицо по умолчанию
  }
  if (typeof body.email === "string" && body.email.trim()) payload.email = body.email.trim();
  if (typeof body.phone === "string" && body.phone.trim()) payload.phone = body.phone.trim();
  if (typeof body.legalTitle === "string" && body.legalTitle.trim()) payload.legalTitle = body.legalTitle.trim();

  const result = await moyskladFetch<{ id: string; name: string; meta: { href: string; type: string; mediaType: string } }>(
    "/entity/counterparty",
    { method: "POST", body: JSON.stringify(payload) }
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({
    id: result.data.id,
    name: result.data.name,
    meta: result.data.meta,
  });
}
