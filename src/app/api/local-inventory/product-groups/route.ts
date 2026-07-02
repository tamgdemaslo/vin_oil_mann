import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listLocalProductGroups } from "@/lib/local-inventory-admin";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const includeArchived = request.nextUrl.searchParams.get("archived") === "1";
  const groups = await listLocalProductGroups({ includeArchived });
  return NextResponse.json({ groups });
}
