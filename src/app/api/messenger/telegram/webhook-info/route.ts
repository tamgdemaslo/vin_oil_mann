import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getWebhookInfo } from "@/lib/messenger/channels/telegram";

async function requireIntegrationManager() {
  const session = await getSession();
  if (!session) return { response: NextResponse.json({ error: "Необходима авторизация" }, { status: 401 }) };
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  }
  return { session };
}

export async function GET() {
  const auth = await requireIntegrationManager();
  if ("response" in auth) return auth.response;
  return NextResponse.json(await getWebhookInfo());
}
