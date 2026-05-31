import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateLocalSupplierInvoiceStatus } from "@/lib/local-inventory-admin";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const { id } = await params;
  const result = await updateLocalSupplierInvoiceStatus(id, body.status ?? "", session.user);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: "notFound" in result && result.notFound ? 404 : 400 });
  }
  return NextResponse.json(result.invoice);
}
