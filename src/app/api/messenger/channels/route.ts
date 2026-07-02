import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listMessengerChannels } from "@/lib/messenger/messenger-gateway";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  return NextResponse.json({ channels: await listMessengerChannels() });
}
