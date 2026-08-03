import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTBankIntegrationStatus, saveTBankIntegrationSettings } from "@/lib/tbank";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });
  return NextResponse.json(await getTBankIntegrationStatus());
}

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Необходима авторизация" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело запроса" }, { status: 400 });
  }

  const result = await saveTBankIntegrationSettings(body as Parameters<typeof saveTBankIntegrationSettings>[0], session.user);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.integration);
}
