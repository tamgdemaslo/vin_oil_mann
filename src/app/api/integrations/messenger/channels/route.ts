import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listIntegrationMessengerChannels } from "@/lib/messenger/messenger-integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const channels = await listIntegrationMessengerChannels(session.user);
  return NextResponse.json({ channels });
}
