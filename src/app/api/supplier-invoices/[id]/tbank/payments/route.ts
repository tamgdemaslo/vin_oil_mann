import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listTBankPayments } from "@/lib/tbank";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const { id } = await params;
  const result = await listTBankPayments(id, session.user);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
