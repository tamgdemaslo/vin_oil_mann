import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createLocalStockDocument,
  listLocalStockDocuments,
} from "@/lib/local-inventory-admin";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const type = request.nextUrl.searchParams.get("type") ?? "";
  const search = request.nextUrl.searchParams.get("search") ?? "";
  const limit = Math.min(100, parseInt(request.nextUrl.searchParams.get("limit") ?? "30", 10) || 30);
  const offset = Math.max(0, parseInt(request.nextUrl.searchParams.get("offset") ?? "0", 10) || 0);

  return NextResponse.json(await listLocalStockDocuments({ type, search, limit, offset }));
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const result = await createLocalStockDocument(body as Parameters<typeof createLocalStockDocument>[0], session.user);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result.document);
}
