import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getMessengerMediaHealth } from "@/lib/messenger/messenger-media";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  return NextResponse.json(await getMessengerMediaHealth());
}
