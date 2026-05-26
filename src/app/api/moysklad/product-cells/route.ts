import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadLocalProductCells } from "@/lib/local-inventory-read";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const hrefs = (request.nextUrl.searchParams.get("hrefs") ?? "")
    .split(",")
    .map((href) => href.trim())
    .filter(Boolean);

  return NextResponse.json(await loadLocalProductCells([...new Set(hrefs)]));
}
