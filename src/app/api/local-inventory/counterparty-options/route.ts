import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireBranchApi } from "@/lib/branch-api";
import { prisma } from "@/lib/db";
import { normalizePhoneKey } from "@/lib/phone-normalize";

const meta = (id: string) => ({ href: `local://counterparty/${id}`, type: "counterparty", mediaType: "application/json" });
export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi({ requireActive: false }); if (!access.ok) return access.response;
  const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
  const phone = normalizePhoneKey(search);
  const filters = search ? [{ name: { contains: search, mode: "insensitive" as const } }, { phone: { contains: search, mode: "insensitive" as const } }, { searchText: { contains: search.toLowerCase(), mode: "insensitive" as const } }, ...(phone ? [{ normalizedPhone: { contains: phone, mode: "insensitive" as const } }] : [])] : [];
  const rows = await prisma.localCounterparty.findMany({ where: { branchId: access.context.branchId!, archived: false, ...(filters.length ? { OR: filters } : {}) }, orderBy: { name: "asc" }, take: Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10) || 30) });
  return NextResponse.json({ counterparties: rows.map((row) => ({ id: row.id, name: row.name, phone: row.phone, normalizedPhone: row.normalizedPhone, companyType: row.companyType, counterpartyTypeName: row.counterpartyTypeName, legalTitle: row.legalTitle, meta: meta(row.id) })) });
}
export async function POST(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const access = await requireBranchApi(); if (!access.ok) return access.response;
  const body = await request.json().catch(() => null) as { name?: string; companyType?: string; email?: string; phone?: string; legalTitle?: string } | null;
  const name = body?.name?.trim(); if (!name) return NextResponse.json({ error: "Укажите наименование контрагента" }, { status: 400 });
  const phone = body?.phone?.trim() || "";
  const row = await prisma.localCounterparty.create({ data: { branchId: access.context.branchId!, name, companyType: body?.companyType === "entrepreneur" || body?.companyType === "individual" ? body.companyType : "legal", phone: phone || null, email: body?.email?.trim() || null, legalTitle: body?.legalTitle?.trim() || null, normalizedPhone: normalizePhoneKey(phone), phonesRaw: phone ? [phone] : undefined, searchText: [name, phone, body?.email, body?.legalTitle].filter(Boolean).join(" ").toLowerCase(), raw: { source: "local" } } });
  return NextResponse.json({ id: row.id, name: row.name, phone: row.phone, normalizedPhone: row.normalizedPhone, companyType: row.companyType, counterpartyTypeName: row.counterpartyTypeName, legalTitle: row.legalTitle, meta: meta(row.id) });
}
