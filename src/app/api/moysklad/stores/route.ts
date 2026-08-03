import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

function storeMeta(id: string) {
  return { href: `local://store/${id}`, type: "store", mediaType: "application/json" };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const organizationId = request.nextUrl.searchParams.get("organizationId")?.trim() ?? "";
  const stores = await prisma.localStore.findMany({
    where: {
      archived: false,
      ...(organizationId ? { OR: [{ organizationId }, { organizationId: null }] } : {}),
    },
    orderBy: [{ isMain: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      organizationId: store.organizationId,
      isMain: store.isMain,
      meta: storeMeta(store.id),
    })),
  });
}
