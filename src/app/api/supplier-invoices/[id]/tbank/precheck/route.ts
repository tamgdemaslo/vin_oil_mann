import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { precheckTBankDraft } from "@/lib/tbank";

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
  return NextResponse.json(await precheckTBankDraft(id, body as Parameters<typeof precheckTBankDraft>[1], session.user));
}
