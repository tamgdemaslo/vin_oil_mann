import { NextRequest, NextResponse } from "next/server";
import { ingestTelegramWebhook } from "@/lib/messenger/messenger-gateway";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as unknown;
  if (!payload) return NextResponse.json({ ok: false, accepted: false, error: "empty webhook payload" }, { status: 400 });

  try {
    const result = await ingestTelegramWebhook(payload, request.headers);
    return NextResponse.json(result, { status: result.accepted || result.ok ? 200 : 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "telegram webhook failed";
    const status = message === "Invalid Telegram webhook secret" ? 403 : 400;
    return NextResponse.json({ ok: false, accepted: false, error: message }, { status });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    channel: "telegram",
    webhook: "ready",
    endpoint: "/api/messenger/webhook/telegram",
  });
}
