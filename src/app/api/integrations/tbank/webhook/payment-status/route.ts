import { NextRequest, NextResponse } from "next/server";
import { processTBankPaymentWebhook } from "@/lib/tbank";

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Неверное тело webhook" }, { status: 400 });
  }

  const sourceIp =
    request.headers.get("x-forwarded-for") ??
    request.headers.get("x-real-ip") ??
    "";
  const result = await processTBankPaymentWebhook({
    payload,
    headers: request.headers,
    sourceIp,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result);
}
