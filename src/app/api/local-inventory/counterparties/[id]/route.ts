import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateLocalAdminCounterparty } from "@/lib/local-inventory-admin";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const result = await updateLocalAdminCounterparty(id, body as Parameters<typeof updateLocalAdminCounterparty>[1]);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
  }
  return NextResponse.json(result.counterparty);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id не указан" }, { status: 400 });

  const result = await updateLocalAdminCounterparty(id, { archived: true });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.notFound ? 404 : 400 });
  }
  return NextResponse.json(result.counterparty);
}
