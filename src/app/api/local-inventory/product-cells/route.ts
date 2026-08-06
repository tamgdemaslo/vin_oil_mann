import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadLocalProductCells } from "@/lib/local-inventory-read";

export async function GET(request: NextRequest) {
  if (!(await getSession())) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const ids = (request.nextUrl.searchParams.get("hrefs") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return NextResponse.json(await loadLocalProductCells([...new Set(ids)]));
}
