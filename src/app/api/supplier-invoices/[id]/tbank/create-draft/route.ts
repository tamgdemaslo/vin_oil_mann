import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createTBankDraft } from "@/lib/tbank";

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
  const result = await createTBankDraft(id, body as Parameters<typeof createTBankDraft>[1], session.user);
  if (!result.ok) return NextResponse.json({ error: result.errors?.[0] ?? "Не удалось создать черновик T-Bank", ...result }, { status: result.status });
  return NextResponse.json(result);
}
