import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

function storeMeta(id: string) {
  return { href: `local://store/${id}`, type: "store", mediaType: "application/json" };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const stores = await prisma.localStore.findMany({
    where: { archived: false },
    orderBy: [{ isMain: "desc" }, { name: "asc" }],
  });

  return NextResponse.json({
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      isMain: store.isMain,
      meta: storeMeta(store.id),
    })),
  });
}
