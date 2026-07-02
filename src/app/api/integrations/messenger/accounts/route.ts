import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listIntegrationMessengerAccounts } from "@/lib/messenger/messenger-integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  if (session.user.role !== "owner" && session.user.role !== "admin") {
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  }
  const accounts = await listIntegrationMessengerAccounts(session.user);
  return NextResponse.json({ accounts });
}
