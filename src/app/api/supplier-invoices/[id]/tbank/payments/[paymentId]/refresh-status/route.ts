import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { refreshTBankPaymentStatus } from "@/lib/tbank";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; paymentId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const { id, paymentId } = await params;
  const result = await refreshTBankPaymentStatus(id, paymentId, session.user);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
