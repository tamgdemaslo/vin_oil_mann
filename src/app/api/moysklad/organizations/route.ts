import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ensureDefaultOrganization } from "@/lib/organizations";

function organizationMeta(id: string) {
  return { href: `local://organization/${id}`, type: "organization", mediaType: "application/json" };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  await ensureDefaultOrganization();
  const organizations = await prisma.localOrganization.findMany({
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({
    organizations: organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      fullLegalName: organization.fullLegalName ?? "",
      isDefault: organization.isDefault,
      vatEnabled: organization.vatEnabled,
      defaultVatRate: organization.defaultVatRate,
      currency: organization.currency,
      meta: organizationMeta(organization.id),
    })),
  });
}
