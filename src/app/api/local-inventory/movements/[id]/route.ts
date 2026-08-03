import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateLocalStockDocument } from "@/lib/local-inventory-admin";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateLocalStockDocument(
    id,
    body as Parameters<typeof updateLocalStockDocument>[1],
    session.user
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
  }
  return NextResponse.json(result.document);
}
