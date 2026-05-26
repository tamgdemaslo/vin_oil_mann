import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

function organizationMeta(id: string) {
  return { href: `local://organization/${id}`, type: "organization", mediaType: "application/json" };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const organizations = await prisma.localOrganization.findMany({
    where: { isActive: true },
    orderBy: [{ name: "asc" }],
  });

  return NextResponse.json({
    organizations: organizations.map((organization) => ({
      id: organization.id,
      name: organization.name,
      meta: organizationMeta(organization.id),
    })),
  });
}
