import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";

function counterpartyMeta(id: string) {
  return { href: `local://counterparty/${id}`, type: "counterparty", mediaType: "application/json" };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10) || 50);
  const normalizedPhone = normalizePhoneKey(search);
  const searchOr = search
    ? [
        { name: { contains: search, mode: "insensitive" as const } },
        { phone: { contains: search, mode: "insensitive" as const } },
        { searchText: { contains: search.toLowerCase(), mode: "insensitive" as const } },
        ...(normalizedPhone ? [{ normalizedPhone: { contains: normalizedPhone, mode: "insensitive" as const } }] : []),
      ]
    : [];

  const counterparties = await prisma.localCounterparty.findMany({
    where: {
      archived: false,
      ...(searchOr.length ? { OR: searchOr } : {}),
    },
    orderBy: [{ name: "asc" }],
    take: limit,
  });

  return NextResponse.json({
    counterparties: counterparties.map((counterparty) => ({
      id: counterparty.id,
      name: counterparty.name,
      phone: counterparty.phone,
      normalizedPhone: counterparty.normalizedPhone,
      meta: counterpartyMeta(counterparty.id),
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: { name?: string; companyType?: string; email?: string; phone?: string; legalTitle?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "Укажите наименование контрагента" }, { status: 400 });

  const companyType =
    body.companyType === "entrepreneur" || body.companyType === "individual" ? body.companyType : "legal";
  const phone = body.phone?.trim() || "";
  const email = body.email?.trim() || "";
  const legalTitle = body.legalTitle?.trim() || "";

  const created = await prisma.localCounterparty.create({
    data: {
      name,
      companyType,
      phone: phone || null,
      email: email || null,
      legalTitle: legalTitle || null,
      normalizedPhone: normalizePhoneKey(phone),
      phonesRaw: phone ? [phone] : undefined,
      searchText: [name, phone, email, legalTitle, companyType].join(" ").toLowerCase(),
      raw: { source: "shipment-new" },
    },
  });

  return NextResponse.json({
    id: created.id,
    name: created.name,
    phone: created.phone,
    normalizedPhone: created.normalizedPhone,
    meta: counterpartyMeta(created.id),
  });
}
