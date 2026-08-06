import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureDefaultOrganization } from "@/lib/organizations";

export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  await ensureDefaultOrganization();
  const rows = await prisma.localOrganization.findMany({ where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  return NextResponse.json({ organizations: rows.map((row) => ({ id: row.id, name: row.name, fullLegalName: row.fullLegalName ?? "", isDefault: row.isDefault, vatEnabled: row.vatEnabled, defaultVatRate: row.defaultVatRate, currency: row.currency, meta: { href: `local://organization/${row.id}`, type: "organization", mediaType: "application/json" } })) });
}
