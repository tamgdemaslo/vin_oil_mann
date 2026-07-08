import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { markSupplierInvoicePaidManually } from "@/lib/tbank";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const { id } = await params;
  const result = await markSupplierInvoicePaidManually(id, session.user, body as Parameters<typeof markSupplierInvoicePaidManually>[2]);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.invoice);
}
