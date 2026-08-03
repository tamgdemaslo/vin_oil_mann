import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { testTBankIntegration } from "@/lib/tbank";

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  const result = await testTBankIntegration(session.user);
  if (!result.ok) return NextResponse.json({ error: result.error, integration: result.integration }, { status: result.status });
  return NextResponse.json(result);
}
