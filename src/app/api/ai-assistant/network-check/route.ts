import { NextResponse } from "next/server";
import { requireAIAssistantAccess } from "@/lib/ai-assistant/access";
import { checkOpenAIConnection } from "@/lib/openai-client";

export const runtime = "nodejs";

export async function GET() {
  const access = await requireAIAssistantAccess();
  if ("response" in access) return access.response;
  return NextResponse.json(await checkOpenAIConnection());
}
