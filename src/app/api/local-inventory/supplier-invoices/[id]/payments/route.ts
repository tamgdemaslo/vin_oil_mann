import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createLocalSupplierInvoicePayment } from "@/lib/local-inventory-admin";

export async function POST(
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
  const result = await createLocalSupplierInvoicePayment(
    id,
    body as Parameters<typeof createLocalSupplierInvoicePayment>[1],
    session.user
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, cashShiftClosed: "cashShiftClosed" in result ? result.cashShiftClosed : false },
      { status: "notFound" in result && result.notFound ? 404 : 400 }
    );
  }
  return NextResponse.json(result.invoice);
}
