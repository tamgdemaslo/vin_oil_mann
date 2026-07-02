import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getIntegrationMessengerAccountHealth } from "@/lib/messenger/messenger-integrations";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const { id } = await params;
  const health = await getIntegrationMessengerAccountHealth(id, session.user);
  if (!health) return NextResponse.json({ error: "Messenger account не найден" }, { status: 404 });
  return NextResponse.json(health);
}
