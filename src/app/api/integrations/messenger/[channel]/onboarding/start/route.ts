import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { startIntegrationOnboarding } from "@/lib/messenger/messenger-integrations";

export const dynamic = "force-dynamic";

async function requireOwner() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (session.user.role !== "owner") {
    return { response: NextResponse.json({ error: "Только владелец может подключать интеграции" }, { status: 403 }) };
  }
  return { session };
}

export async function POST(_request: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const auth = await requireOwner();
  if ("response" in auth) return auth.response;
  const { channel } = await params;
  try {
    return NextResponse.json(await startIntegrationOnboarding(channel, auth.session.user));
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Не удалось начать подключение канала" },
      { status: 400 }
    );
  }
}
