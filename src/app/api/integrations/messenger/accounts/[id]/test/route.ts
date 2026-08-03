import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { testIntegrationMessengerAccount } from "@/lib/messenger/messenger-integrations";

export const dynamic = "force-dynamic";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (session.user.role !== "owner") return NextResponse.json({ error: "Только владелец может проверять интеграции" }, { status: 403 });
  const { id } = await params;
  const result = await testIntegrationMessengerAccount(id, session.user);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
